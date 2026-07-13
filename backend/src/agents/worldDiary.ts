import { db } from '../db';

function getWorldStartAt(): number {
  const row = db.prepare(`SELECT value FROM world_meta WHERE key = 'world_start_at'`).get() as { value: string } | undefined;
  return row ? parseInt(row.value, 10) : Date.now();
}

export function getCurrentDay(): number {
  const start = getWorldStartAt();
  const elapsedMs = Date.now() - start;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24)) + 1;
}

export type DiaryTag = 'PRIMEIRO_ENCONTRO' | 'ALIMENTACAO' | 'CONSTRUCAO' | 'MORTE' | 'COOPERACAO' | 'CONFLITO' | 'TROCA' | 'OUTRO';

export function recordDiaryEntry(content: string, tag: DiaryTag = 'OUTRO') {
  const day = getCurrentDay();
  db.prepare(`INSERT INTO world_diary (day, content, created_at, tag) VALUES (?, ?, ?, ?)`).run(day, content, Date.now(), tag);
}

export function getDiaryEntries(limit: number = 30): { day: number; content: string; tag: string }[] {
  return db.prepare(`SELECT day, content, tag FROM world_diary ORDER BY id DESC LIMIT ?`).all(limit) as { day: number; content: string; tag: string }[];
}

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('_');
}

export function checkAndRecordFirstMeeting(agentA: string, agentB: string, distance: number) {
  const MEETING_RADIUS = 20;
  if (distance > MEETING_RADIUS) return;

  const key = pairKey(agentA, agentB);
  const existing = db.prepare(`SELECT pair_key FROM agent_meetings WHERE pair_key = ?`).get(key);
  if (existing) return;

  db.prepare(`INSERT INTO agent_meetings (pair_key, met_at) VALUES (?, ?)`).run(key, Date.now());
  recordDiaryEntry(`${AGENT_NAMES[agentA] ?? agentA} encontrou ${AGENT_NAMES[agentB] ?? agentB}.`, 'PRIMEIRO_ENCONTRO');
}
