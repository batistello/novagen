export interface EnergyTier {
  min: number;
  max: number;
  name: string;
  tickIntervalMs: number;
  callsLLM: boolean;
}

export const ENERGY_TIERS: EnergyTier[] = [
  { min: 70, max: 100, name: 'awake',     tickIntervalMs: 10_000,    callsLLM: true  },
  { min: 50, max: 70,  name: 'tiring',    tickIntervalMs: 45_000,    callsLLM: true  },
  { min: 30, max: 50,  name: 'drowsy',    tickIntervalMs: 180_000,   callsLLM: true  },
  { min: 20, max: 30,  name: 'fading',    tickIntervalMs: 900_000,   callsLLM: false },
  { min: 10, max: 20,  name: 'sleeping',  tickIntervalMs: 1_800_000, callsLLM: false },
  { min: 0,  max: 10,  name: 'deep_rest', tickIntervalMs: 3_600_000, callsLLM: false },
];

export const PASSIVE_REGEN_PER_MIN = 0.05;
export const SLEEP_REGEN_PER_MIN = 0.4;
export const TOKENS_TO_ENERGY = 0.0002;

export function getTier(energy: number): EnergyTier {
  return ENERGY_TIERS.find(t => energy >= t.min && energy <= t.max) ?? ENERGY_TIERS[0];
}
