import { getMap, MAPS } from './maps';

/**
 * All economy balance values. Tweak these to change pacing.
 */
export const ECONOMY = {
  /** Paddle-hit value: level 1 = $1, level 2 = $4, then x3 per level ($12, $36, $108, ...). */
  ballValue: { level1: 1, level2: 4, growth: 3 },
  combo: {
    /** Multiplier of the first consecutive paddle hit. */
    start: 1,
    /** Added for every additional paddle hit without touching a normal wall. */
    step: 0.1,
    max: 2,
  },
  /** Cheap and gently rising: filling the arena with balls is the fun part. */
  addBall: { base: 12, growth: 1.1 },
  addPaddle: { base: 100, growth: 2.15 },
  /** Rolling window used for the income-per-second display. */
  incomeWindowSeconds: 10,
  endless: {
    /** Each endless tier's target = Map 3 target x growth^tier. */
    targetGrowth: 3,
    /** Each endless tier adds this fraction on top of the Map 3 multiplier. */
    multiplierBonusPerTier: 0.25,
  },
} as const;

export function ballValue(level: number): number {
  const { level1, level2, growth } = ECONOMY.ballValue;
  if (level <= 1) return level1;
  return level2 * Math.pow(growth, level - 2);
}

/** Combo multiplier for a ball that has already chained `chain` paddle hits. */
export function comboMultiplier(chain: number): number {
  const { start, step, max } = ECONOMY.combo;
  // Round to one decimal so 1 + 0.1 * 3 displays as 1.3 and never 1.3000000000000003.
  return Math.min(max, Math.round((start + step * chain) * 10) / 10);
}

/** Round a price to a "readable" value: 27.6 -> 28, 138 -> 140, 1316 -> 1320. */
export function roundPrice(value: number): number {
  if (value < 100) return Math.round(value);
  if (value < 1000) return Math.round(value / 5) * 5;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)) - 2);
  return Math.round(value / magnitude) * magnitude;
}

export function addBallCost(ballsPurchased: number): number {
  return roundPrice(ECONOMY.addBall.base * Math.pow(ECONOMY.addBall.growth, ballsPurchased));
}

export function addPaddleCost(paddlesPurchased: number): number {
  return roundPrice(ECONOMY.addPaddle.base * Math.pow(ECONOMY.addPaddle.growth, paddlesPurchased));
}

/** Earnings multiplier for a map, including the endless-tier bonus on the final map. */
export function mapMultiplier(mapIndex: number, endlessTier: number): number {
  const base = getMap(mapIndex).multiplier;
  if (endlessTier <= 0 || mapIndex !== MAPS.length - 1) return base;
  return Math.round(base * (1 + ECONOMY.endless.multiplierBonusPerTier * endlessTier) * 100) / 100;
}

/** Money that must be earned on the current map (or endless tier) to clear it. */
export function mapTarget(mapIndex: number, endlessTier: number): number {
  const base = getMap(mapIndex).target;
  if (endlessTier <= 0 || mapIndex !== MAPS.length - 1) return base;
  return roundPrice(base * Math.pow(ECONOMY.endless.targetGrowth, endlessTier));
}
