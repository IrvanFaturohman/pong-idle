import Phaser from 'phaser';
import { COLORS, DEPTH, JUICE, TIMING } from '../config';
import { ctx, saveNow } from '../context';
import { ballRadius, levelColor, levelColorCss } from '../data/levels';
import type { Ball } from '../entities/Ball';
import type { GameScene } from '../scenes/GameScene';
import type { Vec2 } from '../types';
import { easeInCubic, easeInOutCubic } from '../utils/math';
import { bus } from './EventBus';

/** Timeline of the merge sequence in real milliseconds (the whole thing stays under a second). */
const T_PULL = 360;
const T_ORBIT = 200;
const T_POP = T_PULL + T_ORBIT;
const T_RESUME = T_POP + 110;
const T_END = T_POP + 300;
const ORBIT_RADIUS = 62;

function bezier(a: Vec2, c: Vec2, b: Vec2, t: number, out: Vec2): void {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
}

/** Curved approach: the control point is pushed sideways for a swooping, magnetic path. */
function controlPoint(from: Vec2, to: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(160, len * 0.32);
  return { x: (from.x + to.x) / 2 - (dy / len) * bend, y: (from.y + to.y) / 2 + (dx / len) * bend };
}

/**
 * The merge moment: slow motion, magnetic pull, a short orbit, then a flash and
 * pop that replaces one pair with a single ball a level higher.
 */
export class MergeSystem {
  active = false;
  private a: Ball | null = null;
  private b: Ball | null = null;
  private level = 1;
  private t = 0;
  private popped = false;
  private resumed = false;
  private trailTimer = 0;
  private theta0 = 0;
  private orbit = ORBIT_RADIUS;
  private focus: Vec2 = { x: 0, y: 0 };
  private startA: Vec2 = { x: 0, y: 0 };
  private startB: Vec2 = { x: 0, y: 0 };
  private ctrlA: Vec2 = { x: 0, y: 0 };
  private ctrlB: Vec2 = { x: 0, y: 0 };
  private endA: Vec2 = { x: 0, y: 0 };
  private endB: Vec2 = { x: 0, y: 0 };
  private readonly posA: Vec2 = { x: 0, y: 0 };
  private readonly posB: Vec2 = { x: 0, y: 0 };
  private readonly field: Phaser.GameObjects.Graphics;
  /** Reused level counter (lowestLevel runs every frame for the button label). */
  private readonly counts = new Map<number, number>();

  constructor(private readonly game: GameScene) {
    this.field = game.add.graphics().setDepth(DEPTH.fx);
  }

  /** Lowest level that has at least two balls (ignores balls already being merged). */
  lowestLevel(balls: readonly Ball[]): number | null {
    const counts = this.counts;
    counts.clear();
    let best: number | null = null;
    for (const b of balls) {
      if (!b.body) continue;
      const n = (counts.get(b.level) ?? 0) + 1;
      counts.set(b.level, n);
      if (n >= 2 && (best === null || b.level < best)) best = b.level;
    }
    return best;
  }

