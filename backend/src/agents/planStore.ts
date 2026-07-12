import { db } from '../db';
import { AgentResponse } from './actionSchema';

export function clearPendingSteps(agentId: string) {
  db.prepare(`DELETE FROM agent_plan_steps WHERE agent_id = ? AND executed = 0`).run(agentId);
}

export function savePlan(agentId: string, steps: AgentResponse[]) {
  clearPendingSteps(agentId);
  const insert = db.prepare(
    `INSERT INTO agent_plan_steps (agent_id, step_index, response_json, executed, created_at) VALUES (?, ?, ?, 0, ?)`
  );
  const now = Date.now();
  steps.forEach((step, i) => {
    insert.run(agentId, i, JSON.stringify(step), now);
  });
}

export function getNextStep(agentId: string): { id: number; response: AgentResponse } | null {
  const row = db.prepare(
    `SELECT id, response_json FROM agent_plan_steps WHERE agent_id = ? AND executed = 0 ORDER BY step_index ASC LIMIT 1`
  ).get(agentId) as { id: number; response_json: string } | undefined;
  if (!row) return null;
  return { id: row.id, response: JSON.parse(row.response_json) };
}

export function markStepExecuted(stepId: number) {
  db.prepare(`UPDATE agent_plan_steps SET executed = 1 WHERE id = ?`).run(stepId);
}

export function countPendingSteps(agentId: string): number {
  const row = db.prepare(`SELECT COUNT(*) as c FROM agent_plan_steps WHERE agent_id = ? AND executed = 0`).get(agentId) as { c: number };
  return row.c;
}
