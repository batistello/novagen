import { initSchema } from './db';
import { tickAgent } from './agents/agentLoop';
import { getTier } from './agents/energyConfig';
import { db } from './db';
import { initWebSocketServer } from './ws/server';

const AGENT_IDS = ['blue', 'red'];

function loadEnergy(agentId: string): number {
  const row = db.prepare(`SELECT energy FROM agent_state WHERE agent_id = ?`).get(agentId) as { energy: number };
  return row.energy;
}

async function scheduleNextTick(agentId: string) {
  try {
    const result = await tickAgent(agentId);
    const energy = loadEnergy(agentId);
    const tier = getTier(energy);
    console.log(`[runner] ${agentId} próximo tick em ${tier.tickIntervalMs / 1000}s (tier: ${tier.name})`);
    setTimeout(() => scheduleNextTick(agentId), tier.tickIntervalMs);
  } catch (err) {
    console.error(`[runner] erro no tick de ${agentId}:`, err);
    // em caso de erro (ex: falha de rede na API), tenta de novo em 30s
    setTimeout(() => scheduleNextTick(agentId), 30_000);
  }
}

function start() {
  initSchema();
  const wsPort = Number(process.env.WS_PORT) || 4001;
  initWebSocketServer(wsPort);
  console.log('[runner] Artificial Genesis iniciando...');
  AGENT_IDS.forEach(agentId => {
    scheduleNextTick(agentId);
  });
}

start();
