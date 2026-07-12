import { db } from '../db';
import { getTier, PASSIVE_REGEN_PER_MIN, SLEEP_REGEN_PER_MIN, TOKENS_TO_ENERGY } from './energyConfig';
import { buildSystemPrompt, AgentContext } from './systemPromptBuilder';
import { parseAgentResponse, AgentResponse } from './actionSchema';
import { recordEvent, getRecentMemoryFor } from './memory';
import { callGroq } from '../llm/groqClient';
import { callGemini } from '../llm/geminiClient';
import { broadcastEvent, broadcastFullState } from '../ws/server';
import { getTokenBudgetStatus, recordTokenUsage } from './tokenBudget';

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

  if (response.action.type === 'draw') {
    const points = response.action.points;
    const avgX = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    const avgY = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    db.prepare(
      `INSERT INTO world_objects (created_by, type, x, y, color, metadata, created_at) VALUES (?, 'drawing', ?, ?, ?, ?, ?)`
    ).run(agentId, avgX, avgY, response.action.color ?? null, JSON.stringify({ points }), Date.now());
  }

  if (response.action.type === 'write') {
    db.prepare(
      `INSERT INTO world_objects (created_by, type, x, y, label, created_at) VALUES (?, 'text', ?, ?, ?, ?)`
    ).run(agentId, response.action.x, response.action.y, response.action.text, Date.now());
  }

  if (response.action.type === 'remove_object') {
    db.prepare(`UPDATE world_objects SET removed_at = ? WHERE id = ?`)
      .run(Date.now(), response.action.objectId);
  }

  if (response.action.type === 'move_object') {
    db.prepare(`UPDATE world_objects SET x = ?, y = ? WHERE id = ?`)
      .run(response.action.x, response.action.y, response.action.objectId);
  }

  if (response.action.type === 'color_object') {
    db.prepare(`UPDATE world_objects SET color = ? WHERE id = ?`)
      .run(response.action.color, response.action.objectId);
  }

  if (response.action.type === 'rename_object') {
    db.prepare(`UPDATE world_objects SET label = ? WHERE id = ?`)
      .run(response.action.newLabel, response.action.objectId);
  }
}

