import { db } from '../db';

const HP_REGEN_PER_HOUR = 1;
const HUNGER_THRESHOLD_FOR_REGEN = 90;

export function applyHpRegen(agentId: string) {
  const row = db.prepare(`SELECT hp, hunger, last_hp_regen_at, status FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    hp: number; hunger: number; last_hp_regen_at: number; status: string;
  };

  if (row.status === 'dead') return row.hp;

  const now = Date.now();
  const hoursElapsed = (now - row.last_hp_regen_at) / (1000 * 60 * 60);

  if (row.hunger >= HUNGER_THRESHOLD_FOR_REGEN && hoursElapsed >= 1) {
    const hoursToApply = Math.floor(hoursElapsed);
    const newHp = Math.min(100, row.hp + hoursToApply * HP_REGEN_PER_HOUR);
    db.prepare(`UPDATE agent_state SET hp = ?, last_hp_regen_at = ? WHERE agent_id = ?`).run(newHp, now, agentId);
    return newHp;
  }

  if (hoursElapsed >= 1) {
    db.prepare(`UPDATE agent_state SET last_hp_regen_at = ? WHERE agent_id = ?`).run(now, agentId);
  }

  return row.hp;
}

export function describeHpQualitative(hp: number): string {
  if (hp >= 90) return 'Voce se sente fisicamente bem, sem nenhum ferimento ou dor.';
  if (hp >= 60) return 'Voce sente um leve desconforto fisico.';
  if (hp >= 30) return 'Voce sente dor e fraqueza no corpo.';
  return 'Voce se sente gravemente debilitado fisicamente.';
}
