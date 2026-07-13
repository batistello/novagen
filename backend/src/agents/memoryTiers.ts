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

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho', green: 'Verde' };
const DEFAULT_WITNESS_RADIUS = 60;

export function notifyWitnesses(
  actorId: string,
  actorX: number,
  actorY: number,
  selfMemory: string,
  witnessMemoryTemplate: (actorName: string) => string,
  radius: number = DEFAULT_WITNESS_RADIUS
) {
  recordCategorizedMemory(actorId, 'episodic', selfMemory);

  const others = db.prepare(
    `SELECT agent_id, x, y FROM agent_state WHERE agent_id != ? AND status != 'dead'`
  ).all(actorId) as { agent_id: string; x: number; y: number }[];

  const actorName = AGENT_NAMES[actorId] ?? actorId;

  others.forEach(other => {
    const dist = Math.sqrt((other.x - actorX) ** 2 + (other.y - actorY) ** 2);
    if (dist <= radius) {
      recordCategorizedMemory(other.agent_id, 'social', witnessMemoryTemplate(actorName), actorId);
    }
  });
}
