// Perception Builder — o LLM nunca le o mundo diretamente, ele le uma percepcao construida.
// Nesta fase, o Perception Builder centraliza a insercao de World Events no texto final,
// sem duplicar a logica extensa ja existente em runner.ts (que continua responsavel
// por montar a percepcao de entidades, objetos, memoria, etc).

import { getRecentWorldEventsNear } from '../events/worldEvents';

const WORLD_EVENTS_RADIUS = 60;
const WORLD_EVENTS_WINDOW_MS = 10 * 60 * 1000; // ultimos 10 minutos

export function buildWorldEventsText(agentX: number, agentY: number): string {
  const events = getRecentWorldEventsNear(agentX, agentY, WORLD_EVENTS_RADIUS, WORLD_EVENTS_WINDOW_MS);
  if (events.length === 0) return '';
  return 'Coisas que aconteceram por perto recentemente, sem ninguem ter feito diretamente:\n' + events.map(e => `  - ${e}`).join('\n');
}
