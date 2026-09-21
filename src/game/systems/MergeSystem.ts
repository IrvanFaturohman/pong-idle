import Phaser from 'phaser';
import { ARENA, COLORS, DEPTH, JUICE, TIMING } from '../config';
import { ctx, saveNow } from '../context';
import { ballRadius, levelColor, levelColorCss } from '../data/levels';
import type { Ball } from '../entities/Ball';
import type { GameScene } from '../scenes/GameScene';
import type { Vec2 } from '../types';
import { easeInCubic, easeInOutCubic } from '../utils/math';
import { bus } from './EventBus';

/** Per-pair timeline in real milliseconds. */
const T_PULL = 360;
const T_ORBIT = 200;
const T_POP = T_PULL + T_ORBIT;
/** The whole wave of pops is spread over at most this long, so big merges stay snappy. */
const WAVE_SPREAD = 450;
const MAX_STAGGER = 70;
/** Time after the last pop before the merge is finished and input unlocks. */
const TAIL = 320;
const ORBIT_RADIUS = 62;

interface PairMerge {
  a: Ball;
  b: Ball;
  focus: Vec2;
  startA: Vec2;
  startB: Vec2;
  ctrlA: Vec2;
  ctrlB: Vec2;
  endA: Vec2;
  endB: Vec2;
  posA: Vec2;
  posB: Vec2;
  theta0: number;
  orbit: number;
  delay: number;
  popped: boolean;
}

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
 * The merge moment. One press merges every pair at the lowest level: time
 * slows, each pair is pulled together on a magnetic curve, orbits briefly and
 * pops into one ball a level higher. Pairs pop in a quick staggered wave
 * (with a rising cascade of notes), radiating out from the arena center.
 */
export class MergeSystem {
  active = false;
  private pairs: PairMerge[] = [];
  private level = 1;
  private t = 0;
  private popCount = 0;
  private lastPopAt = 0;
  private resumed = false;
  private trailTimer = 0;
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

  /** Number of pairs the next merge would combine. */
  pairCount(balls: readonly Ball[]): number {
    const level = this.lowestLevel(balls);
    if (level === null) return 0;
    let n = 0;
    for (const b of balls) if (b.body && b.level === level) n++;
    return Math.floor(n / 2);
  }

