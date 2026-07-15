// Filtro de significancia — decide o que merece virar memoria episodica de verdade.
// Hoje o sistema de memoria (memoryTiers.ts) ja registra eventos relevantes atraves
// de chamadas explicitas espalhadas pelo codigo (notifyWitnesses). Este modulo formaliza
// o CRITERIO do que conta como significativo, para uso em novos pontos de registro
// que forem adicionados daqui em diante, sem precisar reescrever os pontos existentes.

export type SignificantEventType =
  | 'first_discovery' | 'near_death' | 'death_witnessed' | 'major_construction'
  | 'met_new_individual' | 'trust_broken' | 'trust_earned';

const SIGNIFICANT_TYPES: Set<SignificantEventType> = new Set([
  'first_discovery', 'near_death', 'death_witnessed', 'major_construction',
  'met_new_individual', 'trust_broken', 'trust_earned',
]);

export function isSignificant(eventType: SignificantEventType): boolean {
  return SIGNIFICANT_TYPES.has(eventType);
}
