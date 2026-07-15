// Task de cacar lobo — primeiro caso de validacao do padrao de maquina de estados.
// Uma vez iniciada, o codigo controla toda a execucao (perseguir, atacar, coletar)
// sem chamar o LLM de novo, ate a task terminar (sucesso, fuga do alvo, ou interrupcao).

import { db } from '../../db';
import { getNearbyWolves, tryAttackWolf } from '../../agents/wolfSystem';
import { getEquipment } from '../../agents/resourceSystem';
import { getAttackValue } from '../objects/catalog';

export type HuntWolfState = 'seeking' | 'attacking' | 'done' | 'failed' | 'interrupted';

interface AgentTaskRow {
  agent_id: string;
  task_type: string;
  state: string;
  target_id: number | null;
  started_at: number;
  updated_at: number;
  result: string | null;
}

const TASK_TYPE = 'hunt_wolf';
const MAX_TASK_DURATION_MS = 10 * 60 * 1000; // desistir apos 10 minutos sem sucesso

export function startHuntWolfTask(agentId: string, wolfId: number) {
  const now = Date.now();
  db.prepare(`
    INSERT INTO agent_tasks (agent_id, task_type, state, target_id, started_at, updated_at, result)
    VALUES (?, ?, 'seeking', ?, ?, ?, NULL)
    ON CONFLICT(agent_id) DO UPDATE SET
      task_type = excluded.task_type, state = 'seeking', target_id = excluded.target_id,
      started_at = excluded.started_at, updated_at = excluded.updated_at, result = NULL
  `).run(agentId, TASK_TYPE, wolfId, now, now);
}

export function getActiveTask(agentId: string): AgentTaskRow | null {
  const row = db.prepare(`SELECT * FROM agent_tasks WHERE agent_id = ? AND task_type = ?`).get(agentId, TASK_TYPE) as AgentTaskRow | undefined;
  if (!row) return null;
  if (row.state === 'done' || row.state === 'failed' || row.state === 'interrupted') return null;
  return row;
}

export function interruptTask(agentId: string, reason: string) {
  db.prepare(`UPDATE agent_tasks SET state = 'interrupted', result = ?, updated_at = ? WHERE agent_id = ? AND task_type = ?`)
    .run(reason, Date.now(), agentId, TASK_TYPE);
}

function loadAgentPos(agentId: string): { x: number; y: number } {
  const row = db.prepare(`SELECT x, y FROM agent_state WHERE agent_id = ?`).get(agentId) as { x: number; y: number };
  return row;
}

function moveAgentTowards(agentId: string, targetX: number, targetY: number, step: number) {
  const self = loadAgentPos(agentId);
  const dx = targetX - self.x;
  const dy = targetY - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 1) return;
  const moveDist = Math.min(step, dist);
  const newX = self.x + (dx / dist) * moveDist;
  const newY = self.y + (dy / dist) * moveDist;
  db.prepare(`UPDATE agent_state SET x = ?, y = ? WHERE agent_id = ?`).run(newX, newY, agentId);
}

// Chamado a cada tick do mundo para qualquer agente com task de caca ativa.
// Retorna true se a task ainda esta em andamento (nao chamar o LLM),
// false se a task terminou (chamar o LLM de novo).
export function tickHuntWolfTask(agentId: string): boolean {
  const task = getActiveTask(agentId);
  if (!task) return false;

  const now = Date.now();
  if (now - task.started_at > MAX_TASK_DURATION_MS) {
    db.prepare(`UPDATE agent_tasks SET state = 'failed', result = 'tempo esgotado', updated_at = ? WHERE agent_id = ?`).run(now, agentId);
    return false;
  }

  const self = loadAgentPos(agentId);
  const nearbyWolves = getNearbyWolves(self.x, self.y, 80);
  const wolf = nearbyWolves.find(w => w.id === task.target_id);

  if (!wolf) {
    db.prepare(`UPDATE agent_tasks SET state = 'failed', result = 'alvo perdido de vista', updated_at = ? WHERE agent_id = ?`).run(now, agentId);
    return false;
  }

  if (wolf.dist > 12) {
    moveAgentTowards(agentId, wolf.x, wolf.y, 6);
    db.prepare(`UPDATE agent_tasks SET state = 'seeking', updated_at = ? WHERE agent_id = ?`).run(now, agentId);
    return true;
  }

  const equip = getEquipment(agentId);
  const weaponAtk = getAttackValue(equip.hand);
  const result = tryAttackWolf(agentId, self.x, self.y, wolf.id, weaponAtk);

  if (result.success && result.wolfDied) {
    db.prepare(`UPDATE agent_tasks SET state = 'done', result = 'lobo derrotado', updated_at = ? WHERE agent_id = ?`).run(now, agentId);
    return false;
  }

  db.prepare(`UPDATE agent_tasks SET state = 'attacking', updated_at = ? WHERE agent_id = ?`).run(now, agentId);
  return true;
}
