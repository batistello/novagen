import { db } from '../db';
import { recordDiaryEntry } from './worldDiary';
import { markIntentionInterrupted } from './intentionStore';
import { applyWolfHunger, tryWolfEatRodent, getAliveRodents } from './rodentSystem';

const WOLF_TERRITORY = { xMin: -150, xMax: 0, yMin: 0, yMax: 150 };
const WOLF_LEASH_BUFFER = 30;
const WOLF_LEASH = {
  xMin: WOLF_TERRITORY.xMin - WOLF_LEASH_BUFFER,
  xMax: WOLF_TERRITORY.xMax + WOLF_LEASH_BUFFER,
  yMin: WOLF_TERRITORY.yMin - WOLF_LEASH_BUFFER,
  yMax: WOLF_TERRITORY.yMax + WOLF_LEASH_BUFFER,
};
const WOLF_TERRITORY_CENTER = {
  x: (WOLF_TERRITORY.xMin + WOLF_TERRITORY.xMax) / 2,
  y: (WOLF_TERRITORY.yMin + WOLF_TERRITORY.yMax) / 2,
};
const WOLF_CHASE_RADIUS = 45;

function clampToLeash(x: number, y: number) {
  return {
    x: Math.max(WOLF_LEASH.xMin, Math.min(WOLF_LEASH.xMax, x)),
    y: Math.max(WOLF_LEASH.yMin, Math.min(WOLF_LEASH.yMax, y)),
  };
}
const WOLF_ATTACK_RADIUS = 12;
const WOLF_ATTACK_COOLDOWN_MS = 15_000;
const WOLF_MOVE_STEP = 4;
const WOLF_LIFESPAN_DAYS = 10;
const WOLF_GROWTH_INTERVAL_DAYS = 7;

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };

interface Wolf {
  id: number;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  atk: number;
  status: string;
  last_move_at: number | null;
  last_attack_at: number | null;
  spawned_at: number;
}

function isInTerritory(x: number, y: number): boolean {
  return x >= WOLF_TERRITORY.xMin && x <= WOLF_TERRITORY.xMax && y >= WOLF_TERRITORY.yMin && y <= WOLF_TERRITORY.yMax;
}

function clampToTerritory(x: number, y: number) {
  return {
    x: Math.max(WOLF_TERRITORY.xMin, Math.min(WOLF_TERRITORY.xMax, x)),
    y: Math.max(WOLF_TERRITORY.yMin, Math.min(WOLF_TERRITORY.yMax, y)),
  };
}

export function getAliveWolves(): Wolf[] {
  return db.prepare(`SELECT * FROM wolves WHERE status = 'alive'`).all() as Wolf[];
}

export function getNearbyWolves(x: number, y: number, radius: number): (Wolf & { dist: number })[] {
  return getAliveWolves()
    .map(w => ({ ...w, dist: Math.sqrt((w.x - x) ** 2 + (w.y - y) ** 2) }))
    .filter(w => w.dist <= radius);
}

function handleAging() {
  const now = Date.now();
  const cutoff = now - WOLF_LIFESPAN_DAYS * 24 * 60 * 60 * 1000;
  const old = db.prepare(`SELECT id, x, y FROM wolves WHERE status = 'alive' AND spawned_at <= ?`).all(cutoff) as { id: number; x: number; y: number }[];
  old.forEach(w => {
    db.prepare(`UPDATE wolves SET status = 'dead' WHERE id = ?`).run(w.id);
    const { recordWorldEvent } = require('../world/events/worldEvents');
    recordWorldEvent('wolf_died', 'Um predador morreu de velhice por perto.', w.x, w.y);
  });
}

