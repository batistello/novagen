// Fila de tasks — permite ao agente enfileirar, cancelar, priorizar e reordenar tarefas.
// Hoje so existe um tipo real de task executavel (hunt_wolf), entao a fila serve
// principalmente como infraestrutura pronta para quando novos tipos de task existirem.

import { db } from '../../db';

export interface QueuedTask {
  id: number;
  agent_id: string;
  task_type: string;
  target_id: number | null;
  priority: number;
  status: string;
  created_at: number;
}

export function enqueueTask(agentId: string, taskType: string, targetId: number | null, priority: number = 0) {
  db.prepare(`
    INSERT INTO agent_task_queue (agent_id, task_type, target_id, priority, status, created_at)
    VALUES (?, ?, ?, ?, 'queued', ?)
  `).run(agentId, taskType, targetId, priority, Date.now());
}

export function getNextQueuedTask(agentId: string): QueuedTask | null {
  const row = db.prepare(`
    SELECT * FROM agent_task_queue
    WHERE agent_id = ? AND status = 'queued'
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(agentId) as QueuedTask | undefined;
  return row ?? null;
}

export function markTaskAsStarted(taskId: number) {
  db.prepare(`UPDATE agent_task_queue SET status = 'in_progress' WHERE id = ?`).run(taskId);
}

export function markTaskAsFinished(taskId: number) {
  db.prepare(`UPDATE agent_task_queue SET status = 'done' WHERE id = ?`).run(taskId);
}

export function cancelTask(taskId: number) {
  db.prepare(`UPDATE agent_task_queue SET status = 'cancelled' WHERE id = ?`).run(taskId);
}

export function cancelAllQueuedFor(agentId: string) {
  db.prepare(`UPDATE agent_task_queue SET status = 'cancelled' WHERE agent_id = ? AND status = 'queued'`).run(agentId);
}

export function reprioritizeTask(taskId: number, newPriority: number) {
  db.prepare(`UPDATE agent_task_queue SET priority = ? WHERE id = ?`).run(newPriority, taskId);
}

export function getQueueFor(agentId: string): QueuedTask[] {
  return db.prepare(`
    SELECT * FROM agent_task_queue WHERE agent_id = ? AND status = 'queued' ORDER BY priority DESC, created_at ASC
  `).all(agentId) as QueuedTask[];
}
