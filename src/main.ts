import './styles.css';
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './game/config';
import { createContext } from './game/context';
import { BootScene } from './game/scenes/BootScene';
import { GameScene } from './game/scenes/GameScene';
import { UIScene } from './game/scenes/UIScene';
import type { GameMode } from './game/types';

// Each game page declares its version on <html data-mode="classic|auto">.
const mode: GameMode = document.documentElement.dataset.mode === 'auto' ? 'auto' : 'classic';
const context = createContext(mode);
context.audio.attachUnlock();

// Block browser gestures that fight with gameplay: pinch zoom (iOS), double-tap zoom,
// long-press menus and page scrolling / pull-to-refresh.
const prevent = (e: Event): void => e.preventDefault();
document.addEventListener('gesturestart', prevent, { passive: false });
document.addEventListener('gesturechange', prevent, { passive: false });
document.addEventListener('dblclick', prevent, { passive: false });
document.addEventListener('contextmenu', prevent);
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length > 1 || e.cancelable) e.preventDefault();
  },
  { passive: false },
);

// Pause the simulation while a touch device is held in landscape (the CSS overlay asks to rotate).
const landscape = window.matchMedia('(orientation: landscape) and (hover: none) and (pointer: coarse)');
const syncOrientation = (): void => {
  context.orientationBlocked = landscape.matches;
};
syncOrientation();
landscape.addEventListener('change', syncOrientation);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game-root',
  backgroundColor: '#0F131C',
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  physics: {
    default: 'matter',
    matter: {
      gravity: { x: 0, y: 0 },
      // Stepped manually from GameScene for sub-stepping, slow motion and pausing.
      autoUpdate: false,
      enableSleeping: false,
      positionIterations: 8,
      velocityIterations: 6,
      debug: false,
    },
  },
  // Phaser's own audio is disabled: all sound is procedural Web Audio via AudioManager,
  // which only starts after a user gesture.
  audio: { noAudio: true },
  input: { activePointers: 3, touch: { capture: true } },
  render: { antialias: true, powerPreference: 'high-performance' },
  banner: false,
  scene: [BootScene, GameScene, UIScene],
});



