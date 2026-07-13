import { db } from '../db';

export type MemoryCategory = 'episodic' | 'knowledge' | 'social';

export function recordCategorizedMemory(
  agentId: string,
  category: MemoryCategory,
  content: string,
  relatedAgentId?: string
) {
  db.prepare(
    `INSERT INTO agent_memories (agent_id, category, content, related_agent_id, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(agentId, category, content, relatedAgentId ?? null, Date.now());
}

export function getMemoriesByCategory(agentId: string, category: MemoryCategory, limit: number = 8): string[] {
  const rows = db.prepare(
    `SELECT content FROM agent_memories WHERE agent_id = ? AND category = ? ORDER BY created_at DESC LIMIT ?`
  ).all(agentId, category, limit) as { content: string }[];
  return rows.map(r => r.content);
}
