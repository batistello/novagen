import { initSchema, db } from './db';
import { getTier, PASSIVE_REGEN_PER_MIN, SLEEP_REGEN_PER_MIN } from './agents/energyConfig';
import { applyHungerDecay, growPlants, describeHungerQualitative, describeEnergyQualitative, describePlantStage } from './agents/hungerSystem';
import { growResources } from './agents/resourceSystem';
import { tickWolves, getNearbyWolves } from './agents/wolfSystem';
import { tickHuntWolfTask, startHuntWolfTask } from './world/tasks/huntWolfTask';
import { tickRodents, getAliveRodents } from './agents/rodentSystem';
import { applyHpRegen, describeHpQualitative } from './agents/hpSystem';
import { initWebSocketServer } from './ws/server';
import { getIntention, saveIntention, isIntentionExpiredOrInterrupted, markIntentionInterrupted } from './agents/intentionStore';
import { behaviorTick, checkProximityInterrupt } from './agents/behaviorEngine';
import { parseIntention } from './agents/actionSchema';
import { buildIntentionPrompt, AgentContext } from './agents/systemPromptBuilder';
import { getTokenBudgetStatus, recordTokenUsage } from './agents/tokenBudget';
import { getRequestBudgetStatus, recordRequestUsage } from './agents/requestBudget';
import { getRecentMemoryFor, recordEvent } from './agents/memory';
import { getMemoriesByCategory } from './agents/memoryTiers';
import { updateBelief, getBeliefs } from './agents/theoryOfMind';
import { proposeContract, getPendingContractsFor, respondToContract, logFirstProposalIfNeeded } from './agents/socialContracts';
import { callGroq } from './llm/groqClient';
import { callGemini } from './llm/geminiClient';

function getGeminiKeyFor(agentId: string): string | undefined {
  if (agentId === 'blue') return process.env.GEMINI_API_KEY_BLUE || undefined;
  if (agentId === 'red') return process.env.GEMINI_API_KEY_RED || undefined;
  if (agentId === 'green') return process.env.GEMINI_API_KEY_GREEN || undefined;
  return undefined;
}

const AGENT_IDS = ['blue', 'red', 'green'];
const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };
const AGENT_COLORS: Record<string, string> = { blue: '#3498db', red: '#e74c3c', green: '#2ecc71' };
const AGENT_PROVIDER: Record<string, 'groq' | 'gemini'> = { blue: 'gemini', red: 'gemini', green: 'gemini' };
const BEHAVIOR_TICK_MS = 3000;

