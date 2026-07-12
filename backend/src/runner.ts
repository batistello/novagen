import { initSchema, db } from './db';
import { planAgent, executeNextStep } from './agents/agentLoop';
import { getTier } from './agents/energyConfig';
import { initWebSocketServer } from './ws/server';

const AGENT_IDS = ['blue', 'red'];
const BODY_MIN_MS = 4000;
const BODY_MAX_MS = 7000;

function randomDelay(minMs: number, maxMs: number): number {
  return minMs + Math.random() * (maxMs - minMs);
}

function loadAgentState(agentId: string) {
  return db.prepare(`SELECT energy, last_tick_at FROM agent_state WHERE agent_id = ?`).get(agentId) as { energy: number; last_tick_at: number };
}

let tickQueue: Promise<void> = Promise.resolve();

async function runSequentially(fn: () => Promise<void> | void) {
  const previousQueue = tickQueue;
  let releaseNext: () => void;
  tickQueue = new Promise(resolve => { releaseNext = resolve; });
  await previousQueue.catch(() => {});
  try {
    await fn();
  } finally {
    const delay = randomDelay(1500, 3000);
    await new Promise(resolve => setTimeout(resolve, delay));
    releaseNext!();
  }
}

async function bodyCycle(agentId: string) {
  try {
    await runSequentially(async () => {
      const result = executeNextStep(agentId);
      if (!result.executed) {
        const state = loadAgentState(agentId);
        const tier = getTier(state.energy);
        const elapsed = Date.now() - state.last_tick_at;
        const planIntervalMs = Math.max(tier.tickIntervalMs * 6, 120_000);
        if (tier.callsLLM && elapsed >= planIntervalMs) {
          const planResult = await planAgent(agentId);
          if (planResult.planned) {
            executeNextStep(agentId);
          }
        }
      }
    });
  } catch (err) {
    console.error(`[runner] erro no ciclo de ${agentId}:`, err);
  }
  const nextDelay = randomDelay(BODY_MIN_MS, BODY_MAX_MS);
  setTimeout(() => bodyCycle(agentId), nextDelay);
}

function start() {
  initSchema();
  const wsPort = Number(process.env.WS_PORT) || 4001;
  initWebSocketServer(wsPort);
  console.log('[runner] Artificial Genesis (cerebro/corpo) iniciando...');
  AGENT_IDS.forEach(agentId => {
    bodyCycle(agentId);
  });
}

start();