  /** The closest two balls of the lowest mergeable level (short trip = snappy merge). */
  findPair(balls: readonly Ball[]): [Ball, Ball] | null {
    const level = this.lowestLevel(balls);
    if (level === null) return null;
    const pool = balls.filter((b) => b.body && b.level === level);
    let best: [Ball, Ball] = [pool[0], pool[1]];
    let bestDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const d = Math.hypot(pool[i].x - pool[j].x, pool[i].y - pool[j].y);
        if (d < bestDist) {
          bestDist = d;
          best = [pool[i], pool[j]];
        }
      }
    }
    return best;
  }

  /** A merge point near `p` where the new, bigger ball fits without touching an obstacle or wall. */
  private safePoint(p: Vec2, radius: number): Vec2 {
    const map = this.game.map;
    if (map.isClear(p.x, p.y, radius, 4)) return { x: p.x, y: p.y };
    for (let r = 40; r <= 240; r += 40) {
      for (let k = 0; k < 16; k++) {
        const angle = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(angle) * r;
        const y = p.y + Math.sin(angle) * r;
        if (map.isClear(x, y, radius, 4)) return { x, y };
      }
    }
    return map.findSpawnPoint(radius);
  }

  start(a: Ball, b: Ball): void {
    const c = ctx();
    this.active = true;
    this.a = a;
    this.b = b;
    this.level = a.level;
    this.t = 0;
    this.popped = false;
    this.resumed = false;
    this.trailTimer = 0;

    // The pair meets between the two balls, nudged to a spot where the bigger ball fits.
    this.focus = this.safePoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ballRadius(this.level + 1));
    this.orbit = Math.min(ORBIT_RADIUS, Math.max(30, Math.hypot(a.x - b.x, a.y - b.y) / 2));
    // Each ball takes the side of the orbit it approaches from so the paths don't cross.
    this.theta0 = Math.atan2(a.y - b.y, a.x - b.x);
    const f = this.focus;
    this.startA = { x: a.x, y: a.y };
    this.startB = { x: b.x, y: b.y };
    this.endA = { x: f.x + Math.cos(this.theta0) * this.orbit, y: f.y + Math.sin(this.theta0) * this.orbit };
    this.endB = { x: f.x - Math.cos(this.theta0) * this.orbit, y: f.y - Math.sin(this.theta0) * this.orbit };
    this.ctrlA = controlPoint(this.startA, this.endA);
    this.ctrlB = controlPoint(this.startB, this.endB);

    // Pull both balls out of the simulation – they are animated by hand from here.
    this.game.detachBallBody(a);
    this.game.detachBallBody(b);
    a.highlightMs = 0;
    b.highlightMs = 0;

    this.game.tweenSimScale(TIMING.mergeSlowScale, 120);
    c.audio.mergeRise();
    c.haptics.pulse(10, 0);
    bus.emit('merge-started', this.level);
    bus.emit('lock-changed', true);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt * 1000;
    this.field.clear();
    const a = this.a;
    const b = this.b;

    if (!this.popped && a && b) {
      if (this.t < T_PULL) {
        const u = easeInOutCubic(this.t / T_PULL);
        bezier(this.startA, this.ctrlA, this.endA, u, this.posA);
        bezier(this.startB, this.ctrlB, this.endB, u, this.posB);
        a.animScale = b.animScale = 1 - 0.1 * u;
      } else {
        const u = Math.min(1, (this.t - T_PULL) / T_ORBIT);
        const theta = this.theta0 + u * u * Math.PI * 2.4;
        const r = this.orbit * (1 - easeInCubic(u));
        this.posA.x = this.focus.x + Math.cos(theta) * r;
        this.posA.y = this.focus.y + Math.sin(theta) * r;
        this.posB.x = this.focus.x - Math.cos(theta) * r;
        this.posB.y = this.focus.y - Math.sin(theta) * r;
        a.animScale = b.animScale = 0.9 - 0.18 * u;
      }
      a.container.setPosition(this.posA.x, this.posA.y);
      b.container.setPosition(this.posB.x, this.posB.y);
      this.drawField(a.color);

      this.trailTimer -= dt * 1000;
      if (this.trailTimer <= 0) {
        this.trailTimer = 22;
        this.game.juice.trailDot(this.posA.x, this.posA.y, a.color);
        this.game.juice.trailDot(this.posB.x, this.posB.y, b.color);
      }
      if (this.t >= T_POP) this.pop(a, b);
    }

    if (this.popped && !this.resumed && this.t >= T_RESUME) {
      this.resumed = true;
      this.game.tweenSimScale(1, 240);
    }
    if (this.t >= T_END) this.finish();
  }

  /** Wavy "magnetic field" line between the two balls. */
  private drawField(color: number): void {
    const segments = 18;
    const ax = this.posA.x;
    const ay = this.posA.y;
    const dx = this.posB.x - ax;
    const dy = this.posB.y - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const phase = this.t * 0.03;
    for (const [width, alpha, amp] of [
      [10, 0.12, 12],
      [3, 0.75, 9],
    ] as const) {
      this.field.lineStyle(width, color, alpha);
      this.field.beginPath();
      for (let i = 0; i <= segments; i++) {
        const s = i / segments;
        const wave = Math.sin(s * Math.PI * 3 + phase) * amp * Math.sin(s * Math.PI);
        const px = ax + dx * s + nx * wave;
        const py = ay + dy * s + ny * wave;
        if (i === 0) this.field.moveTo(px, py);
        else this.field.lineTo(px, py);
      }
      this.field.strokePath();
    }
  }

  private pop(a: Ball, b: Ball): void {
    const c = ctx();
    this.popped = true;
    const newLevel = this.level + 1;
    const { x, y } = this.focus;
    this.game.removeBall(a);
    this.game.removeBall(b);
    this.a = null;
    this.b = null;

    const ball = this.game.spawnBall(newLevel, x, y, 'merge');
    const color = levelColor(newLevel);
    const j = this.game.juice;
    j.flash(x, y, color, 3.4, 380);
    j.flash(x, y, COLORS.textPrimary, 1.8, 220);
    j.ring(x, y, color, ball.radius, ball.radius * 7, 520, 16);
    j.ring(x, y, COLORS.textPrimary, ball.radius * 0.8, ball.radius * 4.2, 320, 6);
    j.radialBurst(x, y, [levelColor(this.level), color, COLORS.textPrimary], 38);
    j.label(x, y - ball.radius - 70, 'LEVEL UP!', levelColorCss(newLevel), 66, 1150);
    j.shake(JUICE.mergeShake.duration, JUICE.mergeShake.intensity);
    c.audio.mergePop(newLevel);
    c.haptics.pulse(28, 0);

    c.state.stats.merges++;
    c.state.stats.highestLevel = Math.max(c.state.stats.highestLevel, newLevel);
    this.game.syncBallState();
    bus.emit('merged', newLevel);
  }

  private finish(): void {
    this.active = false;
    this.field.clear();
    if (!this.resumed) this.game.tweenSimScale(1, 200);
    saveNow();
    bus.emit('lock-changed', false);
  }
}