function handleGrowth() {
  const now = Date.now();
  const row = db.prepare(`SELECT value FROM world_meta WHERE key = 'wolf_last_spawn_at'`).get() as { value: string } | undefined;
  const lastSpawnAt = row ? parseInt(row.value, 10) : now;
  const daysSince = (now - lastSpawnAt) / (24 * 60 * 60 * 1000);

  if (daysSince >= WOLF_GROWTH_INTERVAL_DAYS) {
    const x = WOLF_TERRITORY.xMin + Math.random() * (WOLF_TERRITORY.xMax - WOLF_TERRITORY.xMin);
    const y = WOLF_TERRITORY.yMin + Math.random() * (WOLF_TERRITORY.yMax - WOLF_TERRITORY.yMin);
    db.prepare(`INSERT INTO wolves (x, y, hp, max_hp, atk, status, last_move_at, spawned_at) VALUES (?, ?, 20, 20, 5, 'alive', ?, ?)`)
      .run(x, y, now, now);
    db.prepare(`INSERT OR REPLACE INTO world_meta (key, value) VALUES ('wolf_last_spawn_at', ?)`).run(String(now));
  }
}

export function tickWolves() {
  handleAging();
  handleGrowth();

  const wolves = getAliveWolves();
  const agents = db.prepare(`SELECT agent_id, x, y, hp, status FROM agent_state WHERE status != 'dead'`).all() as
    { agent_id: string; x: number; y: number; hp: number; status: string }[];

  wolves.forEach(wolf => {
    applyWolfHunger(wolf.id);
    const freshWolf = db.prepare(`SELECT hunger, hp, status FROM wolves WHERE id = ?`).get(wolf.id) as { hunger: number; hp: number; status: string };
    if (freshWolf.status !== 'alive') return;

    if (freshWolf.hunger < 60) {
      const ate = tryWolfEatRodent(wolf.id, wolf.x, wolf.y);
      if (!ate) {
        const rodents = getAliveRodents();
        let closestRodent: { x: number; y: number } | null = null;
        let closestRodentDist = Infinity;
        rodents.forEach(r => {
          const d = Math.sqrt((r.x - wolf.x) ** 2 + (r.y - wolf.y) ** 2);
          if (d < closestRodentDist) {
            closestRodentDist = d;
            closestRodent = r;
          }
        });
        if (closestRodent && closestRodentDist <= 60) {
          const target = closestRodent as { x: number; y: number };
          const dx = target.x - wolf.x;
          const dy = target.y - wolf.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const moved = clampToLeash(wolf.x + (dx / dist) * WOLF_MOVE_STEP, wolf.y + (dy / dist) * WOLF_MOVE_STEP);
          db.prepare(`UPDATE wolves SET x = ?, y = ?, last_move_at = ? WHERE id = ?`).run(moved.x, moved.y, Date.now(), wolf.id);
          return;
        }
      }
    }

    let closestAgent: { agent_id: string; x: number; y: number; hp: number } | null = null;
    let closestDist = Infinity;
    agents.forEach(a => {
      const d = Math.sqrt((a.x - wolf.x) ** 2 + (a.y - wolf.y) ** 2);
      if (d < closestDist) {
        closestDist = d;
        closestAgent = a;
      }
    });

    const wolfIsHome = isInTerritory(wolf.x, wolf.y);
    const targetIsReachable = closestAgent != null && closestDist <= WOLF_CHASE_RADIUS && (wolfIsHome || isInTerritory((closestAgent as any).x, (closestAgent as any).y) || closestDist <= WOLF_LEASH_BUFFER);

    if (!targetIsReachable) {
      closestAgent = null;
    }

    if (!closestAgent && !wolfIsHome) {
      const dx = WOLF_TERRITORY_CENTER.x - wolf.x;
      const dy = WOLF_TERRITORY_CENTER.y - wolf.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const moved = clampToLeash(wolf.x + (dx / dist) * WOLF_MOVE_STEP, wolf.y + (dy / dist) * WOLF_MOVE_STEP);
      db.prepare(`UPDATE wolves SET x = ?, y = ?, last_move_at = ? WHERE id = ?`).run(moved.x, moved.y, Date.now(), wolf.id);
      return;
    }

    if (closestAgent && closestDist <= WOLF_ATTACK_RADIUS) {
      const now = Date.now();
      const lastAttack = wolf.last_attack_at || 0;
      if (now - lastAttack >= WOLF_ATTACK_COOLDOWN_MS) {
        const target = closestAgent as { agent_id: string; x: number; y: number; hp: number };
        const newHp = Math.max(0, target.hp - wolf.atk);
        const newStatus = newHp <= 0 ? 'dead' : 'awake';
        db.prepare(`UPDATE agent_state SET hp = ?, status = ? WHERE agent_id = ?`).run(newHp, newStatus, target.agent_id);
        db.prepare(`UPDATE wolves SET last_attack_at = ? WHERE id = ?`).run(now, wolf.id);

        if (newStatus === 'dead') {
          const alreadyMarked = db.prepare(`SELECT id FROM world_objects WHERE type = 'corpse' AND created_by = ? LIMIT 1`).get(target.agent_id);
          if (!alreadyMarked) {
            const AGENT_COLORS_LOCAL: Record<string, string> = { blue: '#3498db', red: '#e74c3c', green: '#2ecc71' };
            db.prepare(`INSERT INTO world_objects (created_by, type, x, y, color, label, created_at) VALUES (?, 'corpse', ?, ?, ?, ?, ?)`)
              .run(target.agent_id, target.x, target.y, AGENT_COLORS_LOCAL[target.agent_id] ?? '#888', `restos de ${AGENT_NAMES[target.agent_id] ?? target.agent_id}`, now);
            recordDiaryEntry(`${AGENT_NAMES[target.agent_id] ?? target.agent_id} foi morto por um predador em seu territorio.`, 'CONFLITO');
          }
        } else {
          markIntentionInterrupted(target.agent_id);
        }
      }
      return;
    }

    if (closestAgent && closestDist <= 40) {
      const target = closestAgent as { agent_id: string; x: number; y: number };
      const dx = target.x - wolf.x;
      const dy = target.y - wolf.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const moved = clampToTerritory(wolf.x + (dx / dist) * WOLF_MOVE_STEP, wolf.y + (dy / dist) * WOLF_MOVE_STEP);
      db.prepare(`UPDATE wolves SET x = ?, y = ?, last_move_at = ? WHERE id = ?`).run(moved.x, moved.y, Date.now(), wolf.id);
      return;
    }

    const angle = Math.random() * Math.PI * 2;
    const moved = clampToTerritory(wolf.x + Math.cos(angle) * WOLF_MOVE_STEP, wolf.y + Math.sin(angle) * WOLF_MOVE_STEP);
    db.prepare(`UPDATE wolves SET x = ?, y = ?, last_move_at = ? WHERE id = ?`).run(moved.x, moved.y, Date.now(), wolf.id);
  });

  const { broadcastEvent } = require('../ws/server');
  const currentWolves = db.prepare(`SELECT id, x, y, hp, max_hp, status FROM wolves WHERE status = 'alive'`).all();
  broadcastEvent({ type: 'wolf_positions', wolves: currentWolves });
}

