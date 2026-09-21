export type Side = 'top' | 'bottom' | 'left' | 'right';


export interface Vec2 {
  x: number;
  y: number;
}

export interface PaddleSave {
  side: Side;
  /** Normalized position along the paddle's rail (0 = start, 1 = end). */
  pos: number;
}

export interface GameStats {
  playTimeMs: number;
  totalEarned: number;
  highestLevel: number;
  paddleHits: number;
  merges: number;
}

export interface GameSettings {
  sound: boolean;
  haptics: boolean;
}

export interface TutorialSave {
  /** Index of the next tutorial step to show. */
  step: number;
  done: boolean;
}

export interface EndlessSave {
  /** Map 3 target reached at least once (prototype complete celebration triggered). */
  prototypeComplete: boolean;
  /** 0 = not in endless mode yet, 1+ = current endless tier. */
  tier: number;
}

/** The complete persistent game state. Saved as-is (plus a version field). */
export interface GameState {
  wallet: number;
  mapIndex: number;
  /** Money earned on the current map (or endless tier). Only ever increases until the map is cleared. */
  mapEarnings: number;
  lifetimeEarnings: number;
  /** Levels of every owned ball. */
  balls: number[];
  paddles: PaddleSave[];
  ballsPurchased: number;
  paddlesPurchased: number;
  stats: GameStats;
  settings: GameSettings;
  tutorial: TutorialSave;
  endless: EndlessSave;
}

export interface SaveFile extends GameState {
  version: number;
  savedAt: number;
}

export type PurchaseResult = 'ok' | 'locked' | 'poor' | 'full' | 'max' | 'nomatch';

export type ObstacleDef =
  | { kind: 'diamond'; x: number; y: number; halfWidth: number; halfHeight: number }
  | { kind: 'bumper'; x: number; y: number; radius: number }
  | { kind: 'bar'; x: number; y: number; length: number; thickness: number; angularSpeed: number };

export interface MapPalette {
  background: number;
  arenaTop: number;
  arenaBottom: number;
  border: number;
  rail: number;
  paddle: number;
  accent: number;
  obstacle: number;
  obstacleLight: number;
  obstacleDark: number;
  /** Secondary accent used by moving obstacles (the rotating bar). */
  secondary: number;
}

export interface MapDef {
  id: number;
  name: string;
  multiplier: number;
  target: number;
  speedFactor: number;
  palette: MapPalette;
  /** Obstacles positioned relative to the arena center (virtual px). */
  obstacles: ObstacleDef[];
  /** Spawn / merge focus point relative to the arena center (virtual px). Must be clear of obstacles. */
  focus: Vec2;
}
