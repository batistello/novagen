// Catalogo unico de todas as criaturas do mundo.

export interface CreatureDefinition {
  key: string;
  displayName: string;
  baseHp: number;
  baseAttack: number;
  moveStep: number;
  detectionRadius: number;
  attackRadius: number;
  attackCooldownMs: number;
  lifespanDays: number | null; // null = sem limite de vida natural
  isPredator: boolean;
  isPrey: boolean;
}

export const CREATURE_CATALOG: Record<string, CreatureDefinition> = {
  wolf: {
    key: 'wolf',
    displayName: 'Lobo',
    baseHp: 20,
    baseAttack: 5,
    moveStep: 4,
    detectionRadius: 40,
    attackRadius: 12,
    attackCooldownMs: 15_000,
    lifespanDays: 10,
    isPredator: true,
    isPrey: false,
  },
  rodent: {
    key: 'rodent',
    displayName: 'Roedor',
    baseHp: 1,
    baseAttack: 0,
    moveStep: 5,
    detectionRadius: 0,
    attackRadius: 0,
    attackCooldownMs: 0,
    lifespanDays: 1,
    isPredator: false,
    isPrey: true,
  },
  agent: {
    key: 'agent',
    displayName: 'Agente',
    baseHp: 100,
    baseAttack: 2,
    moveStep: 6,
    detectionRadius: 0,
    attackRadius: 15,
    attackCooldownMs: 15_000,
    lifespanDays: null,
    isPredator: false,
    isPrey: false,
  },
};

export function getCreatureDefinition(key: string): CreatureDefinition | undefined {
  return CREATURE_CATALOG[key];
}