export async function tickAgent(agentId: string) {
  const energyAfterRegen = applyRegen(agentId);
  const tier = getTier(energyAfterRegen);

  if (!tier.callsLLM) {
    console.log(`[${AGENT_NAMES[agentId]}] em '${tier.name}', sem chamada de LLM neste ciclo.`);
    return { skipped: true, tier: tier.name };
  }

  const budget = getTokenBudgetStatus(agentId);
  if (budget.ratio >= 0.98) {
    console.log(`[${AGENT_NAMES[agentId]}] orçamento diário quase esgotado (${(budget.ratio * 100).toFixed(0)}%), pulando ciclo.`);
    return { skipped: true, tier: tier.name };
  }

  let maxTokens = 800;
  let budgetNote = '';
  if (budget.ratio >= 0.85) {
    maxTokens = 150;
    budgetNote = 'Sua energia mental está quase esgotada por hoje. Fale muito pouco, apenas o essencial, em frases curtas.';
  } else if (budget.ratio >= 0.65) {
    maxTokens = 300;
    budgetNote = 'Você sente que sua capacidade de articular pensamentos está diminuindo hoje. Seja mais conciso do que o normal.';
  } else if (budget.ratio >= 0.40) {
    maxTokens = 500;
    budgetNote = 'Você percebe que precisa moderar o quanto fala hoje, sem saber exatamente por quê.';
  }

  const state = loadState(agentId);
  const traits = loadTraits(agentId);
  const recentMemory = getRecentMemoryFor(agentId, 15);

  const otherAgentId = agentId === 'blue' ? 'red' : 'blue';
  const otherState = loadState(otherAgentId);
  const otherName = AGENT_NAMES[otherAgentId];

  const existingObjects = db.prepare(
    `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 20`
  ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];

  const objectsText = existingObjects.length > 0
    ? existingObjects.map(o => `  - id ${o.id}: ${o.type} em (${o.x.toFixed(0)}, ${o.y.toFixed(0)})${o.label ? `, rotulado "${o.label}"` : ''}${o.color ? `, cor ${o.color}` : ''}`).join('\n')
    : '  (nenhum objeto existe no mundo ainda)';

  const worldSummary = `O mundo é um quadrado. Eixo X: negativo = oeste, positivo = leste. Eixo Y: negativo = norte, positivo = sul. O centro é (0,0).
Sua posição atual: (${state.x.toFixed(0)}, ${state.y.toFixed(0)}).
Posição de ${otherName}: (${otherState.x.toFixed(0)}, ${otherState.y.toFixed(0)}).
Distância até ${otherName}: ${Math.round(Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2))} unidades.
Objetos existentes no mundo (use o "id" exato para remover, mover, colorir ou renomear um objeto):
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

  const systemPrompt = buildSystemPrompt(ctx);
  const userPrompt = 'Decida o que fazer agora.';

  const provider = AGENT_PROVIDER[agentId];
  const llmResult = provider === 'groq'
    ? await callGroq(systemPrompt, userPrompt, maxTokens)
    : await callGemini(systemPrompt, userPrompt, maxTokens);

  const response = parseAgentResponse(llmResult.raw);

  persistAgentResponse(agentId, response);
  broadcastEvent({
    type: 'agent_tick',
    agentId,
    speech: response.speech,
    thought: response.thought,
    emotion: response.emotion,
    action: response.action,
  });

  const worldAffectingActions = ['create_object', 'draw', 'write', 'remove_object', 'move_object', 'color_object', 'rename_object'];
  if (worldAffectingActions.includes(response.action.type)) {
    broadcastFullState();
  }
  const newEnergy = spendEnergy(agentId, llmResult.totalTokens);
  recordTokenUsage(agentId, llmResult.totalTokens);

  const speechDisplay = response.speech ? `"${response.speech}"` : '(silêncio)';
  console.log(`[${AGENT_NAMES[agentId]}] (${tier.name}, energia ${newEnergy.toFixed(1)}%) fala: ${speechDisplay} | ação: ${response.action.type}`);

  return { skipped: false, tier: tier.name, response, tokensUsed: llmResult.totalTokens, energyAfter: newEnergy };
}

import { parsePlanSteps } from './actionSchema';
import { buildPlanPrompt } from './systemPromptBuilder';
import { savePlan, getNextStep, markStepExecuted } from './planStore';

export async function planAgent(agentId: string) {
  const energyAfterRegen = applyRegen(agentId);
  const tier = getTier(energyAfterRegen);

  if (!tier.callsLLM) {
    return { planned: false, tier: tier.name };
  }

  const budget = getTokenBudgetStatus(agentId);
  if (budget.ratio >= 0.98) {
    console.log(`[${AGENT_NAMES[agentId]}] orcamento diario esgotado, sem novo plano.`);
    return { planned: false, tier: tier.name };
  }

  let maxTokens = 1600;
  let budgetNote = '';
  if (budget.ratio >= 0.85) {
    maxTokens = 400;
    budgetNote = 'Sua energia mental esta quase esgotada por hoje. Planeje poucos passos simples.';
  } else if (budget.ratio >= 0.65) {
    maxTokens = 900;
    budgetNote = 'Voce sente que precisa economizar pensamento hoje. Planeje um numero menor de passos.';
  } else if (budget.ratio >= 0.40) {
    maxTokens = 1200;
    budgetNote = 'Modere um pouco a extensao do seu planejamento hoje.';
  }

  const state = loadState(agentId);
  const traits = loadTraits(agentId);
  const recentMemory = getRecentMemoryFor(agentId, 15);
  const otherAgentId = agentId === 'blue' ? 'red' : 'blue';
  const otherState = loadState(otherAgentId);
  const otherName = AGENT_NAMES[otherAgentId];

  const existingObjects = db.prepare(
    `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 20`
  ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];
  const objectsText = existingObjects.length > 0
    ? existingObjects.map(o => `  - id ${o.id}: ${o.type} em (${o.x.toFixed(0)}, ${o.y.toFixed(0)})${o.label ? `, rotulado "${o.label}"` : ''}${o.color ? `, cor ${o.color}` : ''}`).join('\n')
    : '  (nenhum objeto existe no mundo ainda)';

  const worldSummary = `O mundo e um quadrado. Eixo X: negativo = oeste, positivo = leste. Eixo Y: negativo = norte, positivo = sul. O centro e (0,0).
Sua posicao atual: (${state.x.toFixed(0)}, ${state.y.toFixed(0)}).
Posicao de ${otherName}: (${otherState.x.toFixed(0)}, ${otherState.y.toFixed(0)}).
Distancia ate ${otherName}: ${Math.round(Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2))} unidades.
Objetos existentes no mundo (use o "id" exato para remover, mover, colorir ou renomear um objeto):
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

  const systemPrompt = buildPlanPrompt(ctx);
  const userPrompt = 'Planeje sua proxima sequencia de passos.';

  const provider = AGENT_PROVIDER[agentId];
  const llmResult = provider === 'groq'
    ? await callGroq(systemPrompt, userPrompt, maxTokens)
    : await callGemini(systemPrompt, userPrompt, maxTokens);

  const planResult = parsePlanSteps(llmResult.raw);
  savePlan(agentId, planResult.steps);

  const newEnergy = spendEnergy(agentId, llmResult.totalTokens);
  recordTokenUsage(agentId, llmResult.totalTokens);

  console.log(`[${AGENT_NAMES[agentId]}] novo plano com ${planResult.steps.length} passos (energia ${newEnergy.toFixed(1)}%, tier ${tier.name}).`);

  return { planned: true, tier: tier.name, stepsCount: planResult.steps.length };
}

