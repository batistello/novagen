// Lugares conhecidos por cada agente — parte da identidade persistente.
// Um lugar so vira "conhecido" quando o proprio agente registra, via memory_note
// mencionando localizacao, ou quando o codigo detecta primeira visita a uma area distinta.

import { db } from '../../db';

export function recordKnownPlace(agentId: string, placeName: string, x: number, y: number, notes?: string) {
  const existing = db.prepare(`SELECT id FROM agent_known_places WHERE agent_id = ? AND place_name = ?`).get(agentId, placeName);
  if (existing) return;
  db.prepare(`INSERT INTO agent_known_places (agent_id, place_name, x, y, notes, discovered_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(agentId, placeName, x, y, notes ?? null, Date.now());
}

export function getKnownPlacesText(agentId: string): string {
  const places = db.prepare(`SELECT place_name, x, y, notes FROM agent_known_places WHERE agent_id = ?`).all(agentId) as
    { place_name: string; x: number; y: number; notes: string | null }[];
  if (places.length === 0) return '';
  return 'Lugares que voce ja conhece:\n' + places.map(p => `  - ${p.place_name}${p.notes ? `: ${p.notes}` : ''}`).join('\n');
}
