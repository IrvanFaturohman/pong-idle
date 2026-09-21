import type { GameMode, Side } from './types';

/**
 * Central tuning file for layout, physics, paddles, audio and "juice".
 * Economy numbers live in `data/economy.ts`, map definitions in `data/maps.ts`
 * and ball level visuals in `data/levels.ts`.
 */

export const GAME_WIDTH = 1080;
export const GAME_HEIGHT = 1920;

export const FONT_FAMILY =
  'Inter, ui-rounded, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** Base palette (numeric for Phaser graphics, CSS strings for Text objects). */
export const COLORS = {
  background: 0x0f131c,
  arena: 0x171d28,
  arenaBorder: 0x2b3444,
  yellow: 0xffc83d,
  green: 0x64e572,
  coral: 0xff657a,
  textPrimary: 0xf5f7fa,
  textSecondary: 0x98a3b5,
  buttonSurface: 0x242c39,
  buttonDisabled: 0x343a45,
  shadow: 0x05070b,
} as const;

export const CSS_COLORS = {
  yellow: '#FFC83D',
  green: '#64E572',
  coral: '#FF657A',
  textPrimary: '#F5F7FA',
  textSecondary: '#98A3B5',
  textDisabled: '#6B7486',
  ink: '#1A1F2B',
} as const;

/** Screen layout in virtual pixels (1080 x 1920 portrait). */
export const LAYOUT = {
  arena: { x: 70, y: 330, width: 940, height: 1210, cornerRadius: 30 },
  hud: {
    left: 70,
    right: 1010,
    mapLabelY: 62,
    mapNameY: 104,
    walletY: 186,
    progressLabelY: 246,
    progressBarY: 268,
    progressBarHeight: 26,
    iconButtonY: 96,
    iconButtonRadius: 50,
    iconButtonHit: 138,
  },
  panel: { x: 70, y: 1600, width: 940, height: 270, gap: 22 },
} as const;

export const ARENA = {
  left: LAYOUT.arena.x,
  top: LAYOUT.arena.y,
  right: LAYOUT.arena.x + LAYOUT.arena.width,
  bottom: LAYOUT.arena.y + LAYOUT.arena.height,
  width: LAYOUT.arena.width,
  height: LAYOUT.arena.height,
  centerX: LAYOUT.arena.x + LAYOUT.arena.width / 2,
  centerY: LAYOUT.arena.y + LAYOUT.arena.height / 2,
} as const;

/** Matter collision categories. Balls never collide with each other. */
export const CATEGORY = {
  wall: 0x0001,
  paddle: 0x0002,
  ball: 0x0004,
  obstacle: 0x0008,
} as const;

export const PHYSICS = {
  /** Ball speed on Map 1 in virtual pixels per second. Maps apply a speed factor on top. */
  baseBallSpeed: 1000,
  /** Largest physics sub-step. Small sub-steps keep fast balls from tunnelling through paddles. */
  maxSubstepMs: 1000 / 120,
  /** Frame delta clamp so a long frame (tab switch, GC hitch) never explodes the simulation. */
  maxFrameMs: 50,
  /** Minimum angle between a ball's direction and the horizontal axis (prevents endless side-to-side loops). */
  minAngleFromHorizontalDeg: 21,
  /** Minimum angle between a ball's direction and the vertical axis (prevents endless up-down loops). */
  minAngleFromVerticalDeg: 9,
  /** After this many near-identical bounce angles in a row a ball gets a small random nudge. */
  repeatBounceLimit: 4,
  repeatAngleToleranceDeg: 2.5,
  repeatNudgeMinDeg: 4,
  repeatNudgeMaxDeg: 9,
  /**
   * Stuck detection: if every position sampled during the window fits inside a box this small,
   * the ball is trapped (a free ball crosses most of the arena in that time) and is re-spawned.
   */
  stuckWindowMs: 2000,
  stuckBoxSize: 140,
  /** Seconds a ball may overlap an obstacle before it is safely restored. */
  obstacleOverlapLimitMs: 350,
  wallThickness: 400,
} as const;

export const BALLS = {
  /** Lots of balls is the fun part: the arena holds up to this many. */
  maxActive: 40,
  baseRadius: 30,
  radiusPerLevel: 3,
  maxRadius: 48,
  /** Trail samples drawn behind a ball = base + level (capped). */
  trailBase: 3,
  trailMax: 8,
  spawnHighlightMs: 1300,
} as const;

