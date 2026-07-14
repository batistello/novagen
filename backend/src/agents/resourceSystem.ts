import { db } from '../db';

const RESOURCE_INTERACTION_RADIUS = 15;
const MAX_WATER_DRINKS_PER_DAY = 3;
const WATER_DRINK_HUNGER_RESTORE = 10;

const TREE_STAGE_ORDER = ['broto', 'pequena', 'jovem', 'adulta'] as const;
const TREE_STAGE_DURATION_HOURS: Record<string, number> = { broto: 24, pequena: 24, jovem: 24 };
const TREE_YIELD: Record<string, { amount: number; resource: 'fiber' | 'wood' }> = {
  broto: { amount: 1, resource: 'fiber' },
  pequena: { amount: 2, resource: 'wood' },
  jovem: { amount: 4, resource: 'wood' },
  adulta: { amount: 6, resource: 'wood' },
};
const TREE_REGROW_AFTER_HOURS = 24;
const ROCK_REGROW_AFTER_HOURS = 24;
const FISH_STAGE_DURATION_HOURS = 24;
const FISH_HUNGER_RESTORE: Record<string, number> = { pequeno: 20, grande: 50 };
const FISH_REGROW_AFTER_HOURS = 24;

export const RECIPES: Record<string, { wood?: number; stone?: number; fiber?: number; corda?: number; kind: 'tool' | 'structure' }> = {
  corda: { fiber: 3, kind: 'tool' },
  vara_pesca: { wood: 2, corda: 1, kind: 'tool' },
  harpao: { wood: 2, stone: 1, kind: 'tool' },
  faca: { wood: 1, stone: 1, kind: 'tool' },
  machado: { wood: 2, stone: 2, kind: 'tool' },
  lanca: { wood: 3, stone: 1, kind: 'tool' },
  tocha: { wood: 1, fiber: 1, kind: 'tool' },
  cesto: { fiber: 4, kind: 'tool' },
  cerca: { wood: 5, kind: 'structure' },
  muro_pedra: { stone: 5, kind: 'structure' },
  telhado_pedra: { stone: 4, wood: 2, kind: 'structure' },
};

interface NearbyResource {
  id: number;
  type: string;
  x: number;
  y: number;
  dist: number;
}

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
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

// Faz arvores, pedras e peixes evoluirem/regenerarem sozinhos, independente de qualquer agente
export function growResources() {
  const now = Date.now();

  const growingTrees = db.prepare(
    `SELECT world_object_id, stage, stage_started_at FROM tree_resources WHERE status = 'available' AND stage != 'adulta'`
  ).all() as { world_object_id: number; stage: string; stage_started_at: number }[];

  growingTrees.forEach(t => {
    const durationHours = TREE_STAGE_DURATION_HOURS[t.stage];
    if (!durationHours) return;
    const elapsedHours = (now - t.stage_started_at) / (1000 * 60 * 60);
    if (elapsedHours < durationHours) return;
    const idx = TREE_STAGE_ORDER.indexOf(t.stage as typeof TREE_STAGE_ORDER[number]);
    const next = TREE_STAGE_ORDER[idx + 1];
    if (!next) return;
    db.prepare(`UPDATE tree_resources SET stage = ?, stage_started_at = ? WHERE world_object_id = ?`).run(next, now, t.world_object_id);
  });

  const consumedTrees = db.prepare(
    `SELECT world_object_id FROM tree_resources WHERE status = 'consumed' AND consumed_at <= ?`
  ).all(now - TREE_REGROW_AFTER_HOURS * 60 * 60 * 1000) as { world_object_id: number }[];
  consumedTrees.forEach(t => {
    db.prepare(`UPDATE tree_resources SET status = 'available', consumed_at = NULL, stage = 'broto', stage_started_at = ? WHERE world_object_id = ?`).run(now, t.world_object_id);
  });

  const consumedRocks = db.prepare(
    `SELECT world_object_id FROM rock_resources WHERE status = 'consumed' AND consumed_at <= ?`
  ).all(now - ROCK_REGROW_AFTER_HOURS * 60 * 60 * 1000) as { world_object_id: number }[];
  consumedRocks.forEach(r => {
    db.prepare(`UPDATE rock_resources SET status = 'available', consumed_at = NULL WHERE world_object_id = ?`).run(r.world_object_id);
  });

  const growingFish = db.prepare(
    `SELECT id, stage, stage_started_at FROM fish_slots WHERE status = 'available' AND stage = 'pequeno'`
  ).all() as { id: number; stage: string; stage_started_at: number }[];
  growingFish.forEach(f => {
    const elapsedHours = (now - f.stage_started_at) / (1000 * 60 * 60);
    if (elapsedHours >= FISH_STAGE_DURATION_HOURS) {
      db.prepare(`UPDATE fish_slots SET stage = 'grande', stage_started_at = ? WHERE id = ?`).run(now, f.id);
    }
  });

  const consumedFish = db.prepare(
    `SELECT id, water_object_id FROM fish_slots WHERE status = 'consumed' AND consumed_at <= ?`
  ).all(now - FISH_REGROW_AFTER_HOURS * 60 * 60 * 1000) as { id: number; water_object_id: number }[];
  consumedFish.forEach(f => {
    db.prepare(`UPDATE fish_slots SET status = 'available', consumed_at = NULL, stage = 'pequeno', stage_started_at = ? WHERE id = ?`).run(now, f.id);
  });
}

