import { db } from '../db';

const DAILY_LIMITS: Record<string, number> = {
  blue: 180_000,
  red: 900_000,
};

function todayKey(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function getTokenBudgetStatus(agentId: string): { used: number; limit: number; ratio: number } {
  const row = db.prepare(`SELECT tokens_used_today, tokens_date FROM agent_state WHERE agent_id = ?`).get(agentId) as {
    tokens_used_today: number; tokens_date: string | null;
  };

  const today = todayKey();
  const limit = DAILY_LIMITS[agentId] ?? 150_000;

  if (row.tokens_date !== today) {
    db.prepare(`UPDATE agent_state SET tokens_used_today = 0, tokens_date = ? WHERE agent_id = ?`).run(today, agentId);
    return { used: 0, limit, ratio: 0 };
  }

  return { used: row.tokens_used_today, limit, ratio: row.tokens_used_today / limit };
}

export function recordTokenUsage(agentId: string, tokens: number) {
  const today = todayKey();
  const status = getTokenBudgetStatus(agentId);
  db.prepare(`UPDATE agent_state SET tokens_used_today = ?, tokens_date = ? WHERE agent_id = ?`)
    .run(status.used + tokens, today, agentId);
}
