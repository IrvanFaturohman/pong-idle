import { AudioManager } from './systems/AudioManager';
import { EconomySystem } from './systems/EconomySystem';
import { Haptics } from './systems/Haptics';
import { SaveSystem } from './systems/SaveSystem';
import type { GameState } from './types';

/**
 * Shared, scene-independent services. Created once in `main.ts` before Phaser boots.
 */
export interface GameContext {
  state: GameState;
  saves: SaveSystem;
  economy: EconomySystem;
  audio: AudioManager;
  haptics: Haptics;
  /** True while a modal (settings / completion) covers the game. */
  modalOpen: boolean;
  /** True while a touch device is held in landscape (rotate overlay visible). */
  orientationBlocked: boolean;
}

let context: GameContext | null = null;

export function createContext(): GameContext {
  const saves = new SaveSystem();
  const { state } = saves.load();
  const audio = new AudioManager(!state.settings.sound);
  context = {
    state,
    saves,
    economy: new EconomySystem(state),
    audio,
    haptics: new Haptics(state.settings.haptics),
    modalOpen: false,
    orientationBlocked: false,
  };
  return context;
}

export function ctx(): GameContext {
  if (!context) throw new Error('Game context not initialised');
  return context;
}

export function saveNow(): void {
  const c = ctx();
  c.saves.save(c.state);
}
