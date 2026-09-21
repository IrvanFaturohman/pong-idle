import Phaser from 'phaser';
import { BALLS, CATEGORY, CSS_COLORS, DEPTH, FONT_FAMILY } from '../config';
import { ballRadius, levelColor, levelStars } from '../data/levels';
import type { Vec2 } from '../types';
import { TEX } from '../utils/textures';

let nextBallId = 1;

/**
 * A permanent, player-owned ball. The Matter body handles collisions; the
 * visual container follows it and adds squash & stretch, highlight and label.
 * A ball is only ever destroyed when it is merged into a higher level ball.
 */
export class Ball {
  readonly id = nextBallId++;
  readonly radius: number;
  readonly color: number;
  body: MatterJS.BodyType | null = null;
  readonly container: Phaser.GameObjects.Container;

  /** Consecutive paddle hits without touching a normal wall. */
  comboChain = 0;
  /** Simulation time of the last rewarded hit per paddle id (duplicate-reward guard). */
  readonly lastPaddleHit = new Map<number, number>();

  /** Ring buffer of recent positions for the motion trail (preallocated, no per-frame garbage). */
  private readonly trailPts: Vec2[];
  private trailHead = 0;
  trailCount = 0;

  /** Stability bookkeeping (see GameScene.checkBallHealth). */
  lastBounceAngle = Number.NaN;
  repeatCount = 0;
  /** Bounding box of positions sampled since `trackStart` (sim ms). */
  readonly trackBox = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  trackStart = 0;
  obstacleOverlapMs = 0;

  /** Remaining ms of the post-spawn highlight ring. */
  highlightMs = 0;
  /** Extra scale driven by spawn / merge animations. */
  animScale = 1;

