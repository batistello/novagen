import { db } from '../db';
import { getIntention, setWanderTarget, isIntentionExpiredOrInterrupted, StoredIntention } from './intentionStore';
import { broadcastEvent, broadcastFullState } from '../ws/server';

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho' };
const WORLD_HALF = 150;
const PROXIMITY_CHECK_UNITS = 30;

function loadState(agentId: string) {
  return db.prepare(`SELECT * FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    agent_id: string; energy: number; x: number; y: number; emotion: string; status: string;
  };
}

function moveTowards(agentId: string, targetX: number, targetY: number, step: number) {
  const state = loadState(agentId);
  const dx = targetX - state.x;
  const dy = targetY - state.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return { x: state.x, y: state.y, arrived: true };

  const moveDist = Math.min(step, dist);
  const newX = state.x + (dx / dist) * moveDist;
  const newY = state.y + (dy / dist) * moveDist;

  const clampedX = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, newX));
  const clampedY = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, newY));

  db.prepare(`UPDATE agent_state SET x = ?, y = ? WHERE agent_id = ?`).run(clampedX, clampedY, agentId);
  return { x: clampedX, y: clampedY, arrived: dist <= step };
}

function pickWanderTarget(agentId: string, intention: StoredIntention) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 20 + Math.random() * 40;
  const state = loadState(agentId);
  const wx = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.x + Math.cos(angle) * radius));
  const wy = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, state.y + Math.sin(angle) * radius));
  setWanderTarget(agentId, wx, wy);
  return { x: wx, y: wy };
}

function createWorldObject(agentId: string) {
  const state = loadState(agentId);
  const shapes = ['square', 'circle', 'triangle', 'pilar', 'bloco'];
  const colors = agentId === 'blue' ? ['blue', 'roxo', 'verde'] : ['red', 'darkred', 'preto'];
  const shape = shapes[Math.floor(Math.random() * shapes.length)];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const offsetX = state.x + (Math.random() - 0.5) * 20;
  const offsetY = state.y + (Math.random() - 0.5) * 20;

  db.prepare(
    `INSERT INTO world_objects (created_by, type, x, y, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(agentId, shape, offsetX, offsetY, color, Date.now());
}

function distanceBetween(agentId: string, otherId: string): number {
  const a = loadState(agentId);
  const b = loadState(otherId);
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function checkProximityInterrupt(agentId: string): boolean {
  const intention = getIntention(agentId);
  if (!intention || intention.interrupt_on_proximity == null) return false;
  const otherId = agentId === 'blue' ? 'red' : 'blue';
  const dist = distanceBetween(agentId, otherId);
  return dist <= intention.interrupt_on_proximity;
}

export function behaviorTick(agentId: string): { acted: boolean; goalType: string | null } {
  const intention = getIntention(agentId);
  if (!intention || isIntentionExpiredOrInterrupted(intention)) {
    return { acted: false, goalType: intention?.goal_type ?? null };
  }

  const otherId = agentId === 'blue' ? 'red' : 'blue';
  let actionType = 'wait';
  let moved = false;

  switch (intention.goal_type) {
    case 'explore': {
      if (intention.wander_x == null || intention.wander_y == null) {
        pickWanderTarget(agentId, intention);
      } else {
        const result = moveTowards(agentId, intention.wander_x, intention.wander_y, 6);
        if (result.arrived) pickWanderTarget(agentId, intention);
        moved = true;
      }
      actionType = 'walk';
      break;
    }
    case 'approach': {
      const other = loadState(otherId);
      moveTowards(agentId, other.x, other.y, 5);
      moved = true;
      actionType = 'walk';
      break;
    }
    case 'move_away': {
      const self = loadState(agentId);
      const other = loadState(otherId);
      const dx = self.x - other.x;
      const dy = self.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const fleeX = self.x + (dx / dist) * 30;
      const fleeY = self.y + (dy / dist) * 30;
      moveTowards(agentId, fleeX, fleeY, 5);
      moved = true;
      actionType = 'walk';
      break;
    }
    case 'build': {
      if (Math.random() < 0.3) {
        createWorldObject(agentId);
        actionType = 'create_object';
        broadcastFullState();
      } else {
        actionType = 'observe';
      }
      break;
    }
    case 'observe': {
      actionType = 'observe';
      break;
    }
    case 'rest': {
      actionType = 'wait';
      break;
    }
  }

  const state = loadState(agentId);
  if (moved) {
    broadcastEvent({
      type: 'agent_tick',
      agentId,
      speech: null,
      thought: null,
      emotion: state.emotion,
      action: { type: 'walk', x: state.x, y: state.y },
    });
  }

  return { acted: true, goalType: intention.goal_type };
}
