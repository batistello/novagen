import { db } from '../db';

const HP_REGEN_PER_HOUR = 1;
const HUNGER_THRESHOLD_FOR_REGEN = 90;
const HUNGER_CRITICAL_THRESHOLD = 15;
const HP_DRAIN_PER_HOUR_WHEN_CRITICAL = 5;

export function applyHpRegen(agentId: string) {
  const row = db.prepare(`SELECT hp, hunger, last_hp_regen_at, status FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    hp: number; hunger: number; last_hp_regen_at: number; status: string;
  };

  if (row.status === 'dead') return row.hp;

  const now = Date.now();
  const hoursElapsed = (now - row.last_hp_regen_at) / (1000 * 60 * 60);

  if (hoursElapsed < 1) {
    return row.hp;
  }

  const hoursToApply = Math.floor(hoursElapsed);
  let newHp = row.hp;

  if (row.hunger < HUNGER_CRITICAL_THRESHOLD) {
    newHp = Math.max(0, row.hp - hoursToApply * HP_DRAIN_PER_HOUR_WHEN_CRITICAL);
  } else if (row.hunger >= HUNGER_THRESHOLD_FOR_REGEN) {
    newHp = Math.min(100, row.hp + hoursToApply * HP_REGEN_PER_HOUR);
  }

  const newStatus = newHp <= 0 ? 'dead' : row.status;
  db.prepare(`UPDATE agent_state SET hp = ?, last_hp_regen_at = ?, status = ? WHERE agent_id = ?`).run(newHp, now, newStatus, agentId);

  return newHp;
}

export function describeHpQualitative(hp: number): string {
  if (hp >= 90) return 'Voce se sente fisicamente bem, sem nenhum ferimento ou dor.';
  if (hp >= 60) return 'Voce sente um leve desconforto fisico.';
  if (hp >= 30) return 'Voce sente dor e fraqueza no corpo, cada vez mais intensa.';
  return 'Voce se sente gravemente debilitado fisicamente, como se seu corpo estivesse falhando.';
}
