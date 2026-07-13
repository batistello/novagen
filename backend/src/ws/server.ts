import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function initWebSocketServer(port: number) {
  wss = new WebSocketServer({ port });

  wss.on('connection', (socket) => {
    clients.add(socket);
    console.log(`[ws] cliente conectado (${clients.size} total)`);

    sendFullState(socket);

    socket.on('close', () => {
      clients.delete(socket);
      console.log(`[ws] cliente desconectado (${clients.size} total)`);
    });
  });

  console.log(`[ws] servidor WebSocket ouvindo na porta ${port}`);
}

function getLastSpeeches() {
  const rows = db.prepare(
    `SELECT agent_id, content, created_at FROM events WHERE type = 'speech' ORDER BY created_at DESC LIMIT 20`
  ).all() as { agent_id: string; content: string; created_at: number }[];

  const lastByAgent: Record<string, { text: string; createdAt: number }> = {};
  for (const row of rows) {
    if (!lastByAgent[row.agent_id]) {
      lastByAgent[row.agent_id] = { text: row.content, createdAt: row.created_at };
    }
  }
  return lastByAgent;
}

function computeRestingMap(states: { agent_id: string; energy: number }[]): Record<string, boolean> {
  const { getTier } = require('../agents/energyConfig');
  const { getTokenBudgetStatus } = require('../agents/tokenBudget');
  const map: Record<string, boolean> = {};
  for (const s of states) {
    const tier = getTier(s.energy);
    const budget = getTokenBudgetStatus(s.agent_id);
    map[s.agent_id] = !tier.callsLLM || budget.ratio >= 0.98;
  }
  return map;
}

function getWorldDiary(limit: number = 20) {
  return db.prepare(`SELECT day, content, tag FROM world_diary ORDER BY id DESC LIMIT ?`).all(limit);
}

function getFullState() {
  const agents = db.prepare(`SELECT * FROM agents`).all();
  const states = db.prepare(`SELECT * FROM agent_state`).all() as { agent_id: string; energy: number }[];
  const objects = db.prepare(`SELECT * FROM world_objects WHERE removed_at IS NULL`).all();
  const lastSpeeches = getLastSpeeches();
  const resting = computeRestingMap(states);
  const diary = getWorldDiary();

  return {
    type: 'full_state',
    agents,
    states,
    objects,
    lastSpeeches,
    resting,
    diary,
  };
}

function sendFullState(socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(getFullState()));
  }
}

export function broadcastEvent(event: object) {
  const payload = JSON.stringify(event);
  clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

export function broadcastFullState() {
  broadcastEvent(getFullState());
}