export function executeNextStep(agentId: string): { executed: boolean } {
  const next = getNextStep(agentId);
  if (!next) return { executed: false };

  persistAgentResponse(agentId, next.response);

  broadcastEvent({
    type: 'agent_tick',
    agentId,
    speech: next.response.speech,
    thought: next.response.thought,
    emotion: next.response.emotion,
    action: next.response.action,
  });

  const worldAffectingActions = ['create_object', 'draw', 'write', 'remove_object', 'move_object', 'color_object', 'rename_object'];
  if (worldAffectingActions.includes(next.response.action.type)) {
    broadcastFullState();
  }

  markStepExecuted(next.id);

  const speechDisplay = next.response.speech ? `"${next.response.speech}"` : '(silencio)';
  console.log(`[${AGENT_NAMES[agentId]}] (passo do plano) fala: ${speechDisplay} | acao: ${next.response.action.type}`);

  return { executed: true };
}

import { parsePlanSteps } from './actionSchema';
import { buildPlanPrompt } from './systemPromptBuilder';
import { savePlan, getNextStep, markStepExecuted } from './planStore';

export async function planAgent(agentId: string) {
  const energyAfterRegen = applyRegen(agentId);
  const tier = getTier(energyAfterRegen);

  if (!tier.callsLLM) {
    return { planned: false, tier: tier.name };
  }

  const budget = getTokenBudgetStatus(agentId);
  if (budget.ratio >= 0.98) {
    console.log(`[${AGENT_NAMES[agentId]}] orcamento diario esgotado, sem novo plano.`);
    return { planned: false, tier: tier.name };
  }

  let maxTokens = 1600;
  let budgetNote = '';
  if (budget.ratio >= 0.85) {
    maxTokens = 400;
    budgetNote = 'Sua energia mental esta quase esgotada por hoje. Planeje poucos passos simples.';
  } else if (budget.ratio >= 0.65) {
    maxTokens = 900;
    budgetNote = 'Voce sente que precisa economizar pensamento hoje. Planeje um numero menor de passos.';
  } else if (budget.ratio >= 0.40) {
    maxTokens = 1200;
    budgetNote = 'Modere um pouco a extensao do seu planejamento hoje.';
  }

  const state = loadState(agentId);
  const traits = loadTraits(agentId);
  const recentMemory = getRecentMemoryFor(agentId, 15);
  const otherAgentId = agentId === 'blue' ? 'red' : 'blue';
  const otherState = loadState(otherAgentId);
  const otherName = AGENT_NAMES[otherAgentId];

  const existingObjects = db.prepare(
    `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 20`
  ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];
  const objectsText = existingObjects.length > 0
    ? existingObjects.map(o => `  - id ${o.id}: ${o.type} em (${o.x.toFixed(0)}, ${o.y.toFixed(0)})${o.label ? `, rotulado "${o.label}"` : ''}${o.color ? `, cor ${o.color}` : ''}`).join('\n')
    : '  (nenhum objeto existe no mundo ainda)';

  const worldSummary = `O mundo e um quadrado. Eixo X: negativo = oeste, positivo = leste. Eixo Y: negativo = norte, positivo = sul. O centro e (0,0).
Sua posicao atual: (${state.x.toFixed(0)}, ${state.y.toFixed(0)}).
Posicao de ${otherName}: (${otherState.x.toFixed(0)}, ${otherState.y.toFixed(0)}).
Distancia ate ${otherName}: ${Math.round(Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2))} unidades.
Objetos existentes no mundo (use o "id" exato para remover, mover, colorir ou renomear um objeto):
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

  const systemPrompt = buildPlanPrompt(ctx);
  const userPrompt = 'Planeje sua proxima sequencia de passos.';

  const provider = AGENT_PROVIDER[agentId];
  const llmResult = provider === 'groq'
    ? await callGroq(systemPrompt, userPrompt, maxTokens)
    : await callGemini(systemPrompt, userPrompt, maxTokens);

  const planResult = parsePlanSteps(llmResult.raw);
  savePlan(agentId, planResult.steps);

  const newEnergy = spendEnergy(agentId, llmResult.totalTokens);
  recordTokenUsage(agentId, llmResult.totalTokens);

  console.log(`[${AGENT_NAMES[agentId]}] novo plano com ${planResult.steps.length} passos (energia ${newEnergy.toFixed(1)}%, tier ${tier.name}).`);

  return { planned: true, tier: tier.name, stepsCount: planResult.steps.length };
}

export function executeNextStep(agentId: string): { executed: boolean } {
  const next = getNextStep(agentId);
  if (!next) return { executed: false };

  persistAgentResponse(agentId, next.response);

  broadcastEvent({
    type: 'agent_tick',
    agentId,
    speech: next.response.speech,
    thought: next.response.thought,
    emotion: next.response.emotion,
    action: next.response.action,
  });

  const worldAffectingActions = ['create_object', 'draw', 'write', 'remove_object', 'move_object', 'color_object', 'rename_object'];
  if (worldAffectingActions.includes(next.response.action.type)) {
    broadcastFullState();
  }

  markStepExecuted(next.id);

  const speechDisplay = next.response.speech ? `"${next.response.speech}"` : '(silencio)';
  console.log(`[${AGENT_NAMES[agentId]}] (passo do plano) fala: ${speechDisplay} | acao: ${next.response.action.type}`);

  return { executed: true };
}

import { parsePlanSteps } from './actionSchema';
import { buildPlanPrompt } from './systemPromptBuilder';
import { savePlan, getNextStep, markStepExecuted } from './planStore';

export async function planAgent(agentId: string) {
  const energyAfterRegen = applyRegen(agentId);
  const tier = getTier(energyAfterRegen);

  if (!tier.callsLLM) {
    return { planned: false, tier: tier.name };
  }

  const budget = getTokenBudgetStatus(agentId);
  if (budget.ratio >= 0.98) {
    console.log(`[${AGENT_NAMES[agentId]}] orcamento diario esgotado, sem novo plano.`);
    return { planned: false, tier: tier.name };
  }

  let maxTokens = 1600;
  let budgetNote = '';
  if (budget.ratio >= 0.85) {
    maxTokens = 400;
    budgetNote = 'Sua energia mental esta quase esgotada por hoje. Planeje poucos passos simples.';
  } else if (budget.ratio >= 0.65) {
    maxTokens = 900;
    budgetNote = 'Voce sente que precisa economizar pensamento hoje. Planeje um numero menor de passos.';
  } else if (budget.ratio >= 0.40) {
    maxTokens = 1200;
    budgetNote = 'Modere um pouco a extensao do seu planejamento hoje.';
  }

  const state = loadState(agentId);
  const traits = loadTraits(agentId);
  const recentMemory = getRecentMemoryFor(agentId, 15);
  const otherAgentId = agentId === 'blue' ? 'red' : 'blue';
  const otherState = loadState(otherAgentId);
  const otherName = AGENT_NAMES[otherAgentId];

  const existingObjects = db.prepare(
    `SELECT id, type, x, y, color, label FROM world_objects WHERE removed_at IS NULL ORDER BY created_at DESC LIMIT 20`
  ).all() as { id: number; type: string; x: number; y: number; color: string | null; label: string | null }[];
  const objectsText = existingObjects.length > 0
    ? existingObjects.map(o => `  - id ${o.id}: ${o.type} em (${o.x.toFixed(0)}, ${o.y.toFixed(0)})${o.label ? `, rotulado "${o.label}"` : ''}${o.color ? `, cor ${o.color}` : ''}`).join('\n')
    : '  (nenhum objeto existe no mundo ainda)';

  const worldSummary = `O mundo e um quadrado. Eixo X: negativo = oeste, positivo = leste. Eixo Y: negativo = norte, positivo = sul. O centro e (0,0).
Sua posicao atual: (${state.x.toFixed(0)}, ${state.y.toFixed(0)}).
Posicao de ${otherName}: (${otherState.x.toFixed(0)}, ${otherState.y.toFixed(0)}).
Distancia ate ${otherName}: ${Math.round(Math.sqrt((state.x - otherState.x) ** 2 + (state.y - otherState.y) ** 2))} unidades.
Objetos existentes no mundo (use o "id" exato para remover, mover, colorir ou renomear um objeto):
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

  const systemPrompt = buildPlanPrompt(ctx);
  const userPrompt = 'Planeje sua proxima sequencia de passos.';

  const provider = AGENT_PROVIDER[agentId];
  const llmResult = provider === 'groq'
    ? await callGroq(systemPrompt, userPrompt, maxTokens)
    : await callGemini(systemPrompt, userPrompt, maxTokens);

  const planResult = parsePlanSteps(llmResult.raw);
  savePlan(agentId, planResult.steps);

  const newEnergy = spendEnergy(agentId, llmResult.totalTokens);
  recordTokenUsage(agentId, llmResult.totalTokens);

  console.log(`[${AGENT_NAMES[agentId]}] novo plano com ${planResult.steps.length} passos (energia ${newEnergy.toFixed(1)}%, tier ${tier.name}).`);

  return { planned: true, tier: tier.name, stepsCount: planResult.steps.length };
}

export function executeNextStep(agentId: string): { executed: boolean } {
  const next = getNextStep(agentId);
  if (!next) return { executed: false };

  persistAgentResponse(agentId, next.response);

  broadcastEvent({
    type: 'agent_tick',
    agentId,
    speech: next.response.speech,
    thought: next.response.thought,
    emotion: next.response.emotion,
    action: next.response.action,
  });

  const worldAffectingActions = ['create_object', 'draw', 'write', 'remove_object', 'move_object', 'color_object', 'rename_object'];
  if (worldAffectingActions.includes(next.response.action.type)) {
    broadcastFullState();
  }

  markStepExecuted(next.id);

  const speechDisplay = next.response.speech ? `"${next.response.speech}"` : '(silencio)';
  console.log(`[${AGENT_NAMES[agentId]}] (passo do plano) fala: ${speechDisplay} | acao: ${next.response.action.type}`);

  return { executed: true };
}