export function tryGatherResource(agentId: string, x: number, y: number): { success: boolean; resourceType?: string; amount?: number } {
  const nearby = findNearbyResource(x, y);
  if (!nearby || nearby.dist > RESOURCE_INTERACTION_RADIUS) return { success: false };

  if (nearby.type === 'tree') {
    const tree = db.prepare(`SELECT stage, status FROM tree_resources WHERE world_object_id = ?`).get(nearby.id) as { stage: string; status: string } | undefined;
    if (!tree || tree.status !== 'available') return { success: false };
    const yieldInfo = TREE_YIELD[tree.stage];
    if (!yieldInfo) return { success: false };

    db.prepare(`UPDATE tree_resources SET status = 'consumed', consumed_at = ? WHERE world_object_id = ?`).run(Date.now(), nearby.id);
    db.prepare(`UPDATE agent_state SET ${yieldInfo.resource} = ${yieldInfo.resource} + ? WHERE agent_id = ?`).run(yieldInfo.amount, agentId);
    return { success: true, resourceType: yieldInfo.resource, amount: yieldInfo.amount };
  }

  if (nearby.type === 'rock') {
    const rock = db.prepare(`SELECT status FROM rock_resources WHERE world_object_id = ?`).get(nearby.id) as { status: string } | undefined;
    if (!rock || rock.status !== 'available') return { success: false };

    db.prepare(`UPDATE rock_resources SET status = 'consumed', consumed_at = ? WHERE world_object_id = ?`).run(Date.now(), nearby.id);
    db.prepare(`UPDATE agent_state SET stone = stone + 1 WHERE agent_id = ?`).run(agentId);
    return { success: true, resourceType: 'stone', amount: 1 };
  }

  return { success: false };
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
  if (drinksToday >= MAX_WATER_DRINKS_PER_DAY) return { success: false, reason: 'limit_reached' };

  const newHunger = Math.min(100, row.hunger + WATER_DRINK_HUNGER_RESTORE);
  db.prepare(`UPDATE agent_state SET hunger = ?, water_drinks_today = ?, water_drinks_date = ? WHERE agent_id = ?`)
    .run(newHunger, drinksToday + 1, today, agentId);

  return { success: true };
}

