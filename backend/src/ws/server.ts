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

function getFullState() {
  const agents = db.prepare(`SELECT * FROM agents`).all();
  const states = db.prepare(`SELECT * FROM agent_state`).all();
  const objects = db.prepare(`SELECT * FROM world_objects WHERE removed_at IS NULL`).all();

  return {
    type: 'full_state',
    agents,
    states,
    objects,
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
