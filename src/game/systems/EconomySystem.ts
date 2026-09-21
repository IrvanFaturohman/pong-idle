import { addBallCost, addPaddleCost, ECONOMY, mapMultiplier, mapTarget } from '../data/economy';
import { PADDLES } from '../config';
import type { GameState } from '../types';

interface IncomeSample {
  time: number;
  amount: number;
}

/**
 * Wallet, map progress and prices. The wallet can go down (purchases) but map
 * earnings only ever increase, so spending never costs map progress.
 */
export class EconomySystem {
  private samples: IncomeSample[] = [];
  private readonly trackingStart = performance.now();

  constructor(private readonly state: GameState) {}

  get wallet(): number {
    return this.state.wallet;
  }

  get multiplier(): number {
    return mapMultiplier(this.state.mapIndex, this.state.endless.tier);
  }

  get target(): number {
    return mapTarget(this.state.mapIndex, this.state.endless.tier);
  }

  get progress(): number {
    return Math.min(1, this.state.mapEarnings / this.target);
  }

  get mapCleared(): boolean {
    return this.state.mapEarnings >= this.target;
  }

  get ballCost(): number {
    return addBallCost(this.state.ballsPurchased);
  }

  /** Null once the paddle cap is reached. */
  get paddleCost(): number | null {
    if (this.state.paddles.length >= PADDLES.maxCount) return null;
    return addPaddleCost(this.state.paddlesPurchased);
  }

  canAfford(cost: number): boolean {
    return this.state.wallet >= cost;
  }

  earn(amount: number): void {
    if (!(amount > 0)) return;
    this.state.wallet += amount;
    this.state.mapEarnings += amount;
    this.state.lifetimeEarnings += amount;
    this.state.stats.totalEarned += amount;
    this.samples.push({ time: performance.now(), amount });
  }

  /** Returns false (and changes nothing) when the wallet cannot cover the cost. */
  spend(cost: number): boolean {
    if (!(cost >= 0) || this.state.wallet < cost) return false;
    this.state.wallet = Math.max(0, this.state.wallet - cost);
    return true;
  }

  /** Rolling average of real earnings over the last few seconds. */
  incomePerSecond(): number {
    const now = performance.now();
    const windowMs = ECONOMY.incomeWindowSeconds * 1000;
    const cutoff = now - windowMs;
    let firstValid = 0;
    while (firstValid < this.samples.length && this.samples[firstValid].time < cutoff) firstValid++;
    if (firstValid > 0) this.samples.splice(0, firstValid);
    let sum = 0;
    for (const s of this.samples) sum += s.amount;
    // Early in a session the window is not full yet; divide by the time actually observed.
    const observed = Math.max(3000, Math.min(windowMs, now - this.trackingStart));
    return sum / (observed / 1000);
  }
}
