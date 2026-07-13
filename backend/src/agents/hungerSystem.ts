import { db } from '../db';
import { recordCategorizedMemory } from './memoryTiers';

const HUNGER_FULL_HOURS = 48; // 1 unidade de comida sustenta 48h reais (2 dias)
const FOOD_SLOT_REGEN_HOURS = 24;
export const GRASS_LOCATION = { x: 0, y: 0 };
export const GRASS_INTERACTION_RADIUS = 15;

export function applyHungerDecay(agentId: string): number {
  const row = db.prepare(`SELECT hunger, last_meal_at, status FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    hunger: number; last_meal_at: number; status: string;
  };

  if (row.status === 'dead') return row.hunger;

  const now = Date.now();
  const hoursSinceMeal = (now - row.last_meal_at) / (1000 * 60 * 60);
  const newHunger = Math.max(0, 100 - (hoursSinceMeal / HUNGER_FULL_HOURS) * 100);

  db.prepare(`UPDATE agent_state SET hunger = ? WHERE agent_id = ?`).run(newHunger, agentId);

  if (newHunger <= 0) {
    db.prepare(`UPDATE agent_state SET status = 'dead' WHERE agent_id = ? AND status != 'dead'`).run(agentId);
  }

  return newHunger;
}

function regenerateExpiredSlots() {
  const now = Date.now();
  const cutoff = now - FOOD_SLOT_REGEN_HOURS * 60 * 60 * 1000;
  const expired = db.prepare(`SELECT id, world_object_id FROM food_slots WHERE status = 'consumed' AND consumed_at <= ?`).all(cutoff) as { id: number; world_object_id: number | null }[];
  expired.forEach(slot => {
    db.prepare(`UPDATE food_slots SET status = 'available', consumed_at = NULL WHERE id = ?`).run(slot.id);
    if (slot.world_object_id) {
      db.prepare(`UPDATE world_objects SET removed_at = NULL WHERE id = ?`).run(slot.world_object_id);
    }
  });
}

export function getAvailableFoodCount(): number {
  regenerateExpiredSlots();
  const row = db.prepare(`SELECT COUNT(*) as c FROM food_slots WHERE status = 'available'`).get() as { c: number };
  return row.c;
}

export function tryConsumeFood(agentId: string): boolean {
  regenerateExpiredSlots();
  const slot = db.prepare(`SELECT id, world_object_id FROM food_slots WHERE status = 'available' LIMIT 1`).get() as { id: number; world_object_id: number | null } | undefined;
  if (!slot) return false;

  const now = Date.now();
  db.prepare(`UPDATE food_slots SET status = 'consumed', consumed_at = ? WHERE id = ?`).run(now, slot.id);
  db.prepare(`UPDATE agent_state SET hunger = 100, last_meal_at = ? WHERE agent_id = ?`).run(now, agentId);
  if (slot.world_object_id) {
    db.prepare(`UPDATE world_objects SET removed_at = ? WHERE id = ?`).run(now, slot.world_object_id);
  }

  recordCategorizedMemory(agentId, 'episodic', 'Consumi algo daquela area verde.');

  const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };
  const selfState = db.prepare(`SELECT x, y FROM agent_state WHERE agent_id = ?`).get(agentId) as { x: number; y: number };
  const others = db.prepare(`SELECT agent_id, x, y, status FROM agent_state WHERE agent_id != ? AND status != 'dead'`).all(agentId) as { agent_id: string; x: number; y: number; status: string }[];
  const WITNESS_RADIUS = 60;
  others.forEach(other => {
    const dist = Math.sqrt((other.x - selfState.x) ** 2 + (other.y - selfState.y) ** 2);
    if (dist <= WITNESS_RADIUS) {
      recordCategorizedMemory(other.agent_id, 'social', `Vi ${AGENT_NAMES[agentId] ?? agentId} consumir algo daquela area verde.`, agentId);
    }
  });

  return true;
}

export function isNearGrass(x: number, y: number): boolean {
  const dist = Math.sqrt((x - GRASS_LOCATION.x) ** 2 + (y - GRASS_LOCATION.y) ** 2);
  return dist <= GRASS_INTERACTION_RADIUS;
}