  /** Every lowest-level pair, matching nearest neighbours so balls travel as little as possible. */
  findPairs(balls: readonly Ball[]): Array<[Ball, Ball]> {
    const level = this.lowestLevel(balls);
    if (level === null) return [];
    const pool = balls.filter((b) => b.body && b.level === level);
    const pairs: Array<[Ball, Ball]> = [];
    while (pool.length >= 2) {
      const a = pool.shift() as Ball;
      let bestIndex = 0;
      let bestDist = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const d = Math.hypot(pool[i].x - a.x, pool[i].y - a.y);
        if (d < bestDist) {
          bestDist = d;
          bestIndex = i;
        }
      }
      pairs.push([a, pool.splice(bestIndex, 1)[0]]);
    }
    return pairs;
  }

  /** A merge point near `p` where the new, bigger ball fits without touching an obstacle or wall. */
  private safePoint(p: Vec2, radius: number): Vec2 {
    const map = this.game.map;
    if (map.isClear(p.x, p.y, radius, 4)) return { x: p.x, y: p.y };
    for (let r = 40; r <= 240; r += 40) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r;
        const y = p.y + Math.sin(a) * r;
        if (map.isClear(x, y, radius, 4)) return { x, y };
      }
    }
    return map.findSpawnPoint(radius);
  }

  start(pairs: Array<[Ball, Ball]>): void {
    if (pairs.length === 0) return;
    const c = ctx();
    this.active = true;
    this.level = pairs[0][0].level;
    this.t = 0;
    this.popCount = 0;
    this.lastPopAt = 0;
    this.resumed = false;
    this.trailTimer = 0;

    const newRadius = ballRadius(this.level + 1);
    this.pairs = pairs.map(([a, b]) => {
      const focus = this.safePoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, newRadius);
      const orbit = Math.min(ORBIT_RADIUS, Math.max(30, Math.hypot(a.x - b.x, a.y - b.y) / 2));
      // Each ball takes the side of the orbit it approaches from so the paths don't cross.
      const theta0 = Math.atan2(a.y - b.y, a.x - b.x);
      const startA = { x: a.x, y: a.y };
      const startB = { x: b.x, y: b.y };
      const endA = { x: focus.x + Math.cos(theta0) * orbit, y: focus.y + Math.sin(theta0) * orbit };
      const endB = { x: focus.x - Math.cos(theta0) * orbit, y: focus.y - Math.sin(theta0) * orbit };
      return {
        a,
        b,
        focus,
        startA,
        startB,
        endA,
        endB,
        ctrlA: controlPoint(startA, endA),
        ctrlB: controlPoint(startB, endB),
        posA: { ...startA },
        posB: { ...startB },
        theta0,
        orbit,
        delay: 0,
        popped: false,
      };
    });
    // Pops radiate outward from the arena center.
    this.pairs.sort(
      (p, q) => Math.hypot(p.focus.x - ARENA.centerX, p.focus.y - ARENA.centerY) - Math.hypot(q.focus.x - ARENA.centerX, q.focus.y - ARENA.centerY),
    );
    const stagger = this.pairs.length > 1 ? Math.min(MAX_STAGGER, WAVE_SPREAD / (this.pairs.length - 1)) : 0;
    this.pairs.forEach((p, i) => {
      p.delay = i * stagger;
      // Pull both balls out of the simulation – they are animated by hand from here.
      this.game.detachBallBody(p.a);
      this.game.detachBallBody(p.b);
      p.a.highlightMs = 0;
      p.b.highlightMs = 0;
    });

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
    const many = this.pairs.length > 8;
    this.trailTimer -= dt * 1000;
    const dropTrail = this.trailTimer <= 0;
    if (dropTrail) this.trailTimer = many ? 45 : 22;

    for (const p of this.pairs) {
      if (p.popped) continue;
      const local = this.t - p.delay;
      const { a, b } = p;
      if (local >= 0 && local < T_PULL) {
        const u = easeInOutCubic(local / T_PULL);
        bezier(p.startA, p.ctrlA, p.endA, u, p.posA);
        bezier(p.startB, p.ctrlB, p.endB, u, p.posB);
        a.animScale = b.animScale = 1 - 0.1 * u;
      } else if (local >= T_PULL) {
        const u = Math.min(1, (local - T_PULL) / T_ORBIT);
        const theta = p.theta0 + u * u * Math.PI * 2.4;
        const r = p.orbit * (1 - easeInCubic(u));
        p.posA.x = p.focus.x + Math.cos(theta) * r;
        p.posA.y = p.focus.y + Math.sin(theta) * r;
        p.posB.x = p.focus.x - Math.cos(theta) * r;
        p.posB.y = p.focus.y - Math.sin(theta) * r;
        a.animScale = b.animScale = 0.9 - 0.18 * u;
      }
      a.container.setPosition(p.posA.x, p.posA.y);
      b.container.setPosition(p.posB.x, p.posB.y);
      this.drawField(p, a.color, many);
      if (dropTrail && local >= 0) {
        this.game.juice.trailDot(p.posA.x, p.posA.y, a.color);
        this.game.juice.trailDot(p.posB.x, p.posB.y, b.color);
      }
      if (local >= T_POP) this.pop(p);
    }

    const allPopped = this.popCount === this.pairs.length;
    if (allPopped && !this.resumed && this.t >= this.lastPopAt + 110) {
      this.resumed = true;
      this.game.tweenSimScale(1, 240);
    }
    if (allPopped && this.t >= this.lastPopAt + TAIL) this.finish();
  }

  /** Wavy "magnetic field" line between the two balls of a pair. */
  private drawField(p: PairMerge, color: number, many: boolean): void {
    const segments = many ? 10 : 18;
    const ax = p.posA.x;
    const ay = p.posA.y;
    const dx = p.posB.x - ax;
    const dy = p.posB.y - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const phase = this.t * 0.03;
    const passes: ReadonlyArray<readonly [number, number, number]> = many ? [[3, 0.6, 7]] : [[10, 0.12, 12], [3, 0.75, 9]];
    for (const [width, alpha, amp] of passes) {
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

  private pop(p: PairMerge): void {
    const c = ctx();
    p.popped = true;
    const index = this.popCount++;
    this.lastPopAt = this.t;
    const total = this.pairs.length;
    const newLevel = this.level + 1;
    const { x, y } = p.focus;
    this.game.removeBall(p.a);
    this.game.removeBall(p.b);

    const ball = this.game.spawnBall(newLevel, x, y, 'merge');
    const color = levelColor(newLevel);
    const j = this.game.juice;
    // Big merges scale each pop down a little so the screen stays readable.
    const k = total > 1 ? Math.max(0.55, 1 / Math.sqrt(total) + 0.35) : 1;
    j.flash(x, y, color, 3.4 * k, 380);
    j.ring(x, y, color, ball.radius, ball.radius * 7 * k, 520, 16 * k);
    if (index === 0 || total <= 6) j.ring(x, y, COLORS.textPrimary, ball.radius * 0.8, ball.radius * 4.2, 320, 6);
    j.radialBurst(x, y, [levelColor(this.level), color, COLORS.textPrimary], Math.round(38 * k));

    if (total === 1) {
      c.audio.mergePop(newLevel);
    } else {
      c.audio.mergeCascade(index, newLevel);
    }
    if (index === 0) {
      j.label(x, y - ball.radius - 70, total > 1 ? `LEVEL UP ×${total}` : 'LEVEL UP!', levelColorCss(newLevel), 66, 1300);
      j.shake(JUICE.mergeShake.duration, JUICE.mergeShake.intensity);
      c.haptics.pulse(28, 0);
      bus.emit('merged', newLevel);
    } else if (index === total - 1) {
      j.shake(JUICE.mergeShake.duration + 60, JUICE.mergeShake.intensity * 1.3);
      c.haptics.pulse(20, 0);
    }

    c.state.stats.merges++;
    c.state.stats.highestLevel = Math.max(c.state.stats.highestLevel, newLevel);
    this.game.syncBallState();
  }

  private finish(): void {
    this.active = false;
    this.pairs = [];
    this.field.clear();
    if (!this.resumed) this.game.tweenSimScale(1, 200);
    saveNow();
    bus.emit('lock-changed', false);
  }
}
