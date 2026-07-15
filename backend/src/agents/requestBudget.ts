import { db } from '../db';

const DAILY_REQUEST_LIMIT = 450;

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function getRequestBudgetStatus(agentId: string): { used: number; limit: number; exhausted: boolean } {
  const row = db.prepare(`SELECT requests_used_today, requests_date FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    requests_used_today: number; requests_date: string | null;
  };

  const today = todayKey();
  if (row.requests_date !== today) {
    db.prepare(`UPDATE agent_state SET requests_used_today = 0, requests_date = ? WHERE agent_id = ?`).run(today, agentId);
    return { used: 0, limit: DAILY_REQUEST_LIMIT, exhausted: false };
  }

  return { used: row.requests_used_today, limit: DAILY_REQUEST_LIMIT, exhausted: row.requests_used_today >= DAILY_REQUEST_LIMIT };
}

export function recordRequestUsage(agentId: string) {
  const today = todayKey();
  const status = getRequestBudgetStatus(agentId);
  db.prepare(`UPDATE agent_state SET requests_used_today = ?, requests_date = ? WHERE agent_id = ?`)
    .run(status.used + 1, today, agentId);
}
