import { db } from '../db';

const WORLD_HALF = 150;
const RODENT_LIFESPAN_HOURS = 24;
const RODENT_SPAWN_PER_DAY = 2;
const RODENT_MOVE_STEP = 5;
const RODENT_EAT_RADIUS = 10;

const WOLF_HUNGER_FULL_HOURS = 24;
const WOLF_HUNGER_RESTORE_PER_RODENT = 100;
const WOLF_STARVE_HP_LOSS_PER_HOUR = 3;
const WOLF_HUNGER_CRITICAL = 15;

interface Rodent {
  id: number;
  x: number;
  y: number;
  status: string;
  spawned_at: number;
  last_move_at: number | null;
}

export function getAliveRodents(): Rodent[] {
  return db.prepare(`SELECT * FROM rodents WHERE status = 'alive'`).all() as Rodent[];
}

function handleRodentAging() {
  const now = Date.now();
  const cutoff = now - RODENT_LIFESPAN_HOURS * 60 * 60 * 1000;
  db.prepare(`UPDATE rodents SET status = 'dead' WHERE status = 'alive' AND spawned_at <= ?`).run(cutoff);
}

function handleRodentSpawn() {
  const now = Date.now();
  const row = db.prepare(`SELECT value FROM world_meta WHERE key = 'rodent_last_spawn_at'`).get() as { value: string } | undefined;
  const isFirstRun = !row;
  const lastSpawnAt = row ? parseInt(row.value, 10) : now;
  const hoursSince = (now - lastSpawnAt) / (60 * 60 * 1000);
  const spawnIntervalHours = 24 / RODENT_SPAWN_PER_DAY;

  if (isFirstRun || hoursSince >= spawnIntervalHours) {
    const x = (Math.random() - 0.5) * WORLD_HALF * 2;
    const y = (Math.random() - 0.5) * WORLD_HALF * 2;
    db.prepare(`INSERT INTO rodents (x, y, status, spawned_at, last_move_at) VALUES (?, ?, 'alive', ?, ?)`).run(x, y, now, now);
    db.prepare(`INSERT OR REPLACE INTO world_meta (key, value) VALUES ('rodent_last_spawn_at', ?)`).run(String(now));
  }
}

function handleRodentMovement() {
  const rodents = getAliveRodents();
  rodents.forEach(r => {
    const angle = Math.random() * Math.PI * 2;
    const newX = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, r.x + Math.cos(angle) * RODENT_MOVE_STEP));
    const newY = Math.max(-WORLD_HALF, Math.min(WORLD_HALF, r.y + Math.sin(angle) * RODENT_MOVE_STEP));
    db.prepare(`UPDATE rodents SET x = ?, y = ?, last_move_at = ? WHERE id = ?`).run(newX, newY, Date.now(), r.id);
  });
}

export function tickRodents() {
  handleRodentAging();
  handleRodentSpawn();
  handleRodentMovement();
  handleRodentTreeConsumption();

  const { broadcastEvent } = require('../ws/server');
  const currentRodents = db.prepare(`SELECT id, x, y, status FROM rodents WHERE status = 'alive'`).all();
  broadcastEvent({ type: 'rodent_positions', rodents: currentRodents });
}

export function applyWolfHunger(wolfId: number) {
  const wolf = db.prepare(`SELECT hunger, last_hunger_decay_at, hp, status FROM wolves WHERE id = ?`).get(wolfId) as {
    hunger: number; last_hunger_decay_at: number; hp: number; status: string;
  } | undefined;

  if (!wolf || wolf.status !== 'alive') return;

  const now = Date.now();
  const hoursSince = (now - wolf.last_hunger_decay_at) / (60 * 60 * 1000);
  const newHunger = Math.max(0, wolf.hunger - (hoursSince / WOLF_HUNGER_FULL_HOURS) * 100);

  let newHp = wolf.hp;
  if (newHunger < WOLF_HUNGER_CRITICAL) {
    newHp = Math.max(0, wolf.hp - hoursSince * WOLF_STARVE_HP_LOSS_PER_HOUR);
  }

  const newStatus = newHp <= 0 ? 'dead' : 'alive';
  db.prepare(`UPDATE wolves SET hunger = ?, hp = ?, status = ?, last_hunger_decay_at = ? WHERE id = ?`)
    .run(newHunger, newHp, newStatus, now, wolfId);
}

