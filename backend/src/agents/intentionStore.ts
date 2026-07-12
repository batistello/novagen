import { db } from '../db';
import { Intention } from './actionSchema';

export interface StoredIntention {
  agent_id: string;
  goal_type: string;
  target_agent_id: string | null;
  target_x: number | null;
  target_y: number | null;
  wander_x: number | null;
  wander_y: number | null;
  interrupt_on_speech: number;
  interrupt_on_proximity: number | null;
  raw_speech: string | null;
  raw_thought: string;
  emotion: string;
  started_at: number;
  expires_at: number;
  status: string;
}

export function saveIntention(agentId: string, intention: Intention) {
  const now = Date.now();
  const expiresAt = now + intention.duration_minutes * 60_000;

  db.prepare(`
    INSERT INTO agent_intentions (agent_id, goal_type, target_agent_id, target_x, target_y, wander_x, wander_y, priority, interrupt_on_speech, interrupt_on_proximity, raw_speech, raw_thought, emotion, started_at, expires_at, status)
    VALUES (@agent_id, @goal_type, @target_agent_id, NULL, NULL, NULL, NULL, 'normal', @interrupt_on_speech, @interrupt_on_proximity, @raw_speech, @raw_thought, @emotion, @started_at, @expires_at, 'active')
    ON CONFLICT(agent_id) DO UPDATE SET
      goal_type=excluded.goal_type, target_agent_id=excluded.target_agent_id,
      wander_x=NULL, wander_y=NULL,
      interrupt_on_speech=excluded.interrupt_on_speech, interrupt_on_proximity=excluded.interrupt_on_proximity,
      raw_speech=excluded.raw_speech, raw_thought=excluded.raw_thought, emotion=excluded.emotion,
      started_at=excluded.started_at, expires_at=excluded.expires_at, status='active'
  `).run({
    agent_id: agentId,
    goal_type: intention.goal_type,
    target_agent_id: intention.target_agent_id ?? null,
    interrupt_on_speech: intention.interrupt_on_speech ? 1 : 0,
    interrupt_on_proximity: intention.interrupt_on_proximity ?? null,
    raw_speech: intention.speech,
    raw_thought: intention.thought,
    emotion: intention.emotion,
    started_at: now,
    expires_at: expiresAt,
  });
}

export function getIntention(agentId: string): StoredIntention | null {
  const row = db.prepare(`SELECT * FROM agent_intentions WHERE agent_id = ?`).get(agentId) as StoredIntention | undefined;
  return row ?? null;
}

export function setWanderTarget(agentId: string, x: number, y: number) {
  db.prepare(`UPDATE agent_intentions SET wander_x = ?, wander_y = ? WHERE agent_id = ?`).run(x, y, agentId);
}

export function markIntentionInterrupted(agentId: string) {
  db.prepare(`UPDATE agent_intentions SET status = 'interrupted' WHERE agent_id = ?`).run(agentId);
}

export function isIntentionExpiredOrInterrupted(intention: StoredIntention | null): boolean {
  if (!intention) return true;
  if (intention.status !== 'active') return true;
  if (Date.now() >= intention.expires_at) return true;
  return false;
}