  private readonly base: Phaser.GameObjects.Image;
  private readonly shine: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private readonly label: Phaser.GameObjects.Text;
  private squash = 0;
  private squashVel = 0;
  private squashNx = 0;
  private squashNy = 1;
  private dirX = 0;
  private dirY = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly level: number,
    x: number,
    y: number,
  ) {
    this.radius = ballRadius(level);
    this.color = levelColor(level);
    const trailLength = Math.min(BALLS.trailMax, BALLS.trailBase + level);
    this.trailPts = Array.from({ length: trailLength }, () => ({ x: 0, y: 0 }));
    const r = this.radius;

    this.shadow = scene.add.image(r * 0.18, r * 0.42, TEX.softShadow).setDisplaySize(r * 2.5, r * 2.5).setAlpha(0.42);
    this.base = scene.add.image(0, 0, TEX.ball).setDisplaySize(r * 2, r * 2).setTint(this.color);
    this.shine = scene.add.image(-r * 0.3, -r * 0.38, TEX.ballHighlight).setDisplaySize(r * 0.95, r * 0.65).setAlpha(0.8);
    this.label = scene.add
      .text(0, r * 0.04, String(level), {
        fontFamily: FONT_FAMILY,
        fontSize: `${Math.round(r * 0.92)}px`,
        fontStyle: '800',
        color: CSS_COLORS.ink,
      })
      .setOrigin(0.5)
      .setAlpha(0.78);

    const children: Phaser.GameObjects.GameObject[] = [this.shadow, this.base, this.shine, this.label];
    const stars = levelStars(level);
    if (stars > 0) children.push(this.makeStars(stars));

    this.container = scene.add.container(x, y, children).setDepth(DEPTH.balls);
    this.resetTracking(x, y, 0);
  }

  private makeStars(count: number): Phaser.GameObjects.Graphics {
    const g = this.scene.add.graphics();
    const spacing = 22;
    const startX = -((count - 1) * spacing) / 2;
    for (let i = 0; i < count; i++) {
      const cx = startX + i * spacing;
      const cy = -this.radius - 16;
      const pts: Phaser.Math.Vector2[] = [];
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rad = k % 2 === 0 ? 11 : 4.6;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad));
      }
      g.fillStyle(0x0f131c, 0.5);
      g.fillCircle(cx, cy + 1, 12);
      g.fillStyle(0xffd454, 1);
      g.fillPoints(pts, true);
    }
    return g;
  }

  get x(): number {
    return this.body ? this.body.position.x : this.container.x;
  }

  get y(): number {
    return this.body ? this.body.position.y : this.container.y;
  }

  /** Create the physics body (balls only collide with walls, paddles and obstacles). */
  attachBody(x: number, y: number): MatterJS.BodyType {
    this.detachBody();
    const body = this.scene.matter.add.circle(x, y, this.radius, {
      label: 'ball',
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      frictionAir: 0,
      slop: 0.02,
      collisionFilter: {
        category: CATEGORY.ball,
        mask: CATEGORY.wall | CATEGORY.paddle | CATEGORY.obstacle,
        group: 0,
      },
    });
    // Infinite inertia: balls never spin, so friction-free contacts can't steal energy into rotation.
    this.scene.matter.body.setInertia(body, Infinity);
    this.body = body;
    this.container.setPosition(x, y);
    return body;
  }

  detachBody(): void {
    if (this.body) {
      this.scene.matter.world.remove(this.body);
      this.body = null;
    }
  }

  /** Forget stability history (after spawning / teleporting). */
  resetTracking(x: number, y: number, simTime: number): void {
    this.restartTrackBox(x, y, simTime);
    this.obstacleOverlapMs = 0;
    this.repeatCount = 0;
    this.lastBounceAngle = Number.NaN;
    this.trailCount = 0;
  }

  restartTrackBox(x: number, y: number, simTime: number): void {
    const b = this.trackBox;
    b.minX = b.maxX = x;
    b.minY = b.maxY = y;
    this.trackStart = simTime;
  }

  /** Grow the sampled bounding box; returns its larger side. */
  sampleTrack(x: number, y: number): number {
    const b = this.trackBox;
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
    return Math.max(b.maxX - b.minX, b.maxY - b.minY);
  }

  /** Squash along the collision normal; `strength` ~0..1.5. */
  impact(nx: number, ny: number, strength: number): void {
    this.squashNx = Math.abs(nx);
    this.squashNy = Math.abs(ny);
    this.squash = Math.min(0.42, Math.max(this.squash, strength));
    this.squashVel = 0;
  }

  setDirection(dx: number, dy: number): void {
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      this.dirX = dx / len;
      this.dirY = dy / len;
    }
  }

  /** Per-frame visual update. `dt` in seconds (real time, so squash stays snappy during slow motion). */
  updateVisual(dt: number): void {
    if (this.body) this.container.setPosition(this.body.position.x, this.body.position.y);

    // Damped spring back to round shape.
    const k = 900;
    const c = 24;
    const acc = -k * this.squash - c * this.squashVel;
    this.squashVel += acc * dt;
    this.squash += this.squashVel * dt;
    if (Math.abs(this.squash) < 0.001 && Math.abs(this.squashVel) < 0.01) {
      this.squash = 0;
      this.squashVel = 0;
    }

    const s = this.squash;
    const sx = 1 - s * this.squashNx + s * 0.55 * this.squashNy;
    const sy = 1 - s * this.squashNy + s * 0.55 * this.squashNx;
    this.container.setScale(sx * this.animScale, sy * this.animScale);

    // The highlight drifts slightly against the travel direction – a hint of rolling.
    const r = this.radius;
    this.shine.setPosition(-r * 0.3 - this.dirX * r * 0.07, -r * 0.38 - this.dirY * r * 0.07);

    if (this.highlightMs > 0) this.highlightMs = Math.max(0, this.highlightMs - dt * 1000);
  }

  pushTrail(): void {
    const p = this.trailPts[this.trailHead];
    p.x = this.container.x;
    p.y = this.container.y;
    this.trailHead = (this.trailHead + 1) % this.trailPts.length;
    this.trailCount = Math.min(this.trailCount + 1, this.trailPts.length);
  }

  get trailCapacity(): number {
    return this.trailPts.length;
  }

  /** Trail sample `i` (0 = newest). */
  trailPoint(i: number): Vec2 {
    const n = this.trailPts.length;
    return this.trailPts[(this.trailHead - 1 - i + n * 2) % n];
  }

  destroy(): void {
    this.detachBody();
    this.container.destroy();
  }
}
