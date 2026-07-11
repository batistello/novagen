import { db } from '../db';

export interface EventRow {
  id: number;
  agent_id: string | null;
  type: string;
  content: string;
  metadata: string | null;
  created_at: number;
}

export function recordEvent(agentId: string | null, type: string, content: string, metadata?: object) {
  const stmt = db.prepare(
    `INSERT INTO events (agent_id, type, content, metadata, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  stmt.run(agentId, type, content, metadata ? JSON.stringify(metadata) : null, Date.now());
}

export function getRecentEvents(limit: number = 15): EventRow[] {
  const stmt = db.prepare(
    `SELECT * FROM events ORDER BY created_at DESC LIMIT ?`
  );
  return (stmt.all(limit) as EventRow[]).reverse();
}

const AGENT_NAMES: Record<string, string> = { blue: 'Azul', red: 'Vermelho' };

export function formatEventsAsMemory(events: EventRow[]): string[] {
  return events.map(ev => {
    const who = ev.agent_id ? (AGENT_NAMES[ev.agent_id] ?? ev.agent_id) : 'Mundo';
    switch (ev.type) {
      case 'speech':
        return `${who} disse: "${ev.content}"`;
      case 'action':
        return `${who} fez: ${ev.content}`;
      case 'system':
        return `Sistema: ${ev.content}`;
      default:
        return `${who}: ${ev.content}`;
    }
  });
}

export function getRecentMemoryFor(agentId: string, limit: number = 15): string[] {
  const events = getRecentEvents(limit);
  return formatEventsAsMemory(events);
}
