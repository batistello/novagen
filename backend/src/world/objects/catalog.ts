// Catalogo unico de todos os objetos do mundo.
// Fonte unica de verdade — nenhuma propriedade de objeto deve viver espalhada em outros arquivos.

export type ObjectCategory = 'resource' | 'tool' | 'armor' | 'structure' | 'raw_material';

export interface ObjectDefinition {
  key: string;
  category: ObjectCategory;
  description: string;
  recipe?: { wood?: number; stone?: number; fiber?: number; corda?: number; couro?: number };
  attack?: number;
  defense?: number;
}

export const OBJECT_CATALOG: Record<string, ObjectDefinition> = {
  // Materiais brutos (coletados diretamente do mundo)
  wood: { key: 'wood', category: 'raw_material', description: 'madeira, obtida de arvores' },
  stone: { key: 'stone', category: 'raw_material', description: 'pedra, obtida de rochas' },
  water: { key: 'water', category: 'raw_material', description: 'agua, obtida de fontes' },
  fiber: { key: 'fiber', category: 'raw_material', description: 'fibra, obtida de brotos de arvore' },
  couro: { key: 'couro', category: 'raw_material', description: 'couro, obtido ao derrotar um predador' },
  carne: { key: 'carne', category: 'raw_material', description: 'carne, obtida ao cacar um roedor' },

  // Ferramentas craftadas
  corda: { key: 'corda', category: 'tool', description: 'corda, feita de fibra', recipe: { fiber: 3 } },
  vara_pesca: { key: 'vara_pesca', category: 'tool', description: 'vara de pesca, permite pescar', recipe: { wood: 2, corda: 1 } },
  harpao: { key: 'harpao', category: 'tool', description: 'harpao, permite pescar peixe grande', recipe: { wood: 2, stone: 1 } },
  faca: { key: 'faca', category: 'tool', description: 'faca, arma leve', recipe: { wood: 1, stone: 1 }, attack: 4 },
  machado: { key: 'machado', category: 'tool', description: 'machado, arma pesada', recipe: { wood: 2, stone: 2 }, attack: 7 },
  lanca: { key: 'lanca', category: 'tool', description: 'lanca, arma de longo alcance', recipe: { wood: 3, stone: 1 }, attack: 6 },
  tocha: { key: 'tocha', category: 'tool', description: 'tocha, fonte de luz', recipe: { wood: 1, fiber: 1 } },
  cesto: { key: 'cesto', category: 'tool', description: 'cesto, aumenta capacidade de carga', recipe: { fiber: 4 } },

  // Armaduras
  couro_curtido: { key: 'couro_curtido', category: 'armor', description: 'couro curtido, veste no corpo', recipe: { couro: 1, fiber: 2 }, defense: 3 },

  // Estruturas (colocadas no mundo, nao carregadas no inventario)
  cerca: { key: 'cerca', category: 'structure', description: 'cerca de madeira, bloqueia passagem', recipe: { wood: 5 } },
  muro_pedra: { key: 'muro_pedra', category: 'structure', description: 'muro de pedra, bloqueia passagem com mais forca', recipe: { stone: 5 } },
  telhado_pedra: { key: 'telhado_pedra', category: 'structure', description: 'telhado de pedra, marca um abrigo', recipe: { stone: 4, wood: 2 } },

  // Recursos do mundo (nao carregaveis, existem como world_objects)
  tree: { key: 'tree', category: 'resource', description: 'arvore, fonte de madeira e fibra' },
  rock: { key: 'rock', category: 'resource', description: 'pedra solida, fonte de material mineral' },
  water_source: { key: 'water_source', category: 'resource', description: 'fonte de agua' },
  grass_patch: { key: 'grass_patch', category: 'resource', description: 'planta que cresce e pode ser consumida quando madura' },
};

export function getObjectDefinition(key: string): ObjectDefinition | undefined {
  return OBJECT_CATALOG[key];
}

export function getRecipeFor(key: string) {
  return OBJECT_CATALOG[key]?.recipe;
}

export function getAttackValue(key: string | null | undefined): number {
  if (!key) return 2; // ataque desarmado padrao
  return OBJECT_CATALOG[key]?.attack ?? 2;
}

export function getDefenseValue(key: string | null | undefined): number {
  if (!key) return 0;
  return OBJECT_CATALOG[key]?.defense ?? 0;
}
