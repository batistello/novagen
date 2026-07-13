import { db } from '../db';
import { notifyWitnesses } from './memoryTiers';

const HUNGER_FULL_HOURS = 48; // 1 refeicao completa (planta adulta) sustenta 48h reais (2 dias)
export const GRASS_LOCATION = { x: 0, y: 0 };
export const GRASS_INTERACTION_RADIUS = 15;

const STAGE_ORDER = ['seed', 'sprout', 'young', 'adult'] as const;

const STAGE_DURATION_HOURS: Record<string, number> = {
  seed: 4,
  sprout: 6,
  young: 8,
};

const HUNGER_RESTORE_BY_STAGE: Record<string, number> = {
  seed: 15,
  sprout: 35,
  young: 60,
  adult: 100,
};

const REGROW_AFTER_CONSUMED_HOURS = 24;

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };

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

export function growPlants() {
  const now = Date.now();

  const growing = db.prepare(
    `SELECT id, stage, stage_started_at FROM food_slots WHERE status = 'available' AND stage != 'adult'`
  ).all() as { id: number; stage: string; stage_started_at: number }[];

  growing.forEach(plant => {
    const durationHours = STAGE_DURATION_HOURS[plant.stage];
    if (!durationHours) return;
    const elapsedHours = (now - plant.stage_started_at) / (1000 * 60 * 60);
    if (elapsedHours < durationHours) return;

    const currentIdx = STAGE_ORDER.indexOf(plant.stage as typeof STAGE_ORDER[number]);
    const nextStage = STAGE_ORDER[currentIdx + 1];
    if (!nextStage) return;

    db.prepare(`UPDATE food_slots SET stage = ?, stage_started_at = ? WHERE id = ?`).run(nextStage, now, plant.id);
  });

  const consumed = db.prepare(
    `SELECT id, world_object_id, consumed_at FROM food_slots WHERE status = 'consumed' AND consumed_at <= ?`
  ).all(now - REGROW_AFTER_CONSUMED_HOURS * 60 * 60 * 1000) as { id: number; world_object_id: number | null; consumed_at: number }[];

  consumed.forEach(slot => {
    db.prepare(`UPDATE food_slots SET status = 'available', consumed_at = NULL, stage = 'seed', stage_started_at = ? WHERE id = ?`).run(now, slot.id);
    if (slot.world_object_id) {
      db.prepare(`UPDATE world_objects SET removed_at = NULL WHERE id = ?`).run(slot.world_object_id);
    }
  });
}

export function getAvailableFoodCount(): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM food_slots WHERE status = 'available'`).get() as { c: number };
  return row.c;
}

export function tryConsumeFood(agentId: string): boolean {
  const slot = db.prepare(
    `SELECT id, world_object_id, stage FROM food_slots WHERE status = 'available' ORDER BY
      CASE stage WHEN 'adult' THEN 0 WHEN 'young' THEN 1 WHEN 'sprout' THEN 2 ELSE 3 END
      LIMIT 1`
  ).get() as { id: number; world_object_id: number | null; stage: string } | undefined;

  if (!slot) return false;

  const now = Date.now();
  const restoreAmount = HUNGER_RESTORE_BY_STAGE[slot.stage] ?? 50;

  const currentState = db.prepare(`SELECT hunger FROM agent_state WHERE agent_id = ?`).get(agentId) as { hunger: number };
  const newHunger = Math.min(100, currentState.hunger + restoreAmount);

  db.prepare(`UPDATE food_slots SET status = 'consumed', consumed_at = ? WHERE id = ?`).run(now, slot.id);
  db.prepare(`UPDATE agent_state SET hunger = ?, last_meal_at = ? WHERE agent_id = ?`).run(newHunger, now, agentId);
  if (slot.world_object_id) {
    db.prepare(`UPDATE world_objects SET removed_at = ? WHERE id = ?`).run(now, slot.world_object_id);
  }

  const self = db.prepare(`SELECT x, y FROM agent_state WHERE agent_id = ?`).get(agentId) as { x: number; y: number };
  const stageDescription = slot.stage === 'adult' ? 'bem desenvolvida' : slot.stage === 'young' ? 'ainda jovem' : 'muito pequena e imatura';

  notifyWitnesses(
    agentId, self.x, self.y,
    `Consumi algo daquela area verde. Estava ${stageDescription}, e a sensacao de vazio diminuiu ${slot.stage === 'adult' ? 'bastante' : 'um pouco'}.`,
    (name) => `Vi ${name} consumir algo daquela area verde.`
  );

  const firstMealKey = `first_meal_${agentId}`;
  const alreadyLogged = db.prepare(`SELECT key FROM world_meta WHERE key = ?`).get(firstMealKey);
  if (!alreadyLogged) {
    db.prepare(`INSERT INTO world_meta (key, value) VALUES (?, ?)`).run(firstMealKey, String(now));
    const { recordDiaryEntry } = require('./worldDiary');
    recordDiaryEntry(`Foi consumido o primeiro alimento por ${AGENT_NAMES[agentId] ?? agentId}.`, 'ALIMENTACAO');
  }

  return true;
}

export function isNearGrass(x: number, y: number): boolean {
  const dist = Math.sqrt((x - GRASS_LOCATION.x) ** 2 + (y - GRASS_LOCATION.y) ** 2);
  return dist <= GRASS_INTERACTION_RADIUS;
}

export function describeHungerQualitative(hunger: number): string {
  if (hunger >= 85) return 'Voce nao sente fome alguma no momento.';
  if (hunger >= 60) return 'Voce sente uma leve fome, mas nada urgente.';
  if (hunger >= 35) return 'Voce sente uma fome moderada, incomodando de vez em quando.';
  if (hunger >= 15) return 'Voce sente uma fome forte e persistente.';
  return 'Voce sente uma fome extrema, quase insuportavel.';
}

export function describeEnergyQualitative(energy: number): string {
  if (energy >= 85) return 'Voce se sente com bastante disposicao.';
  if (energy >= 60) return 'Voce se sente razoavelmente disposto.';
  if (energy >= 35) return 'Voce se sente um pouco cansado.';
  if (energy >= 15) return 'Voce se sente bastante cansado.';
  return 'Voce se sente exausto, quase sem forcas.';
}

export function describePlantStage(stage: string): string {
  switch (stage) {
    case 'seed': return 'um pontinho quase imperceptivel no chao';
    case 'sprout': return 'um broto pequeno e fragil';
    case 'young': return 'uma planta ainda pequena, crescendo';
    case 'adult': return 'uma planta bem desenvolvida';
    default: return 'algo verde no chao';
  }
}