function loadState(agentId: string) {
  return db.prepare(`SELECT * FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    agent_id: string; energy: number; hunger: number; x: number; y: number; emotion: string; status: string; last_tick_at: number;
  };
}

function logActivityTransition(agentId: string, newState: 'awake' | 'asleep') {
  const row = db.prepare(`SELECT last_activity_state FROM agent_state WHERE agent_id = ?`).get(agentId) as { last_activity_state: string };
  if (row.last_activity_state === newState) return;

  db.prepare(`INSERT INTO agent_activity_log (agent_id, event_type, occurred_at) VALUES (?, ?, ?)`)
    .run(agentId, newState === 'asleep' ? 'sleep' : 'wake', Date.now());
  db.prepare(`UPDATE agent_state SET last_activity_state = ? WHERE agent_id = ?`).run(newState, agentId);
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
    const currentState = loadState(agentId);
    if (currentState.status === 'dead') {
      return;
    }

    const hunger = applyHungerDecay(agentId);
    const stateAfterHunger = loadState(agentId);
    if (stateAfterHunger.status === 'dead') {
      console.log(`[${AGENT_NAMES[agentId]}] morreu (fome critica levou a perda de HP ate zero).`);

      const alreadyMarked = db.prepare(
        `SELECT id FROM world_objects WHERE type = 'corpse' AND created_by = ? LIMIT 1`
      ).get(agentId);

      if (!alreadyMarked) {
        db.prepare(
          `INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, 'corpse', ?, ?, ?, ?, ?)`
        ).run(agentId, stateAfterHunger.x, stateAfterHunger.y, AGENT_COLORS[agentId], `restos de ${AGENT_NAMES[agentId]}`, Date.now());

        const { recordCategorizedMemory } = await import('./agents/memoryTiers');
        const witnesses = db.prepare(`SELECT agent_id, x, y FROM agent_state WHERE agent_id != ? AND status != 'dead'`).all(agentId) as { agent_id: string; x: number; y: number }[];
        const WITNESS_RADIUS_DEATH = 100;
        witnesses.forEach(w => {
          const dist = Math.sqrt((w.x - stateAfterHunger.x) ** 2 + (w.y - stateAfterHunger.y) ** 2);
          if (dist <= WITNESS_RADIUS_DEATH) {
            recordCategorizedMemory(w.agent_id, 'social', `${AGENT_NAMES[agentId]} parou de se mover e nao respondeu mais.`, agentId);
          }
        });

        const { recordDiaryEntry } = await import('./agents/worldDiary');
        recordDiaryEntry(`${AGENT_NAMES[agentId]} morreu (fome critica levou a perda de HP ate zero).`, 'MORTE');
      }

      const { broadcastEvent: bedeath, broadcastFullState: bfsdeath } = await import('./ws/server');
      bedeath({ type: 'agent_status', agentId, resting: true, reason: 'dead' });
      bfsdeath();
      return;
    }

    const energyAfterRegen = applyRegen(agentId);
    const tier = getTier(energyAfterRegen);

    if (!tier.callsLLM) {
      console.log(`[${AGENT_NAMES[agentId]}] em '${tier.name}', sem nova intencao neste ciclo.`);
      const { broadcastEvent: be1 } = await import('./ws/server');
      be1({ type: 'agent_status', agentId, resting: true, reason: 'energy' });
      logActivityTransition(agentId, 'asleep');
      return;
    }

    const requestBudget = getRequestBudgetStatus(agentId);
    if (requestBudget.exhausted) {
      console.log(`[${AGENT_NAMES[agentId]}] limite de requisicoes esgotado (${requestBudget.used}/${requestBudget.limit}), sem nova intencao.`);
      const { broadcastEvent: be2b } = await import('./ws/server');
      be2b({ type: 'agent_status', agentId, resting: true, reason: 'requests' });
      logActivityTransition(agentId, 'asleep');
      return;
    }

    const budget = getTokenBudgetStatus(agentId);
    if (budget.ratio >= 0.98) {
      console.log(`[${AGENT_NAMES[agentId]}] orcamento diario esgotado, sem nova intencao.`);
      const { broadcastEvent: be2 } = await import('./ws/server');
      be2({ type: 'agent_status', agentId, resting: true, reason: 'budget' });
      logActivityTransition(agentId, 'asleep');
      return;
    }

    let maxTokens = 900;
    let budgetNote = '';
    if (budget.ratio >= 0.85) {
      maxTokens = 450;
      budgetNote = 'Sua energia mental esta quase esgotada por hoje. Seja bem simples e direto na fala e no pensamento.';
    } else if (budget.ratio >= 0.65) {
      maxTokens = 600;
      budgetNote = 'Voce sente que precisa economizar pensamento hoje.';
    } else if (budget.ratio >= 0.40) {
      maxTokens = 750;
      budgetNote = 'Modere um pouco a extensao do seu raciocinio hoje.';
    }

    const state = loadState(agentId);
    const traits = loadTraits(agentId);
    const recentMemory = getRecentMemoryFor(agentId, 15);
    const episodicMemory = getMemoriesByCategory(agentId, 'episodic', 6);
    const socialMemory = getMemoriesByCategory(agentId, 'social', 6);
    const knowledgeMemory = getMemoriesByCategory(agentId, 'knowledge', 10);
    const currentGoals = db.prepare(`SELECT short_term_goal, medium_term_goal, long_term_goal FROM agent_state WHERE agent_id = ?`).get(agentId) as {
      short_term_goal: string | null; medium_term_goal: string | null; long_term_goal: string | null;
    };
    const goalsText = (currentGoals.medium_term_goal || currentGoals.long_term_goal)
      ? `Seus objetivos atuais:
${currentGoals.medium_term_goal ? `  - Medio prazo: ${currentGoals.medium_term_goal}
` : ''}${currentGoals.long_term_goal ? `  - Longo prazo: ${currentGoals.long_term_goal}` : ''}`
      : '';
    const beliefs = getBeliefs(agentId);
    const beliefsText = beliefs.length > 0
      ? `Sua opiniao formada sobre as outras entidades, baseada no que voce ja viveu:\n${beliefs.map(b => `  - Sobre ${AGENT_NAMES[b.about_agent_id] ?? b.about_agent_id}: ${b.belief_text}`).join('\n')}`
      : '';
    const pendingContracts = getPendingContractsFor(agentId);
    const contractsText = pendingContracts.length > 0
      ? `Alguem propos um acordo a voce, ainda sem resposta:\n${pendingContracts.map(c => `  - id ${c.id}, proposto por ${AGENT_NAMES[c.proposed_by] ?? c.proposed_by}: "${c.terms}"`).join('\n')}\nSe quiser responder, preencha "contract_response_id" com o id exato e "contract_response_accept" com true ou false.`
      : '';
    const allStates = db.prepare(`SELECT agent_id, status FROM agent_state`).all() as { agent_id: string; status: string }[];
    const aliveIds = new Set(allStates.filter(s => s.status !== 'dead').map(s => s.agent_id));
    const otherAgentIds = AGENT_IDS.filter(id => id !== agentId && aliveIds.has(id));

    const { checkAndRecordFirstMeeting } = await import('./agents/worldDiary');
    otherAgentIds.forEach(otherId => {
      const otherState = loadState(otherId);
      const distMeet = Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2);
      checkAndRecordFirstMeeting(agentId, otherId, distMeet);
    });

    function compassDirection(dx: number, dy: number): string {
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const dirs = ['leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste', 'norte', 'nordeste'];
      const idx = Math.round(((angle + 360) % 360) / 45) % 8;
      return dirs[idx];
    }

    const VISION_RADIUS = 70;

    const visibleAgentIds = otherAgentIds.filter(otherId => {
      const otherState = loadState(otherId);
      const dist = Math.sqrt((otherState.x - state.x) ** 2 + (otherState.y - state.y) ** 2);
      return dist <= VISION_RADIUS;
    });

    const othersText = visibleAgentIds.map(otherId => {
      const otherState = loadState(otherId);
      const otherName = AGENT_NAMES[otherId];
      const dx = otherState.x - state.x;
      const dy = otherState.y - state.y;
      const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
      const dir = compassDirection(dx, dy);
      return `  - ${otherName} (id "${otherId}"): a ${dist} metros, ao ${dir}`;
    }).join('\n');
    const nearbyObjectsRaw = db.prepare(
      `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 60`
    ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];
    const visibleObjects = nearbyObjectsRaw
      .map(o => {
        const dx = o.x - state.x;
        const dy = o.y - state.y;
        const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
        return { ...o, dist, dir: compassDirection(dx, dy) };
      })
      .filter(o => o.dist <= VISION_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 8);
    const examinedIds = new Set(
      (db.prepare(`SELECT object_id FROM agent_examined_objects WHERE agent_id = ?`).all(agentId) as { object_id: number }[])
        .map(r => r.object_id)
    );
    const objectsText = visibleObjects.length > 0
      ? visibleObjects.map(o => `  - ${o.type}${o.label ? ` "${o.label}"` : ''} (id ${o.id}): a ${o.dist} metros, ao ${o.dir}${examinedIds.has(o.id) ? ' (voce ja examinou isso de perto antes)' : ''}`).join('\n')
      : '  (nada visivel por perto)';

    const hungerValue = stateAfterHunger.hunger;
    const distToGrass = Math.round(Math.sqrt((state.x - 0) ** 2 + (state.y - 0) ** 2));
    let wolvesText = '';
    {
      const nearbyWolves = getNearbyWolves(state.x, state.y, 70);
      if (nearbyWolves.length > 0) {
        wolvesText = 'Voce percebe algo selvagem por perto:\n' + nearbyWolves.map(w => {
          const dx = w.x - state.x;
          const dy = w.y - state.y;
          const dist = Math.round(Math.sqrt(dx * dx + dy * dy));
          return `  - id ${w.id}: uma presenca animal a ${dist} metros, ao ${compassDirection(dx, dy)}`;
        }).join('\n') + '\nSe sua intencao for "attack_wolf" (um unico golpe) ou "hunt_wolf_task" (cacada continua ate terminar, sem precisar decidir de novo a cada passo), defina "target_wolf_id" com o id exato.';
      }
    }

    let rodentsText = '';
    {
      const nearbyRodents = getAliveRodents()
        .map(r => ({ ...r, dist: Math.sqrt((r.x - state.x) ** 2 + (r.y - state.y) ** 2) }))
        .filter(r => r.dist <= 40);
      if (nearbyRodents.length > 0) {
        rodentsText = 'Voce percebe algo pequeno se movendo por perto:\n' + nearbyRodents.map(r => {
          const dx = r.x - state.x;
          const dy = r.y - state.y;
          const dist = Math.round(r.dist);
          return `  - id ${r.id}: algo pequeno e agil a ${dist} metros, ao ${compassDirection(dx, dy)}`;
        }).join('\n') + '\nSe sua intencao for "attack_rodent", defina "target_rodent_id" com o id exato.';
      }
    }

    let grassLine = '';
    if (distToGrass <= 70) {
      const plants = db.prepare(`SELECT stage FROM food_slots WHERE status = 'available'`).all() as { stage: string }[];
      if (plants.length > 0) {
        const dir = compassDirection(0 - state.x, 0 - state.y);
        const descriptions = plants.map(p => describePlantStage(p.stage));
        grassLine = `  - uma area diferente do chao, a ${distToGrass} metros, ao ${dir}, onde voce percebe: ${descriptions.join(', ')}`;
      } else {
        grassLine = `  - uma area diferente do chao, a ${distToGrass} metros, ao ${compassDirection(0 - state.x, 0 - state.y)}, mas nao ha nada visivel ali no momento`;
      }
    }

    const worldSummary = `Voce percebe o espaco ao seu redor, mas nao tem uma visao completa dele.

Voce sente:
- ${describeEnergyQualitative(energyAfterRegen)}
- ${describeHungerQualitative(hungerValue)} (voce nao sabe exatamente o que essa sensacao significa nem como ela funciona, apenas a percebe)
${hungerValue < 20 ? '- Voce sente que seu corpo esta ficando fisicamente mais fraco a cada momento que passa sem se alimentar. Se isso continuar, voce sabe que pode nao resistir.' : ''}
${budgetNote ? '- ' + budgetNote : ''}

Voce percebe estas entidades:
${visibleAgentIds.length > 0 ? othersText : '  (nenhuma entidade percebida por perto)'}

Voce ve estes objetos proximos:
${objectsText}
${grassLine}
${wolvesText}
${rodentsText}

${episodicMemory.length > 0 ? `Voce se lembra de coisas que ja viveu:\n${episodicMemory.map(m => `  - ${m}`).join('\n')}` : ''}
${socialMemory.length > 0 ? `Voce se lembra de coisas que percebeu sobre as outras entidades:\n${socialMemory.map(m => `  - ${m}`).join('\n')}` : ''}
${knowledgeMemory.length > 0 ? `Coisas que voce concluiu ou aprendeu ao longo do tempo:\n${knowledgeMemory.map(m => `  - ${m}`).join('\n')}` : ''}
${goalsText}
${beliefsText}
${contractsText}
Voce nao sabe o que existe alem do que consegue perceber aqui.
${visibleAgentIds.length > 0 ? `Se sua intencao for "approach" ou "move_away", defina "target_agent_id" com o id exato (${visibleAgentIds.map(id => `"${id}"`).join(' ou ')}) da entidade que deseja como alvo.` : ''}`;


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
    recordRequestUsage(agentId);
    const llmResult = provider === 'groq'
      ? await callGroq(systemPrompt, userPrompt, maxTokens)
      : await callGemini(systemPrompt, userPrompt, maxTokens, getGeminiKeyFor(agentId));

    const intention = parseIntention(llmResult.raw);
    saveIntention(agentId, intention);

    if (intention.belief_about_agent_id && intention.belief_text) {
      updateBelief(agentId, intention.belief_about_agent_id, intention.belief_text);
    }

    if (intention.medium_term_goal || intention.long_term_goal) {
      db.prepare(`UPDATE agent_state SET medium_term_goal = COALESCE(?, medium_term_goal), long_term_goal = COALESCE(?, long_term_goal), goals_updated_at = ? WHERE agent_id = ?`)
        .run(intention.medium_term_goal ?? null, intention.long_term_goal ?? null, Date.now(), agentId);
    }

    if (intention.memory_note) {
      const { recordCategorizedMemory } = await import('./agents/memoryTiers');
      recordCategorizedMemory(agentId, 'knowledge', intention.memory_note);
    }

    if (intention.contract_proposal && intention.contract_proposal_to) {
      proposeContract(agentId, intention.contract_proposal_to, intention.contract_proposal);
      logFirstProposalIfNeeded(agentId, intention.contract_proposal);
    }

    if (intention.contract_response_id != null && intention.contract_response_accept != null) {
      respondToContract(intention.contract_response_id, intention.contract_response_accept);
    }
    recordTokenUsage(agentId, llmResult.totalTokens);

    if (intention.speech) {
      recordEvent(agentId, 'speech', intention.speech);
    }
    recordEvent(agentId, 'thought', intention.thought);

    const { broadcastEvent: be3 } = await import('./ws/server');
    be3({ type: 'agent_status', agentId, resting: false, reason: null });
    logActivityTransition(agentId, 'awake');
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
  growPlants();
  growResources();
  tickWolves();
  tickRodents();

  AGENT_IDS.forEach(agentId => {
    applyHpRegen(agentId);

    const taskStillRunning = tickHuntWolfTask(agentId);
    if (taskStillRunning) {
      return;
    }
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
