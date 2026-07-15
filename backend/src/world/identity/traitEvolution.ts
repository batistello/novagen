// Evolucao gradual de tracos de personalidade a partir da experiencia vivida.
// Principio central: NUNCA mudar um traco de uma vez so. Cada evento relevante
// empurra o valor em um passo minusculo (ver TRAIT_NUDGE_STEP), na direcao certa.
//
// Hoje este modulo esta conectado a alguns pontos de sucesso ja existentes no sistema
// (dar item a outro agente, construir com sucesso, vencer um combate) como prova de conceito.
// Mais gatilhos podem ser adicionados nos mesmos moldes conforme o sistema evolui.

import { db } from '../../db';

const TRAIT_NUDGE_STEP = 0.5;

export function nudgeTrait(agentId: string, trait: string, direction: 1 | -1) {
  const row = db.prepare(`SELECT value FROM agent_traits WHERE agent_id = ? AND trait = ?`).get(agentId, trait) as { value: number } | undefined;
  if (!row) return; // so ajusta tracos que ja existem no DNA do agente, nunca cria trait novo sozinho

  const newValue = Math.max(0, Math.min(100, row.value + direction * TRAIT_NUDGE_STEP));
  db.prepare(`UPDATE agent_traits SET value = ? WHERE agent_id = ? AND trait = ?`).run(newValue, agentId, trait);
}

// Pontos de gatilho ja conectados hoje:
export function onSharedItemWithOther(agentId: string) {
  nudgeTrait(agentId, 'empatia', 1);
  nudgeTrait(agentId, 'confianca_no_outro', 1);
}

export function onBuiltStructureSuccessfully(agentId: string) {
  nudgeTrait(agentId, 'persistencia', 1);
}

export function onWonCombat(agentId: string) {
  nudgeTrait(agentId, 'coragem', 1);
}
