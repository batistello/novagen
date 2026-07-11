import { db } from '../db';
import { getTier, PASSIVE_REGEN_PER_MIN, SLEEP_REGEN_PER_MIN, TOKENS_TO_ENERGY } from './energyConfig';
import { buildSystemPrompt, AgentContext } from './systemPromptBuilder';
import { parseAgentResponse, AgentResponse } from './actionSchema';
import { recordEvent, getRecentMemoryFor } from './memory';
import { callGroq } from '../llm/groqClient';
import { callGemini } from '../llm/geminiClient';

type LLMProvider = 'groq' | 'gemini';

const AGENT_PROVIDER: Record<string, LLMProvider> = {
  blue: 'groq',
  red: 'gemini',
};

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho' };
const AGENT_COLORS: Record<string, string> = { blue: '#3498db', red: '#e74c3c' };

function loadTraits(agentId: string): Record<string, number> {
  const rows = db.prepare(`SELECT trait, value FROM agent_traits WHERE agent_id = ?`).all(agentId) as { trait: string; value: number }[];
  const traits: Record<string, number> = {};
  rows.forEach(r => { traits[r.trait] = r.value; });
  return traits;
}

function loadState(agentId: string) {
  return db.prepare(`SELECT * FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    agent_id: string; energy: number; x: number; y: number; emotion: string; status: string; last_tick_at: number;
  };
}

function applyRegen(agentId: string) {
  const state = loadState(agentId);
  const now = Date.now();
  const minutesPassed = (now - state.last_tick_at) / 60000;
  const tier = getTier(state.energy);
  const regenRate = (tier.name === 'sleeping' || tier.name === 'deep_rest') ? SLEEP_REGEN_PER_MIN : PASSIVE_REGEN_PER_MIN;
  const newEnergy = Math.min(100, state.energy + minutesPassed * regenRate);

  db.prepare(`UPDATE agent_state SET energy = ?, last_tick_at = ? WHERE agent_id = ?`)
    .run(newEnergy, now, agentId);

  return newEnergy;
}

function spendEnergy(agentId: string, tokensUsed: number) {
  const state = loadState(agentId);
  const spent = tokensUsed * TOKENS_TO_ENERGY;
  const newEnergy = Math.max(0, state.energy - spent);
  db.prepare(`UPDATE agent_state SET energy = ?, last_tick_at = ? WHERE agent_id = ?`)
    .run(newEnergy, Date.now(), agentId);
  return newEnergy;
}

function persistAgentResponse(agentId: string, response: AgentResponse) {
  if (response.speech) {
    recordEvent(agentId, 'speech', response.speech);
  }
  recordEvent(agentId, 'thought', response.thought);
  recordEvent(agentId, 'action', JSON.stringify(response.action), { emotion: response.emotion });

  const state = loadState(agentId);
  let { x, y } = state;

  if (response.action.type === 'walk') {
    x = response.action.x;
    y = response.action.y;
  }

  db.prepare(`UPDATE agent_state SET x = ?, y = ?, emotion = ? WHERE agent_id = ?`)
    .run(x, y, response.emotion, agentId);

  if (response.action.type === 'create_object') {
    db.prepare(
      `INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(agentId, response.action.shape, response.action.x, response.action.y, response.action.color ?? null, response.action.label ?? null, Date.now());
  }
}

export async function tickAgent(agentId: string) {
  const energyAfterRegen = applyRegen(agentId);
  const tier = getTier(energyAfterRegen);

  if (!tier.callsLLM) {
    console.log(`[${AGENT_NAMES[agentId]}] em '${tier.name}', sem chamada de LLM neste ciclo.`);
    return { skipped: true, tier: tier.name };
  }

  const state = loadState(agentId);
  const traits = loadTraits(agentId);
  const recentMemory = getRecentMemoryFor(agentId, 15);

  const ctx: AgentContext = {
    identity: { id: agentId, name: AGENT_NAMES[agentId], color: AGENT_COLORS[agentId] },
    traits,
    energy: energyAfterRegen,
    tier,
    emotion: state.emotion,
    recentMemory,
    worldSummary: `Você está na posição (${state.x}, ${state.y}).`,
  };

  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = 'Decida o que fazer agora.';

  const provider = AGENT_PROVIDER[agentId];
  const llmResult = provider === 'groq'
    ? await callGroq(systemPrompt, userPrompt)
    : await callGemini(systemPrompt, userPrompt);

  const response = parseAgentResponse(llmResult.raw);

  persistAgentResponse(agentId, response);
  const newEnergy = spendEnergy(agentId, llmResult.totalTokens);

  const speechDisplay = response.speech ? `"${response.speech}"` : '(silêncio)';
  console.log(`[${AGENT_NAMES[agentId]}] (${tier.name}, energia ${newEnergy.toFixed(1)}%) fala: ${speechDisplay} | ação: ${response.action.type}`);

  return { skipped: false, tier: tier.name, response, tokensUsed: llmResult.totalTokens, energyAfter: newEnergy };
}