export function tryWolfEatRodent(wolfId: number, wolfX: number, wolfY: number): boolean {
  const rodents = getAliveRodents();
  const nearby = rodents.find(r => Math.sqrt((r.x - wolfX) ** 2 + (r.y - wolfY) ** 2) <= RODENT_EAT_RADIUS);
  if (!nearby) return false;

  db.prepare(`UPDATE rodents SET status = 'dead' WHERE id = ?`).run(nearby.id);

  const wolf = db.prepare(`SELECT hunger FROM wolves WHERE id = ?`).get(wolfId) as { hunger: number };
  const newHunger = Math.min(100, wolf.hunger + WOLF_HUNGER_RESTORE_PER_RODENT);
  db.prepare(`UPDATE wolves SET hunger = ? WHERE id = ?`).run(newHunger, wolfId);

  const { recordDiaryEntry } = require('./worldDiary');
  recordDiaryEntry('Um pequeno animal foi devorado por um predador.', 'CONFLITO');

  return true;
}

const TREE_EAT_RADIUS = 15;
const TREE_EAT_INTERVAL_HOURS = 24;

export function handleRodentTreeConsumption() {
  const rodents = getAliveRodents();
  const trees = db.prepare(`SELECT world_object_id, wood_stock, last_rodent_eat_at FROM tree_resources WHERE status = 'available'`).all() as
    { world_object_id: number; wood_stock: number; last_rodent_eat_at: number | null }[];
  const treePositions = db.prepare(`SELECT id, x, y FROM world_objects WHERE type = 'tree' AND removed_at IS NULL`).all() as
    { id: number; x: number; y: number }[];

  const now = Date.now();

  trees.forEach(tree => {
    const pos = treePositions.find(t => t.id === tree.world_object_id);
    if (!pos) return;

    const nearbyRodent = rodents.find(r => Math.sqrt((r.x - pos.x) ** 2 + (r.y - pos.y) ** 2) <= TREE_EAT_RADIUS);
    if (!nearbyRodent) return;

    const hoursSince = tree.last_rodent_eat_at ? (now - tree.last_rodent_eat_at) / (60 * 60 * 1000) : Infinity;
    if (hoursSince < TREE_EAT_INTERVAL_HOURS) return;

    const newStock = tree.wood_stock - 1;
    if (newStock <= 0) {
      db.prepare(`UPDATE tree_resources SET wood_stock = 0, status = 'consumed', consumed_at = ?, last_rodent_eat_at = ? WHERE world_object_id = ?`)
        .run(now, now, tree.world_object_id);
      const { recordDiaryEntry } = require('./worldDiary');
      recordDiaryEntry('Uma arvore foi completamente consumida por roedores.', 'OUTRO');
    } else {
      db.prepare(`UPDATE tree_resources SET wood_stock = ?, last_rodent_eat_at = ? WHERE world_object_id = ?`)
        .run(newStock, now, tree.world_object_id);
    }
  });
}

export function tryHuntRodent(agentId: string, agentX: number, agentY: number, rodentId: number): { success: boolean } {
  const rodent = db.prepare(`SELECT id, x, y FROM rodents WHERE id = ? AND status = 'alive'`).get(rodentId) as { id: number; x: number; y: number } | undefined;
  if (!rodent) return { success: false };

  const dist = Math.sqrt((rodent.x - agentX) ** 2 + (rodent.y - agentY) ** 2);
  if (dist > RODENT_EAT_RADIUS) return { success: false };

  db.prepare(`UPDATE rodents SET status = 'dead' WHERE id = ?`).run(rodent.id);
  db.prepare(`
    INSERT INTO agent_items (agent_id, item_key, quantity) VALUES (?, 'carne', 1)
    ON CONFLICT(agent_id, item_key) DO UPDATE SET quantity = quantity + 1
  `).run(agentId);

  return { success: true };
}