export function tryAttackWolf(agentId: string, agentX: number, agentY: number, wolfId: number, damage: number): { success: boolean; wolfDied?: boolean } {
  const wolf = db.prepare(`SELECT * FROM wolves WHERE id = ? AND status = 'alive'`).get(wolfId) as Wolf | undefined;
  if (!wolf) return { success: false };

  const dist = Math.sqrt((wolf.x - agentX) ** 2 + (wolf.y - agentY) ** 2);
  if (dist > WOLF_ATTACK_RADIUS) return { success: false };

  const newHp = Math.max(0, wolf.hp - damage);
  const newStatus = newHp <= 0 ? 'dead' : 'alive';
  db.prepare(`UPDATE wolves SET hp = ?, status = ? WHERE id = ?`).run(newHp, newStatus, wolfId);

  if (newStatus === 'dead') {
    db.prepare(`
      INSERT INTO agent_items (agent_id, item_key, quantity) VALUES (?, 'couro', 1)
      ON CONFLICT(agent_id, item_key) DO UPDATE SET quantity = quantity + 1
    `).run(agentId);
    db.prepare(`UPDATE agent_state SET hunger = MIN(100, hunger + 30) WHERE agent_id = ?`).run(agentId);
    recordDiaryEntry(`${AGENT_NAMES[agentId] ?? agentId} derrotou um predador.`, 'OUTRO');
    return { success: true, wolfDied: true };
  }

  return { success: true, wolfDied: false };
}