export function tryFish(agentId: string, x: number, y: number): { success: boolean; reason?: string; stage?: string } {
  const nearby = findNearbyResource(x, y);
  if (!nearby || nearby.type !== 'water_source' || nearby.dist > RESOURCE_INTERACTION_RADIUS) {
    return { success: false, reason: 'not_near_water' };
  }

  const harpoon = getItemQuantity(agentId, 'harpao');
  if (harpoon <= 0) return { success: false, reason: 'no_harpoon' };

  const slot = db.prepare(`SELECT id, stage FROM fish_slots WHERE water_object_id = ? AND status = 'available'`).get(nearby.id) as { id: number; stage: string } | undefined;
  if (!slot) return { success: false, reason: 'no_fish' };

  const restore = FISH_HUNGER_RESTORE[slot.stage] ?? 20;
  const currentState = db.prepare(`SELECT hunger FROM agent_state WHERE agent_id = ?`).get(agentId) as { hunger: number };
  const newHunger = Math.min(100, currentState.hunger + restore);

  db.prepare(`UPDATE fish_slots SET status = 'consumed', consumed_at = ? WHERE id = ?`).run(Date.now(), slot.id);
  db.prepare(`UPDATE agent_state SET hunger = ? WHERE agent_id = ?`).run(newHunger, agentId);

  return { success: true, stage: slot.stage };
}

export function getInventory(agentId: string): { wood: number; stone: number; water: number; fiber: number } {
  const row = db.prepare(`SELECT wood, stone, water, fiber FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    wood: number; stone: number; water: number; fiber: number;
  };
  return row;
}

export function getItemQuantity(agentId: string, itemKey: string): number {
  const row = db.prepare(`SELECT quantity FROM agent_items WHERE agent_id = ? AND item_key = ?`).get(agentId, itemKey) as { quantity: number } | undefined;
  return row?.quantity ?? 0;
}

export function getAllItems(agentId: string): { item_key: string; quantity: number }[] {
  return db.prepare(`SELECT item_key, quantity FROM agent_items WHERE agent_id = ? AND quantity > 0`).all(agentId) as { item_key: string; quantity: number }[];
}

function addItem(agentId: string, itemKey: string, amount: number) {
  db.prepare(`
    INSERT INTO agent_items (agent_id, item_key, quantity) VALUES (?, ?, ?)
    ON CONFLICT(agent_id, item_key) DO UPDATE SET quantity = quantity + excluded.quantity
  `).run(agentId, itemKey, amount);
}

export function tryCraft(agentId: string, itemKey: string): { success: boolean; reason?: string } {
  const recipe = RECIPES[itemKey];
  if (!recipe) return { success: false, reason: 'unknown_recipe' };

  const inv = getInventory(agentId);
  const corda = getItemQuantity(agentId, 'corda');

  if ((recipe.wood ?? 0) > inv.wood) return { success: false, reason: 'sem_madeira' };
  if ((recipe.stone ?? 0) > inv.stone) return { success: false, reason: 'sem_pedra' };
  if ((recipe.fiber ?? 0) > inv.fiber) return { success: false, reason: 'sem_fibra' };
  if ((recipe.corda ?? 0) > corda) return { success: false, reason: 'sem_corda' };

  if (recipe.wood) db.prepare(`UPDATE agent_state SET wood = wood - ? WHERE agent_id = ?`).run(recipe.wood, agentId);
  if (recipe.stone) db.prepare(`UPDATE agent_state SET stone = stone - ? WHERE agent_id = ?`).run(recipe.stone, agentId);
  if (recipe.fiber) db.prepare(`UPDATE agent_state SET fiber = fiber - ? WHERE agent_id = ?`).run(recipe.fiber, agentId);
  if (recipe.corda) addItem(agentId, 'corda', -recipe.corda);

  if (recipe.kind === 'tool') {
    addItem(agentId, itemKey, 1);
  }

  return { success: true };
}

// Mantido por compatibilidade com o codigo antigo de build generico (fallback quando nao ha receita estruturada)
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
