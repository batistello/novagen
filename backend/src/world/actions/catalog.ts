// Catalogo unico de todas as acoes mecanicas do mundo.
// Cada acao mapeia para o que hoje existe como goal_type no sistema de intencoes.
// Nesta fase (reorganizacao), este catalogo eh apenas documentacao central —
// a execucao real continua em behaviorEngine.ts ate a proxima fase de migracao.

export type ActionCategory = 'movement' | 'gathering' | 'crafting' | 'combat' | 'survival' | 'social';

export interface ActionDefinition {
  key: string;
  category: ActionCategory;
  description: string;
  canFail: boolean;
  currentGoalType: string; // mapeamento para o goal_type atual, ate a migracao completa
}

export const ACTION_CATALOG: Record<string, ActionDefinition> = {
  move: { key: 'move', category: 'movement', description: 'mover-se em direcao a um ponto ou entidade', canFail: false, currentGoalType: 'explore' },
  approach: { key: 'approach', category: 'movement', description: 'aproximar-se de outro agente', canFail: false, currentGoalType: 'approach' },
  approachObject: { key: 'approachObject', category: 'movement', description: 'aproximar-se de um objeto especifico para examinar', canFail: true, currentGoalType: 'approach_object' },
  flee: { key: 'flee', category: 'movement', description: 'afastar-se de uma ameaca', canFail: false, currentGoalType: 'move_away' },

  collect: { key: 'collect', category: 'gathering', description: 'consumir algo de uma area de recurso (comida)', canFail: true, currentGoalType: 'collect' },
  gather: { key: 'gather', category: 'gathering', description: 'coletar material bruto de um recurso (madeira, pedra)', canFail: true, currentGoalType: 'gather' },
  drink: { key: 'drink', category: 'gathering', description: 'beber agua de uma fonte ou da mochila', canFail: true, currentGoalType: 'drink' },
  fish: { key: 'fish', category: 'gathering', description: 'pescar em uma fonte de agua, requer ferramenta', canFail: true, currentGoalType: 'fish' },

  craft: { key: 'craft', category: 'crafting', description: 'montar um item a partir de materiais guardados', canFail: true, currentGoalType: 'craft' },
  build: { key: 'build', category: 'crafting', description: 'construir uma estrutura fisica no mundo', canFail: true, currentGoalType: 'build' },
  equip: { key: 'equip', category: 'crafting', description: 'equipar um item guardado (mao ou corpo)', canFail: true, currentGoalType: 'equip' },
  unequip: { key: 'unequip', category: 'crafting', description: 'remover um item equipado', canFail: false, currentGoalType: 'unequip' },
  drop: { key: 'drop', category: 'crafting', description: 'descartar um item guardado', canFail: true, currentGoalType: 'drop' },

  attack: { key: 'attack', category: 'combat', description: 'atacar outro agente', canFail: false, currentGoalType: 'attack' },
  hunt: { key: 'hunt', category: 'combat', description: 'atacar uma criatura (lobo ou roedor)', canFail: true, currentGoalType: 'attack_wolf' },

  rest: { key: 'rest', category: 'survival', description: 'permanecer parado, recuperando energia', canFail: false, currentGoalType: 'rest' },
  observe: { key: 'observe', category: 'survival', description: 'permanecer parado, observando e refletindo', canFail: false, currentGoalType: 'observe' },

  talk: { key: 'talk', category: 'social', description: 'comunicar-se com outra entidade (sempre disponivel, nao consome ciclo proprio)', canFail: false, currentGoalType: 'n/a' },
  give: { key: 'give', category: 'social', description: 'entregar um item a outro agente proximo', canFail: true, currentGoalType: 'give' },
};

export function getActionDefinition(key: string): ActionDefinition | undefined {
  return ACTION_CATALOG[key];
}
