import Phaser from 'phaser';
import { COLORS, DEPTH, JUICE, TIMING } from '../config';
import { levelColor, levelColorCss } from '../data/levels';
import type { Ball } from '../entities/Ball';
import type { GameScene } from '../scenes/GameScene';
import { ctx, saveNow } from '../context';
import type { Vec2 } from '../types';
import { easeInCubic, easeInOutCubic } from '../utils/math';
import { bus } from './EventBus';

/** Timeline of the merge sequence in real milliseconds (whole thing stays under a second). */
const T_PULL = 380;
const T_ORBIT = 230;
const T_POP = T_PULL + T_ORBIT;
const T_RESUME = T_POP + 110;
const T_END = 920;
const ORBIT_RADIUS = 62;

function bezier(a: Vec2, c: Vec2, b: Vec2, t: number, out: Vec2): Vec2 {
  const u = 1 - t;
  out.x = u * u * a.x + 2 * u * t * c.x + t * t * b.x;
  out.y = u * u * a.y + 2 * u * t * c.y + t * t * b.y;
  return out;
}

/**
 * The merge moment: slow motion, magnetic pull, a short orbit, then a flash and
 * pop that replaces the pair with one ball a level higher.
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
  private readonly focus: Vec2 = { x: 0, y: 0 };
  private readonly startA: Vec2 = { x: 0, y: 0 };
  private readonly startB: Vec2 = { x: 0, y: 0 };
  private readonly ctrlA: Vec2 = { x: 0, y: 0 };
  private readonly ctrlB: Vec2 = { x: 0, y: 0 };
  private readonly endA: Vec2 = { x: 0, y: 0 };
  private readonly endB: Vec2 = { x: 0, y: 0 };
  private readonly posA: Vec2 = { x: 0, y: 0 };
  private readonly posB: Vec2 = { x: 0, y: 0 };
  private readonly field: Phaser.GameObjects.Graphics;

  constructor(private readonly game: GameScene) {
    this.field = game.add.graphics().setDepth(DEPTH.fx);
  }

  /** Lowest level that has at least two balls (ignores balls already being merged). */
  lowestLevel(balls: readonly Ball[]): number | null {
    let best: number | null = null;
    for (let i = 0; i < balls.length; i++) {
      const bi = balls[i];
      if (!bi.body || (best !== null && bi.level >= best)) continue;
      for (let j = i + 1; j < balls.length; j++) {
        if (balls[j].body && balls[j].level === bi.level) {
          best = bi.level;
          break;
        }
      }
    }
    return best;
  }

  /** The two lowest-level matching balls closest to the merge point. */
  findPair(balls: readonly Ball[]): [Ball, Ball] | null {
    const level = this.lowestLevel(balls);
    if (level === null) return null;
    const f = this.game.map.focus;
    const candidates = balls
      .filter((b) => b.body && b.level === level)
      .sort((p, q) => Math.hypot(p.x - f.x, p.y - f.y) - Math.hypot(q.x - f.x, q.y - f.y));
    return [candidates[0], candidates[1]];
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

    const f = this.game.map.focus;
    this.focus.x = f.x;
    this.focus.y = f.y;
    this.startA.x = a.x;
    this.startA.y = a.y;
    this.startB.x = b.x;
    this.startB.y = b.y;
    // The pair takes the same "side" of the orbit it approaches from so their paths don't cross.
    this.theta0 = Math.atan2(a.y - b.y, a.x - b.x);
    this.endA.x = f.x + Math.cos(this.theta0) * ORBIT_RADIUS;
    this.endA.y = f.y + Math.sin(this.theta0) * ORBIT_RADIUS;
    this.endB.x = f.x - Math.cos(this.theta0) * ORBIT_RADIUS;
    this.endB.y = f.y - Math.sin(this.theta0) * ORBIT_RADIUS;
    this.setControl(this.startA, this.endA, this.ctrlA);
    this.setControl(this.startB, this.endB, this.ctrlB);

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

  /** Curved approach: the control point is pushed sideways for a swooping, magnetic path. */
  private setControl(from: Vec2, to: Vec2, out: Vec2): void {
    const mx = (from.x + to.x) / 2;
    const my = (from.y + to.y) / 2;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(160, len * 0.32);
    out.x = mx + (-dy / len) * bend;
    out.y = my + (dx / len) * bend;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt * 1000;
    const a = this.a;
    const b = this.b;
    this.field.clear();

    if (!this.popped && a && b) {
      if (this.t < T_PULL) {
        const u = easeInOutCubic(this.t / T_PULL);
        bezier(this.startA, this.ctrlA, this.endA, u, this.posA);
        bezier(this.startB, this.ctrlB, this.endB, u, this.posB);
        a.animScale = b.animScale = 1 - 0.1 * u;
      } else if (this.t < T_POP) {
        const u = (this.t - T_PULL) / T_ORBIT;
        const theta = this.theta0 + u * u * Math.PI * 2.4;
        const r = ORBIT_RADIUS * (1 - easeInCubic(u));
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
    const bx = this.posB.x;
    const by = this.posB.y;
    const dx = bx - ax;
    const dy = by - ay;
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
