import { db } from '../db';

const RESOURCE_INTERACTION_RADIUS = 15;
const MAX_WATER_DRINKS_PER_DAY = 3;
const WATER_DRINK_HUNGER_RESTORE = 10;

const RESOURCE_TYPES: Record<string, 'wood' | 'stone' | 'water'> = {
  tree: 'wood',
  rock: 'stone',
  water_source: 'water',
};

interface NearbyResource {
  id: number;
  type: string;
  x: number;
  y: number;
  dist: number;
}

export function findNearbyResource(x: number, y: number): NearbyResource | null {
  const resources = db.prepare(
    `SELECT id, type, x, y FROM world_objects WHERE type IN ('tree', 'rock', 'water_source') AND removed_at IS NULL`
  ).all() as { id: number; type: string; x: number; y: number }[];

  let closest: NearbyResource | null = null;
  for (const r of resources) {
    const dist = Math.sqrt((r.x - x) ** 2 + (r.y - y) ** 2);
    if (!closest || dist < closest.dist) {
      closest = { ...r, dist };
    }
  }
  return closest;
}

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function tryGatherResource(agentId: string, x: number, y: number): { success: boolean; resourceType?: string } {
  const nearby = findNearbyResource(x, y);
  if (!nearby || nearby.dist > RESOURCE_INTERACTION_RADIUS) {
    return { success: false };
  }

  const column = RESOURCE_TYPES[nearby.type];
  if (!column) return { success: false };

  db.prepare(`UPDATE agent_state SET ${column} = ${column} + 1 WHERE agent_id = ?`).run(agentId);
  return { success: true, resourceType: column };
}

export function tryDrinkWater(agentId: string, x: number, y: number): { success: boolean; reason?: string } {
  const nearby = findNearbyResource(x, y);
  if (!nearby || nearby.type !== 'water_source' || nearby.dist > RESOURCE_INTERACTION_RADIUS) {
    return { success: false, reason: 'not_near_water' };
  }

  const today = todayKey();
  const row = db.prepare(`SELECT water_drinks_today, water_drinks_date, hunger FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    water_drinks_today: number; water_drinks_date: string | null; hunger: number;
  };

  const drinksToday = row.water_drinks_date === today ? row.water_drinks_today : 0;
  if (drinksToday >= MAX_WATER_DRINKS_PER_DAY) {
    return { success: false, reason: 'limit_reached' };
  }

  const newHunger = Math.min(100, row.hunger + WATER_DRINK_HUNGER_RESTORE);
  db.prepare(`UPDATE agent_state SET hunger = ?, water_drinks_today = ?, water_drinks_date = ? WHERE agent_id = ?`)
    .run(newHunger, drinksToday + 1, today, agentId);

  return { success: true };
}

export function getInventory(agentId: string): { wood: number; stone: number; water: number } {
  const row = db.prepare(`SELECT wood, stone, water FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    wood: number; stone: number; water: number;
  };
  return row;
}

export function consumeForBuild(agentId: string): { success: boolean; used?: string } {
  const inv = getInventory(agentId);
  if (inv.wood > 0) {
    db.prepare(`UPDATE agent_state SET wood = wood - 1 WHERE agent_id = ?`).run(agentId);
    return { success: true, used: 'wood' };
  }
  if (inv.stone > 0) {
    db.prepare(`UPDATE agent_state SET stone = stone - 1 WHERE agent_id = ?`).run(agentId);
    return { success: true, used: 'stone' };
  }
  if (inv.water > 0) {
    db.prepare(`UPDATE agent_state SET water = water - 1 WHERE agent_id = ?`).run(agentId);
    return { success: true, used: 'water' };
  }
  return { success: false };
}