export const PADDLES = {
  length: 230,
  thickness: 32,
  /** Gap between the paddle's back and the arena wall (smaller than any ball, so nothing gets wedged). */
  wallGap: 8,
  /** Minimum gap kept between two paddles on the same side. */
  sameSideGap: 16,
  /** Distance kept free at both ends of the left/right rails so side paddles never overlap top/bottom ones. */
  cornerClearance: 14,
  /** Generous invisible touch area around each paddle. */
  hitboxAlongExtra: 70,
  hitboxOutside: 60,
  hitboxInside: 125,
  /** Exponential follow rate towards the finger (higher = snappier). */
  followSharpness: 30,
  /** Max paddle travel speed (px/s) – prevents violent shoves into balls. */
  maxSpeed: 3600,
  /** Fraction of the paddle's own velocity transferred to the ball's rebound. */
  influence: 0.16,
  /** Cap on the influence as a fraction of the ball's speed. */
  maxInfluence: 0.32,
  /** Classic Pong "english": hitting near a paddle end angles the rebound. */
  english: 0.2,
  /** Minimum time between two rewards for the same ball on the same paddle. */
  hitCooldownMs: 140,
  dragScale: 1.07,
  maxTiltDeg: 5,
} as const;

export interface ModeRules {
  /** Sides whose paddles the player controls / can buy for. */
  movableSides: readonly Side[];
  /** Movable paddles a new game starts with. */
  initialSides: readonly Side[];
  /** Sides of the paddles bought afterwards, in purchase order (full rails are skipped). */
  purchaseOrder: readonly Side[];
  /** Maximum number of movable paddles. */
  maxPaddles: number;
  /** Classic: the whole top wall is one fixed paddle, so every top bounce pays. */
  fullTopBar: boolean;
}

/** Per-version rules. */
export const MODE_RULES: Record<GameMode, ModeRules> = {
  classic: {
    movableSides: ['bottom', 'left', 'right'],
    initialSides: ['bottom', 'left', 'right'],
    purchaseOrder: ['bottom', 'left', 'right', 'bottom', 'left', 'right'],
    maxPaddles: 9,
    fullTopBar: true,
  },
  auto: {
    movableSides: ['top', 'bottom', 'left', 'right'],
    initialSides: ['top', 'bottom', 'left', 'right'],
    purchaseOrder: ['bottom', 'top', 'left', 'right'],
    maxPaddles: 8,
    fullTopBar: false,
  },
};

export const AUDIO = {
  masterVolume: 0.55,
  maxVoices: 14,
  minIntervalMs: {
    wall: 45,
    paddle: 28,
    obstacle: 40,
    ui: 30,
  },
} as const;

/** Game-feel intensities. Everything that shakes, squashes or sparkles is tuned here. */
export const JUICE = {
  ballSquash: 0.26,
  ballSquashStrongBonus: 0.08,
  paddleSquash: 0.3,
  paddleKick: 7,
  /** Camera impulse on paddle hits: level 1 is almost imperceptible, high levels a little stronger. */
  cameraKickBase: 0.5,
  cameraKickPerLevel: 0.8,
  cameraKickMax: 7,
  /** At most one camera kick this often, so dozens of balls never turn into constant shaking. */
  cameraKickMinIntervalMs: 90,
  /** The full-width top bar reacts more gently (it gets hit constantly). */
  fullBarFeedbackScale: 0.3,
  mergeShake: { duration: 140, intensity: 0.004 },
  mapCompleteShake: { duration: 600, intensity: 0.006 },
  hitParticlesBase: 5,
  hitParticlesPerLevel: 2,
  hitParticlesMax: 16,
  floatTextMs: 900,
  floatTextMergeRadius: 90,
  floatTextMergeWindowMs: 260,
  walletLerp: 9,
  hapticPaddleMinLevel: 4,
} as const;

/** Auto mode: AI-driven paddles that the player re-assigns to sides. */
export const AUTO = {
  /** Top rail speed of an AI paddle (px/s, scaled by the tap boost). Lower = more misses. */
  paddleSpeed: 640,
  /** Balls further away than this (in 1/60 s frames) are ignored by the AI. */
  horizonFrames: 150,
  /** The AI aims slightly off-center (up to ± this many px) so rebound angles vary. */
  aimSpread: 38,
  /** Scale of a paddle while it is being carried to another side. */
  carryScale: 1.12,
} as const;

/** Tap-to-speed-up: every tap on the open arena pushes the simulation faster for a moment. */
export const BOOST = {
  perTap: 0.3,
  max: 2.5,
  /** The boost holds this long after the last tap before it starts to wind down. */
  holdMs: 450,
  decayPerSecond: 0.9,
  /** How quickly the actual speed follows the target (higher = snappier). */
  sharpness: 10,
} as const;

export const TIMING = {
  autosaveMs: 10000,
  mergeSlowScale: 0.2,
  mapFadeOutMs: 380,
  mapFadeInMs: 460,
} as const;

/** Render order inside the game scene. */
export const DEPTH = {
  background: 0,
  arena: 1,
  rails: 2,
  obstacles: 3,
  trails: 4,
  balls: 5,
  paddles: 6,
  particles: 7,
  fx: 8,
  floatText: 9,
} as const;
