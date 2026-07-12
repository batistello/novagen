import { initSchema, db } from './db';
import { getTier, PASSIVE_REGEN_PER_MIN, SLEEP_REGEN_PER_MIN } from './agents/energyConfig';
import { initWebSocketServer } from './ws/server';
import { getIntention, saveIntention, isIntentionExpiredOrInterrupted, markIntentionInterrupted } from './agents/intentionStore';
import { behaviorTick, checkProximityInterrupt } from './agents/behaviorEngine';
import { parseIntention } from './agents/actionSchema';
import { buildIntentionPrompt, AgentContext } from './agents/systemPromptBuilder';
import { getTokenBudgetStatus, recordTokenUsage } from './agents/tokenBudget';
import { getRecentMemoryFor, recordEvent } from './agents/memory';
import { callGroq } from './llm/groqClient';
import { callGemini } from './llm/geminiClient';

function getGeminiKeyFor(agentId: string): string | undefined {
  if (agentId === 'blue') return process.env.GEMINI_API_KEY_BLUE || undefined;
  if (agentId === 'red') return process.env.GEMINI_API_KEY_RED || undefined;
  return undefined;
}

const AGENT_IDS = ['blue', 'red'];
const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho' };
const AGENT_COLORS: Record<string, string> = { blue: '#3498db', red: '#e74c3c' };
const AGENT_PROVIDER: Record<string, 'groq' | 'gemini'> = { blue: 'gemini', red: 'gemini' };
const BEHAVIOR_TICK_MS = 3000;

function loadState(agentId: string) {
  return db.prepare(`SELECT * FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    agent_id: string; energy: number; x: number; y: number; emotion: string; status: string; last_tick_at: number;
  };
}

function loadTraits(agentId: string): Record<string, number> {
  const rows = db.prepare(`SELECT trait, value FROM agent_traits WHERE agent_id = ?`).all(agentId) as { trait: string; value: number }[];
  const traits: Record<string, number> = {};
  rows.forEach(r => { traits[r.trait] = r.value; });
  return traits;
}

function applyRegen(agentId: string) {
  const state = loadState(agentId);
  const now = Date.now();
  const minutesPassed = (now - state.last_tick_at) / 60000;
  const tier = getTier(state.energy);
  const regenRate = (tier.name === 'sleeping' || tier.name === 'deep_rest') ? SLEEP_REGEN_PER_MIN : PASSIVE_REGEN_PER_MIN;
  const newEnergy = Math.min(100, state.energy + minutesPassed * regenRate);
  db.prepare(`UPDATE agent_state SET energy = ?, last_tick_at = ? WHERE agent_id = ?`).run(newEnergy, now, agentId);
  return newEnergy;
}

let thinkQueue: Promise<void> = Promise.resolve();

async function think(agentId: string) {
  const previousQueue = thinkQueue;
  let release: () => void;
  thinkQueue = new Promise(resolve => { release = resolve; });
  await previousQueue.catch(() => {});

  try {
    const energyAfterRegen = applyRegen(agentId);
    const tier = getTier(energyAfterRegen);

    if (!tier.callsLLM) {
      console.log(`[${AGENT_NAMES[agentId]}] em '${tier.name}', sem nova intencao neste ciclo.`);
      return;
    }

    const budget = getTokenBudgetStatus(agentId);
    if (budget.ratio >= 0.98) {
      console.log(`[${AGENT_NAMES[agentId]}] orcamento diario esgotado, sem nova intencao.`);
      return;
    }

    let maxTokens = 700;
    let budgetNote = '';
    if (budget.ratio >= 0.85) {
      maxTokens = 250;
      budgetNote = 'Sua energia mental esta quase esgotada por hoje. Seja bem simples e direto.';
    } else if (budget.ratio >= 0.65) {
      maxTokens = 400;
      budgetNote = 'Voce sente que precisa economizar pensamento hoje.';
    } else if (budget.ratio >= 0.40) {
      maxTokens = 550;
      budgetNote = 'Modere um pouco a extensao do seu raciocinio hoje.';
    }

    const state = loadState(agentId);
    const traits = loadTraits(agentId);
    const recentMemory = getRecentMemoryFor(agentId, 15);
    const otherAgentId = agentId === 'blue' ? 'red' : 'blue';
    const otherState = loadState(otherAgentId);
    const otherName = AGENT_NAMES[otherAgentId];

    const existingObjects = db.prepare(
      `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 15`
    ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];
    const objectsText = existingObjects.length > 0
      ? existingObjects.map(o => `  - id ${o.id}: ${o.type} em (${o.x.toFixed(0)}, ${o.y.toFixed(0)})`).join('\n')
      : '  (nenhum objeto existe no mundo ainda)';

    const worldSummary = `O mundo e um quadrado. Eixo X: negativo = oeste, positivo = leste. Eixo Y: negativo = norte, positivo = sul. O centro e (0,0).
Sua posicao atual: (${state.x.toFixed(0)}, ${state.y.toFixed(0)}).
Posicao de ${otherName}: (${otherState.x.toFixed(0)}, ${otherState.y.toFixed(0)}).
Distancia ate ${otherName}: ${Math.round(Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2))} unidades.
Objetos existentes:
${objectsText}
${budgetNote}`;

    const ctx: AgentContext = {
      identity: { id: agentId, name: AGENT_NAMES[agentId], color: AGENT_COLORS[agentId] },
      traits,
      energy: energyAfterRegen,
      tier,
      emotion: state.emotion,
      recentMemory,
      worldSummary,
    };

    const systemPrompt = buildIntentionPrompt(ctx);
    const userPrompt = 'Decida sua intencao para os proximos minutos.';

    const provider = AGENT_PROVIDER[agentId];
    const llmResult = provider === 'groq'
      ? await callGroq(systemPrompt, userPrompt, maxTokens)
      : await callGemini(systemPrompt, userPrompt, maxTokens, getGeminiKeyFor(agentId));

    const intention = parseIntention(llmResult.raw);
    saveIntention(agentId, intention);
    recordTokenUsage(agentId, llmResult.totalTokens);

    if (intention.speech) {
      recordEvent(agentId, 'speech', intention.speech);
    }
    recordEvent(agentId, 'thought', intention.thought);

    console.log(`[${AGENT_NAMES[agentId]}] nova intencao: ${intention.goal_type} por ${intention.duration_minutes}min (energia ${energyAfterRegen.toFixed(1)}%, tier ${tier.name})`);

    const { broadcastEvent } = await import('./ws/server');
    broadcastEvent({
      type: 'agent_tick',
      agentId,
      speech: intention.speech,
      thought: intention.thought,
      emotion: intention.emotion,
      action: { type: 'observe' },
    });
  } catch (err) {
    console.error(`[runner] erro ao pensar (${agentId}):`, err);
  } finally {
    release!();
  }
}

function behaviorLoop() {
  AGENT_IDS.forEach(agentId => {
    const intention = getIntention(agentId);

    if (checkProximityInterrupt(agentId)) {
      markIntentionInterrupted(agentId);
      console.log(`[${AGENT_NAMES[agentId]}] intencao interrompida por proximidade.`);
      think(agentId);
      return;
    }

    if (!intention || isIntentionExpiredOrInterrupted(intention)) {
      think(agentId);
      return;
    }

    behaviorTick(agentId);
  });

  setTimeout(behaviorLoop, BEHAVIOR_TICK_MS);
}

function start() {
  initSchema();
  const wsPort = Number(process.env.WS_PORT) || 4001;
  initWebSocketServer(wsPort);
  console.log('[runner] Artificial Genesis (intencao/comportamento) iniciando...');
  behaviorLoop();
}

start();
