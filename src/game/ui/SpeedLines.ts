import Phaser from 'phaser';
import { ARENA, BOOST, COLORS, CSS_COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { formatMultiplier } from '../utils/formatNumber';
import { damp, randRange } from '../utils/math';
import { textStyle } from './widgets';

interface Streak {
  angle: number;
  dx: number;
  dy: number;
  /** Distance from the screen center to the screen edge along this streak's ray. */
  edge: number;
  dist: number;
  len: number;
  speed: number;
  width: number;
}

const STREAKS = 44;
/** Streaks live in this band just inside the screen edges. */
const BAND = 210;
const CX = GAME_WIDTH / 2;
const CY = ARENA.centerY;

/**
 * Tap-to-speed-up feedback: anime-style speed lines rushing out along the screen
 * edges, a soft edge glow and a "SPEED ×2.1" pill. Intensity follows the boost.
 */
export class SpeedLines {
  private readonly lines: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly pill: Phaser.GameObjects.Container;
  private readonly pillBg: Phaser.GameObjects.Graphics;
  private readonly pillText: Phaser.GameObjects.Text;
  private readonly streaks: Streak[] = [];
  private intensity = 0;
  private lastLabel = '';

  constructor(private readonly scene: Phaser.Scene, depth: number) {
    this.glow = scene.add.graphics().setDepth(depth);
    this.lines = scene.add.graphics().setDepth(depth);
    this.pillBg = scene.add.graphics();
    this.pillText = scene.add.text(20, -2, '', textStyle(32, CSS_COLORS.ink, '800', { letterSpacing: 2 })).setOrigin(0.5);
    this.pill = scene.add.container(GAME_WIDTH / 2, ARENA.top + 96, [this.pillBg, this.pillText]).setDepth(depth).setAlpha(0);
    for (let i = 0; i < STREAKS; i++) {
      const s: Streak = { angle: 0, dx: 0, dy: 0, edge: 0, dist: 0, len: 0, speed: 0, width: 0 };
      this.respawn(s, true);
      this.streaks.push(s);
    }
  }

  private respawn(s: Streak, anywhere: boolean): void {
    s.angle = randRange(0, Math.PI * 2);
    s.dx = Math.cos(s.angle);
    s.dy = Math.sin(s.angle);
    // Distance to the screen rectangle along the ray.
    const tx = s.dx > 0 ? (GAME_WIDTH - CX) / s.dx : s.dx < 0 ? -CX / s.dx : Infinity;
    const ty = s.dy > 0 ? (GAME_HEIGHT - CY) / s.dy : s.dy < 0 ? -CY / s.dy : Infinity;
    s.edge = Math.min(tx, ty);
    s.len = randRange(70, 190);
    s.speed = randRange(1400, 2600);
    s.width = randRange(3, 7);
    s.dist = s.edge - BAND - s.len + (anywhere ? randRange(0, BAND + s.len) : randRange(0, 60));
  }

  /** Little pop on every tap. */
  pulse(): void {
    this.scene.tweens.killTweensOf(this.pill);
    this.pill.setScale(1.18);
    this.scene.tweens.add({ targets: this.pill, scale: 1, duration: 260, ease: 'Back.easeOut' });
  }

  update(dt: number, boost: number): void {
    const target = Math.max(0, Math.min(1, (boost - 1) / (BOOST.max - 1)));
    this.intensity += (target - this.intensity) * damp(12, dt);
    const k = this.intensity;

    this.lines.clear();
    this.glow.clear();
    if (k < 0.01) {
      this.pill.setAlpha(0);
      return;
    }

    // Soft glow creeping in from all four edges.
    const a = 0.28 * k;
    const w = 150;
    const glowColor = COLORS.yellow;
    this.glow.fillGradientStyle(glowColor, glowColor, glowColor, glowColor, a, 0, a, 0);
    this.glow.fillRect(0, 0, w, GAME_HEIGHT);
    this.glow.fillGradientStyle(glowColor, glowColor, glowColor, glowColor, 0, a, 0, a);
    this.glow.fillRect(GAME_WIDTH - w, 0, w, GAME_HEIGHT);
    this.glow.fillGradientStyle(glowColor, glowColor, glowColor, glowColor, a, a, 0, 0);
    this.glow.fillRect(0, 0, GAME_WIDTH, w);
    this.glow.fillGradientStyle(glowColor, glowColor, glowColor, glowColor, 0, 0, a, a);
    this.glow.fillRect(0, GAME_HEIGHT - w, GAME_WIDTH, w);

    // Speed lines rushing outward past the edges; faster and denser with more boost.
    const active = Math.ceil(STREAKS * (0.35 + 0.65 * k));
    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i];
      s.dist += s.speed * (0.6 + k) * dt;
      if (s.dist > s.edge + 20) this.respawn(s, false);
      if (i >= active) continue;
      const start = Math.max(s.dist, s.edge - BAND);
      const end = Math.min(s.dist + s.len, s.edge + 10);
      if (end <= start) continue;
      // Fade in as the streak enters the edge band.
      const fade = Math.min(1, (end - (s.edge - BAND)) / 80);
      this.lines.lineStyle(s.width * (0.6 + 0.4 * k), 0xffffff, 0.55 * k * fade);
      this.lines.lineBetween(CX + s.dx * start, CY + s.dy * start, CX + s.dx * end, CY + s.dy * end);
    }

    const label = `SPEED ${formatMultiplier(Math.round(boost * 10) / 10)}`;
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.pillText.setText(label);
      const pw = this.pillText.width + 110;
      this.pillBg.clear();
      this.pillBg.fillStyle(COLORS.shadow, 0.4);
      this.pillBg.fillRoundedRect(-pw / 2, -30, pw, 64, 32);
      this.pillBg.fillStyle(COLORS.yellow, 1);
      this.pillBg.fillRoundedRect(-pw / 2, -34, pw, 64, 32);
      // Double chevron "fast forward" icon.
      const ix = -pw / 2 + 30;
      this.pillBg.fillStyle(COLORS.background, 1);
      this.pillBg.fillTriangle(ix, -14, ix + 16, -2, ix, 10);
      this.pillBg.fillTriangle(ix + 14, -14, ix + 30, -2, ix + 14, 10);
    }
    this.pill.setAlpha(Math.min(1, k * 2.5));
  }
}
