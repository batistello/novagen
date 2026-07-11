export interface EnergyTier {
  min: number;
  max: number;
  name: string;
  tickIntervalMs: number;
  callsLLM: boolean;
}

export const ENERGY_TIERS: EnergyTier[] = [
  { min: 70, max: 100, name: 'awake',     tickIntervalMs: 20_000,    callsLLM: true  },
  { min: 50, max: 70,  name: 'tiring',    tickIntervalMs: 31_500,    callsLLM: true  },
  { min: 30, max: 50,  name: 'drowsy',    tickIntervalMs: 126_000,   callsLLM: true  },
  { min: 20, max: 30,  name: 'fading',    tickIntervalMs: 630_000,   callsLLM: false },
  { min: 10, max: 20,  name: 'sleeping',  tickIntervalMs: 1_260_000, callsLLM: false },
  { min: 0,  max: 10,  name: 'deep_rest', tickIntervalMs: 2_520_000, callsLLM: false },
];

export const PASSIVE_REGEN_PER_MIN = 0.05;
export const SLEEP_REGEN_PER_MIN = 0.4;
export const TOKENS_TO_ENERGY = 0.0002;

export function getTier(energy: number): EnergyTier {
  return ENERGY_TIERS.find(t => energy >= t.min && energy <= t.max) ?? ENERGY_TIERS[0];
}
