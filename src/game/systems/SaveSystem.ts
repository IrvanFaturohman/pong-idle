import { BALLS, MODE_RULES } from '../config';
import { MAPS } from '../data/maps';
import type { GameMode, GameState, PaddleSave, SaveFile, Side } from '../types';

/** Each version keeps its own progress. */
export const SAVE_KEYS: Record<GameMode, string> = {
  classic: 'merge-pong-idle:save',
  auto: 'merge-pong-idle:auto:save',
};
export const SAVE_VERSION = 3;
const MAX_LEVEL = 60;
const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

export function createFreshState(mode: GameMode): GameState {
  return {
    wallet: 0,
    mapIndex: 0,
    mapEarnings: 0,
    lifetimeEarnings: 0,
    balls: [1],
    paddles: MODE_RULES[mode].initialSides.map((side) => ({ side, pos: 0.5 })),
    ballsPurchased: 0,
    paddlesPurchased: 0,
    stats: { playTimeMs: 0, totalEarned: 0, highestLevel: 1, paddleHits: 0, merges: 0 },
    settings: { sound: true, haptics: true },
    tutorial: { step: 0, done: false },
    endless: { prototypeComplete: false, tier: 0 },
  };
}

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function int(v: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  return Math.floor(num(v, fallback, min, max));
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Upgrade older save layouts to the current schema. Each entry migrates from
 * version `n` to `n + 1`. Version 0 represents unversioned/legacy data.
 */
const MIGRATIONS: Record<number, (raw: Raw, mode: GameMode) => Raw> = {
  0: (raw) => ({ ...raw, version: 1 }),
  // v2: games start with left and right paddles, and a "tap to speed up" tutorial step was inserted at index 2.
  1: (raw) => {
    const paddles: unknown[] = Array.isArray(raw.paddles) ? [...raw.paddles] : [];
    for (const side of ['left', 'right'] as const) {
      if (paddles.length < 8 && !paddles.some((p) => isObject(p) && p.side === side)) paddles.push({ side, pos: 0.5 });
    }
    const tutorial = isObject(raw.tutorial) ? { ...raw.tutorial } : {};
    if (typeof tutorial.step === 'number' && tutorial.step >= 2) tutorial.step += 1;
    return { ...raw, paddles, tutorial, version: 2 };
  },
  // v3: classic replaced its starting top paddle with a fixed full-width top bar.
  // Any other top paddles are moved to a free side when the game loads.
  2: (raw, mode) => {
    if (mode !== 'classic' || !Array.isArray(raw.paddles)) return { ...raw, version: 3 };
    const paddles = [...raw.paddles];
    const top = paddles.findIndex((p) => isObject(p) && p.side === 'top');
    if (top >= 0) paddles.splice(top, 1);
    return { ...raw, paddles, version: 3 };
  },
};

function migrate(raw: Raw, mode: GameMode): Raw {
  let version = int(raw.version, 0);
  let data = raw;
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    data = step(data, mode);
    version++;
  }
  return data;
}

/** Turns any parsed JSON into a valid GameState, falling back to defaults field by field. */
export function sanitize(raw: Raw, mode: GameMode): GameState {
  const fresh = createFreshState(mode);
  const rules = MODE_RULES[mode];

  const balls = Array.isArray(raw.balls)
    ? raw.balls
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        .map((v) => Math.floor(Math.min(MAX_LEVEL, Math.max(1, v))))
        .slice(0, BALLS.maxActive)
    : fresh.balls;
  // A game with zero balls would be an empty screen – always keep at least one.
  if (balls.length === 0) balls.push(1);

  let paddles: PaddleSave[] = fresh.paddles;
  if (Array.isArray(raw.paddles)) {
    const parsed = raw.paddles
      .filter(isObject)
      .filter((p) => SIDES.includes(p.side as Side))
      .map((p) => ({ side: p.side as Side, pos: num(p.pos, 0.5, 0, 1) }))
      .slice(0, rules.maxPaddles);
    if (parsed.length >= rules.initialSides.length) paddles = parsed;
  }

  const stats = isObject(raw.stats) ? raw.stats : {};
  const settings = isObject(raw.settings) ? raw.settings : {};
  const tutorial = isObject(raw.tutorial) ? raw.tutorial : {};
  const endless = isObject(raw.endless) ? raw.endless : {};
  const highestOwned = Math.max(...balls);

  return {
    wallet: num(raw.wallet, 0),
    mapIndex: int(raw.mapIndex, 0, 0, MAPS.length - 1),
    mapEarnings: num(raw.mapEarnings, 0),
    lifetimeEarnings: num(raw.lifetimeEarnings, 0),
    balls,
    paddles,
    ballsPurchased: int(raw.ballsPurchased, 0, 0, 500),
    // Always derived from the paddle list so the price can never drift from reality.
    paddlesPurchased: Math.max(0, paddles.length - rules.initialSides.length),
    stats: {
      playTimeMs: num(stats.playTimeMs, 0),
      totalEarned: num(stats.totalEarned, 0),
      highestLevel: Math.max(highestOwned, int(stats.highestLevel, 1, 1, MAX_LEVEL)),
      paddleHits: int(stats.paddleHits, 0),
      merges: int(stats.merges, 0),
    },
    settings: {
      sound: bool(settings.sound, true),
      haptics: bool(settings.haptics, true),
    },
    tutorial: {
      step: int(tutorial.step, 0, 0, 100),
      done: bool(tutorial.done, false),
    },
    endless: {
      prototypeComplete: bool(endless.prototypeComplete, false),
      tier: int(endless.tier, 0, 0, 1000),
    },
  };
}

export class SaveSystem {
  /** Disabled right before a progress reset so pending autosaves cannot resurrect old data. */
  private enabled = true;
  private storageOk = true;
  private readonly key: string;

  constructor(private readonly mode: GameMode) {
    this.key = SAVE_KEYS[mode];
  }

  load(): { state: GameState; recovered: boolean } {
    let text: string | null = null;
    try {
      text = window.localStorage.getItem(this.key);
    } catch {
      this.storageOk = false;
      return { state: createFreshState(this.mode), recovered: false };
    }
    if (!text) return { state: createFreshState(this.mode), recovered: false };

    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed)) throw new Error('Save is not an object');
      return { state: sanitize(migrate(parsed, this.mode), this.mode), recovered: false };
    } catch {
      // Corrupt save: keep a copy for debugging, then start fresh instead of crashing.
      try {
        window.localStorage.setItem(`${this.key}:corrupt`, text);
      } catch {
        /* storage full or unavailable – nothing else to do */
      }
      return { state: createFreshState(this.mode), recovered: true };
    }
  }

  save(state: GameState): void {
    if (!this.enabled || !this.storageOk) return;
    const file: SaveFile = { ...state, version: SAVE_VERSION, savedAt: Date.now() };
    try {
      window.localStorage.setItem(this.key, JSON.stringify(file));
    } catch {
      // Quota exceeded or private mode: the game keeps running without persistence.
      this.storageOk = false;
    }
  }

  /** Wipe the save and block further writes until the page reloads. */
  reset(): void {
    this.enabled = false;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}
