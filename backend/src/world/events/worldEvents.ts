// Modulo central de eventos do mundo — nao apenas de agentes.
// Alimenta a percepcao com coisas que aconteceram por conta propria (arvore cresceu, lobo morreu, etc).

import { db } from '../../db';

export type WorldEventType =
  | 'tree_grew' | 'plant_matured' | 'wolf_died' | 'wolf_born'
  | 'rodent_spawned' | 'resource_depleted' | 'resource_regrew';

export function recordWorldEvent(eventType: WorldEventType, description: string, x?: number, y?: number) {
  db.prepare(`INSERT INTO world_events (event_type, description, x, y, occurred_at) VALUES (?, ?, ?, ?, ?)`)
    .run(eventType, description, x ?? null, y ?? null, Date.now());
}

export function getRecentWorldEventsNear(x: number, y: number, radius: number, withinMs: number, limit: number = 5): string[] {
  const cutoff = Date.now() - withinMs;
  const events = db.prepare(`
    SELECT description, x, y FROM world_events
    WHERE occurred_at >= ?
    ORDER BY occurred_at DESC
    LIMIT 30
  `).all(cutoff) as { description: string; x: number | null; y: number | null }[];

  return events
    .filter(e => {
      if (e.x == null || e.y == null) return true; // eventos sem posicao (globais) sempre passam
      const dist = Math.sqrt((e.x - x) ** 2 + (e.y - y) ** 2);
      return dist <= radius;
    })
    .slice(0, limit)
    .map(e => e.description);
}
