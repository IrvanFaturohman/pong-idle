import Phaser from 'phaser';
import { ARENA, AUTO, BALLS, BOOST, COLORS, CSS_COLORS, DEPTH, JUICE, PADDLES, PHYSICS, TIMING } from '../config';
import { ctx, saveNow } from '../context';
import { ballValue, comboMultiplier, ECONOMY } from '../data/economy';
import { FINAL_MAP_INDEX } from '../data/maps';
import { Ball } from '../entities/Ball';
import { Paddle, railFor, sideCapacity } from '../entities/Paddle';
import { AutoPilot } from '../systems/AutoPilot';
import { bus } from '../systems/EventBus';
import { JuiceManager } from '../systems/JuiceManager';
import { MapManager, type ObstacleRuntime } from '../systems/MapManager';
import { MergeSystem } from '../systems/MergeSystem';
import type { GameMode, PurchaseResult, Side, Vec2 } from '../types';
import { angleDiff, clamp, clampDirection, damp, degToRad, randRange, randSign, rotate } from '../utils/math';

type SpawnMode = 'load' | 'buy' | 'merge' | 'respawn';

interface Contact {
  ball: Ball;
  kind: 'paddle' | 'wall' | 'obstacle';
  paddle?: Paddle;
  wall?: Side;
  obstacle?: ObstacleRuntime;
  x: number;
  y: number;
}

interface Drag {
  paddle: Paddle;
  pointerId: number;
  /** Paddle center minus finger position along the rail, so grabbing never makes the paddle jump. */
  offset: number;
  last: number;
  travelled: number;
  reported: boolean;
}

/** Auto mode: a paddle picked up by the player on its way to another side. */
interface Carry {
  paddle: Paddle;
  pointerId: number;
  /** Side it would land on if released now. */
  side: Side;
  /** That side has no room left. */
  full: boolean;
  x: number;
  y: number;
}

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];
const WALL_NORMALS: Record<Side, Vec2> = {
  top: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
};
const MIN_FROM_H = degToRad(PHYSICS.minAngleFromHorizontalDeg);
const MIN_FROM_V = degToRad(PHYSICS.minAngleFromVerticalDeg);
const HEALTH_INTERVAL_MS = 250;
const RAD_TO_DEG = 180 / Math.PI;

/**
 * The arena: Matter simulation, balls, paddles, rewards, purchases and map flow.
 *
 * Physics is stepped manually (autoUpdate is off) so we can sub-step for
 * stability, clamp long frames, slow time for merges and pause for transitions.
 */
export class GameScene extends Phaser.Scene {
  balls: Ball[] = [];
  paddles: Paddle[] = [];
  map!: MapManager;
  juice!: JuiceManager;
  merger!: MergeSystem;
  transitioning = false;
  mode: GameMode = 'classic';
  private autopilot: AutoPilot | null = null;
  private carry: Carry | null = null;

  private trailGfx!: Phaser.GameObjects.Graphics;
  private highlightGfx!: Phaser.GameObjects.Graphics;
  private readonly contacts: Contact[] = [];
  private readonly paddleHitThisStep = new Set<Ball>();
  private readonly wallHitThisStep = new Set<Ball>();
  private readonly ballByBody = new Map<MatterJS.BodyType, Ball>();
  private readonly paddleByBody = new Map<MatterJS.BodyType, Paddle>();
  private readonly wallSide = new Map<MatterJS.BodyType, Side>();
  private drags: Drag[] = [];
  private simTime = 0;
  private readonly sim = { scale: 1 };
  private simTween: Phaser.Tweens.Tween | null = null;
  private saveTimer = 0;
  private healthTimer = 0;
  private lastHealthSim = 0;
  private visualTime = 0;
  /** Tap-to-speed-up multiplier applied to simulation time, and the value it eases toward. */
  private boost = 1;
  private boostTarget = 1;
  private lastBoostTap = -Infinity;

  constructor() {
    super('Game');
  }

  create(): void {
    const c = ctx();
    this.balls = [];
    this.paddles = [];
    this.drags = [];
    this.contacts.length = 0;
    this.ballByBody.clear();
    this.paddleByBody.clear();
    this.wallSide.clear();
    this.transitioning = false;
    this.sim.scale = 1;
    this.boost = 1;
    this.boostTarget = 1;

    this.map = new MapManager(this);
    this.map.build(c.state.mapIndex);
    this.map.walls.forEach((w, i) => this.wallSide.set(w, SIDES[i]));
    this.juice = new JuiceManager(this);
    this.trailGfx = this.add.graphics().setDepth(DEPTH.trails);
    this.highlightGfx = this.add.graphics().setDepth(DEPTH.fx);
    this.merger = new MergeSystem(this);
    this.mode = c.mode;
    this.autopilot = this.mode === 'auto' ? new AutoPilot(this) : null;
    this.carry = null;

    for (const p of c.state.paddles) {
      // Never overfill a rail, even if a save says otherwise.
      const side = this.paddlesOn(p.side).length < sideCapacity(p.side) ? p.side : this.roomiestSide();
      this.addPaddle(side, p.pos, false);
    }
    this.enforcePaddleSpacing();
    const points = this.map.ringSpawnPoints(c.state.balls.length);
    c.state.balls.forEach((level, i) => this.spawnBall(level, points[i].x, points[i].y, 'load'));

    this.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown, this);
    this.matter.world.on('collisionstart', this.onCollisionStart, this);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.persist);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);

    this.scene.launch('UI');
  }

  private cleanup(): void {
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pagehide', this.persist);
    this.matter.world.off('collisionstart', this.onCollisionStart, this);
    bus.offContext(this);
  }

  // =================================================================== state

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.persist();
  };

  /** Copy live entity data into the save state and write it. */
  readonly persist = (): void => {
    this.syncPaddleState();
    this.syncBallState();
    saveNow();
  };

  syncBallState(): void {
    ctx().state.balls = this.balls.map((b) => b.level);
  }

  private syncPaddleState(): void {
    ctx().state.paddles = this.paddles.map((p) => ({ side: p.side, pos: Math.round(p.normalized * 1000) / 1000 }));
  }

  /** Upgrades and paddle drags are blocked during merges, transitions and modals. */
  isLocked(): boolean {
    return this.merger.active || this.transitioning || ctx().modalOpen;
  }

  lowestMergeLevel(): number | null {
    return this.merger.lowestLevel(this.balls);
  }

  /** Center of the first paddle on a side (tutorial pointer). */
  paddleAnchor(side: Side): Vec2 | null {
    const p = this.paddles.find((q) => q.side === side);
    return p ? p.worldCenter() : null;
  }

  /** Current tap boost (1 = normal speed). */
  get speedBoost(): number {
    return this.boost;
  }

  private ballSpeed(): number {
    // Matter velocities are expressed per 1/60 s "base frame".
    return (PHYSICS.baseBallSpeed * this.map.def.speedFactor) / 60;
  }

  tweenSimScale(target: number, durationMs: number): void {
    this.simTween?.stop();
    this.simTween = this.tweens.add({
      targets: this.sim,
      scale: target,
      duration: durationMs,
      ease: target < this.sim.scale ? 'Cubic.easeOut' : 'Cubic.easeIn',
    });
  }

  // =================================================================== balls

  spawnBall(level: number, x: number, y: number, mode: SpawnMode): Ball {
    const ball = new Ball(this, level, x, y);
    const body = ball.attachBody(x, y);
    this.ballByBody.set(body, ball);
    this.balls.push(ball);
    this.launchBall(ball);
    ball.resetTracking(x, y, this.simTime);

    if (mode === 'buy' || mode === 'merge' || mode === 'respawn') {
      ball.animScale = mode === 'merge' ? 0.35 : 0;
      this.tweens.add({
        targets: ball,
        animScale: 1,
        duration: mode === 'merge' ? 460 : mode === 'buy' ? 420 : 320,
        delay: mode === 'respawn' ? randRange(0, 160) : 0,
        ease: 'Back.easeOut',
        easeParams: [mode === 'merge' ? 3.2 : 2.4],
      });
    }
    if (mode === 'buy' || mode === 'merge') ball.highlightMs = BALLS.spawnHighlightMs;
    if (mode === 'buy') {
      this.juice.ring(x, y, ball.color, ball.radius, ball.radius * 3.4, 460, 8);
      this.juice.flash(x, y, ball.color, 1.4, 260);
    }
    ctx().state.stats.highestLevel = Math.max(ctx().state.stats.highestLevel, level);
    return ball;
  }

  /** Give a ball a random, safely diagonal direction at the current map speed. */
  private launchBall(ball: Ball): void {
    if (!ball.body) return;
    const a = randRange(0, Math.PI * 2);
    const dir = clampDirection(Math.cos(a), Math.sin(a), MIN_FROM_H + degToRad(8), MIN_FROM_V + degToRad(8));
    const s = this.ballSpeed();
    this.matter.body.setVelocity(ball.body, { x: dir.x * s, y: dir.y * s });
    ball.setDirection(dir.x, dir.y);
  }

  detachBallBody(ball: Ball): void {
    if (ball.body) this.ballByBody.delete(ball.body);
    ball.detachBody();
  }

  removeBall(ball: Ball): void {
    this.detachBallBody(ball);
    const i = this.balls.indexOf(ball);
    if (i >= 0) this.balls.splice(i, 1);
    ball.destroy();
  }

  /** Put a ball that escaped, got stuck or ended up inside an obstacle back near the focus point. */
  private restoreBall(ball: Ball): void {
    if (!ball.body) return;
    const p = this.map.findSpawnPoint(ball.radius);
    this.matter.body.setPosition(ball.body, p, false);
    this.launchBall(ball);
    ball.container.setPosition(p.x, p.y);
    ball.resetTracking(p.x, p.y, this.simTime);
    ball.comboChain = 0;
    ball.animScale = 0.4;
    this.tweens.add({ targets: ball, animScale: 1, duration: 280, ease: 'Back.easeOut' });
    this.juice.ring(p.x, p.y, ball.color, ball.radius, ball.radius * 2.6, 360, 6);
  }

  private respawnAllBalls(): void {
    const points = this.map.ringSpawnPoints(this.balls.length);
    this.balls.forEach((ball, i) => {
      if (!ball.body) return;
      const p = points[i];
      this.matter.body.setPosition(ball.body, p, false);
      this.launchBall(ball);
      ball.container.setPosition(p.x, p.y);
      ball.resetTracking(p.x, p.y, this.simTime);
      ball.comboChain = 0;
      ball.lastPaddleHit.clear();
      ball.animScale = 0;
      this.tweens.add({ targets: ball, animScale: 1, duration: 340, delay: i * 45, ease: 'Back.easeOut', easeParams: [2.2] });
    });
  }

  // =================================================================== paddles

  private addPaddle(side: Side, normalizedPos: number, animate: boolean): Paddle {
    const paddle = new Paddle(this, side, normalizedPos, this.map.def.palette.paddle);
    if (this.mode === 'auto') paddle.speedLimit = AUTO.paddleSpeed;
    this.paddleByBody.set(paddle.body, paddle);
    this.paddles.push(paddle);
    if (animate) {
      paddle.appear = 0;
      this.tweens.add({ targets: paddle, appear: 1, duration: 520, ease: 'Back.easeOut', easeParams: [1.6] });
    }
    return paddle;
  }

  paddlesOn(side: Side): Paddle[] {
    return this.paddles.filter((p) => p.side === side).sort((a, b) => a.pos - b.pos);
  }

  private removePaddle(paddle: Paddle): void {
    this.paddleByBody.delete(paddle.body);
    const i = this.paddles.indexOf(paddle);
    if (i >= 0) this.paddles.splice(i, 1);
    paddle.destroy();
  }

  private freeSlots(side: Side): number {
    return sideCapacity(side) - this.paddlesOn(side).length;
  }

  /** The side with the most free room on its rail. */
  private roomiestSide(): Side {
    let best: Side = SIDES[0];
    for (const side of SIDES) if (this.freeSlots(side) > this.freeSlots(best)) best = side;
    return best;
  }

  /**
   * Move a paddle toward `desired` along its rail while keeping every paddle on
   * that side in order with a minimum gap. Neighbours are pushed along, and the
   * moved paddle stops when the pushed ones reach the rail end – predictable and
   * jitter free because the solve always runs outward from the moved paddle.
   */
  private moveOnRail(paddle: Paddle, desired: number): void {
    const same = this.paddlesOn(paddle.side);
    const i = same.indexOf(paddle);
    const n = same.length;
    const step = PADDLES.length + PADDLES.sameSideGap;
    const lo = paddle.rail.min + i * step;
    const hi = paddle.rail.max - (n - 1 - i) * step;
    paddle.target = clamp(desired, lo, hi);
    for (let j = i + 1; j < n; j++) same[j].target = Math.max(same[j].target, same[j - 1].target + step);
    for (let j = i - 1; j >= 0; j--) same[j].target = Math.min(same[j].target, same[j + 1].target - step);
  }

  /** Resolve any overlap from saved data by re-running the rail solve on every side. */
  private enforcePaddleSpacing(): void {
    for (const side of SIDES) {
      const same = this.paddlesOn(side);
      if (same.length < 2) continue;
      this.moveOnRail(same[0], same[0].pos);
      for (const p of same) p.snapTo(p.target);
    }
  }

  /** Split each rail into equal segments and center one paddle in each (used when a map starts). */
  private layoutPaddlesEvenly(): void {
    for (const side of SIDES) {
      const same = this.paddlesOn(side);
      const rail = railFor(side);
      const seg = (rail.end - rail.start) / Math.max(1, same.length);
      same.forEach((p, k) => p.snapTo(rail.start + seg * (k + 0.5)));
    }
  }

  /** Normalized rail position with the most free space for a new paddle on `side`. */
  private freeRailPosition(side: Side): number {
    const same = this.paddlesOn(side);
    if (same.length === 0) return 0.5;
    const rail = railFor(side);
    let best = 0.5;
    let bestClear = -1;
    for (let k = 0; k <= 40; k++) {
      const pos = rail.min + ((rail.max - rail.min) * k) / 40;
      let clear = Infinity;
      for (const p of same) clear = Math.min(clear, Math.abs(pos - p.pos));
      if (clear > bestClear) {
        bestClear = clear;
        best = k / 40;
      }
    }
    return best;
  }

  private releaseDrags(): void {
    for (const d of this.drags) d.paddle.dragging = false;
    this.drags = [];
    if (this.carry) {
      this.carry.paddle.endCarry();
      this.carry = null;
    }
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const c = ctx();
    if (c.modalOpen || c.orientationBlocked || this.transitioning) return;
    if (this.drags.some((d) => d.pointerId === pointer.id)) return;
    let best: Paddle | null = null;
    let bestDist = Infinity;
    for (const p of this.paddles) {
      if (p.dragging || !p.hitTest(pointer.x, pointer.y)) continue;
      const w = p.worldCenter();
      const d = Math.hypot(pointer.x - w.x, pointer.y - w.y);
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    if (!best) {
      this.tapBoost(pointer.x, pointer.y);
      return;
    }
    if (this.mode === 'auto') {
      if (!this.carry) this.startCarry(best, pointer);
      return;
    }
    best.dragging = true;
    const along = best.axisOf(pointer.x, pointer.y);
    this.drags.push({ paddle: best, pointerId: pointer.id, offset: best.target - along, last: along, travelled: 0, reported: false });
  }

  /** A tap on the open arena speeds the game up; repeated taps stack up to BOOST.max. */
  private tapBoost(x: number, y: number): void {
    const c = ctx();
    this.boostTarget = Math.min(BOOST.max, Math.max(this.boostTarget, this.boost) + BOOST.perTap);
    this.lastBoostTap = this.time.now;
    this.juice.ring(x, y, COLORS.textPrimary, 12, 90, 320, 5);
    c.audio.boost(this.boostTarget);
    bus.emit('speed-boost', this.boostTarget);
  }

  private updateBoost(dt: number): void {
    if (this.transitioning) this.boostTarget = 1;
    else if (this.time.now - this.lastBoostTap > BOOST.holdMs) {
      this.boostTarget = Math.max(1, this.boostTarget - BOOST.decayPerSecond * dt);
    }
    this.boost += (this.boostTarget - this.boost) * damp(BOOST.sharpness, dt);
    if (Math.abs(this.boost - 1) < 0.002 && this.boostTarget === 1) this.boost = 1;
  }

  /**
   * Drags are polled from the pointer list instead of scene move events so a
   * finger sliding over UI never interrupts (or leaks into) paddle control.
   */
  private updateDrags(): void {
    const c = ctx();
    const pointers = this.input.manager.pointers;
    for (let i = this.drags.length - 1; i >= 0; i--) {
      const d = this.drags[i];
      const pointer = pointers.find((p) => p.id === d.pointerId);
      if (!pointer || !pointer.isDown || c.modalOpen || c.orientationBlocked) {
        d.paddle.dragging = false;
        this.drags.splice(i, 1);
        continue;
      }
      const along = d.paddle.axisOf(pointer.x, pointer.y);
      d.travelled += Math.abs(along - d.last);
      d.last = along;
      if (!d.reported && d.travelled > 60) {
        d.reported = true;
        bus.emit('paddle-dragged');
      }
      this.moveOnRail(d.paddle, along + d.offset);
    }
  }

  // =================================================================== auto mode: carrying paddles

  private startCarry(paddle: Paddle, pointer: Phaser.Input.Pointer): void {
    paddle.startCarry();
    this.carry = { paddle, pointerId: pointer.id, side: paddle.side, full: false, x: pointer.x, y: pointer.y };
    ctx().audio.uiClick();
    ctx().haptics.pulse(8, 0);
  }

  /** Side whose wall is closest to a point (where a released paddle would land). */
  private nearestSide(x: number, y: number): Side {
    const d: Record<Side, number> = {
      top: Math.abs(y - ARENA.top),
      bottom: Math.abs(ARENA.bottom - y),
      left: Math.abs(x - ARENA.left),
      right: Math.abs(ARENA.right - x),
    };
    let best: Side = 'top';
    for (const side of SIDES) if (d[side] < d[best]) best = side;
    return best;
  }

  private updateCarry(): void {
    const carry = this.carry;
    if (!carry) return;
    const c = ctx();
    const pointer = this.input.manager.pointers.find((p) => p.id === carry.pointerId);
    if (!pointer || !pointer.isDown || c.modalOpen || c.orientationBlocked) {
      this.dropCarry();
      return;
    }
    carry.x = pointer.x;
    carry.y = pointer.y;
    carry.side = this.nearestSide(pointer.x, pointer.y);
    carry.full = carry.side !== carry.paddle.side && this.freeSlots(carry.side) <= 0;
    carry.paddle.carryTo(pointer.x, pointer.y, railFor(carry.side).rotation, carry.full);
  }

  /** Release: land on the nearest side if it has room, otherwise glide back home. */
  private dropCarry(): void {
    const carry = this.carry;
    if (!carry) return;
    this.carry = null;
    const { paddle, side, full, x, y } = carry;
    const c = ctx();

    if (side === paddle.side || full) {
      paddle.endCarry();
      if (full) {
        c.audio.error();
        this.juice.label(x, y - 70, 'SIDE FULL', CSS_COLORS.coral, 44, 800);
      }
      return;
    }

    const rail = railFor(side);
    const along = rail.axis === 'x' ? x : y;
    const normalized = (along - rail.min) / Math.max(1, rail.max - rail.min);
    const from = { x: paddle.container.x, y: paddle.container.y, rotation: paddle.container.rotation };
    this.removePaddle(paddle);
    const moved = this.addPaddle(side, normalized, false);
    this.moveOnRail(moved, moved.pos);
    moved.snapTo(moved.target);
    moved.glideFrom(from.x, from.y, from.rotation);

    const w = moved.worldCenter();
    this.map.flashRail(side, 0.8);
    this.juice.sparksAt(w.x, w.y, Math.atan2(rail.normal.y, rail.normal.x) * RAD_TO_DEG, COLORS.yellow, 10);
    this.juice.ring(w.x, w.y, COLORS.yellow, 40, 170, 380, 6);
    c.audio.addPaddle();
    c.haptics.pulse(12, 0);
    this.persist();
    bus.emit('paddle-moved', side);
  }

  /** Where a newly bought paddle goes: the purchase order, unless that rail is already full. */
  private sideForNewPaddle(): Side {
    const order = PADDLES.purchaseOrder;
    const preferred = order[ctx().state.paddlesPurchased % order.length];
    return this.freeSlots(preferred) > 0 ? preferred : this.roomiestSide();
  }

  // =================================================================== physics

  private stepPhysics(frameMs: number): void {
    const simMs = Math.min(frameMs, PHYSICS.maxFrameMs) * this.sim.scale * this.boost;
    if (simMs < 0.01) return;
    // Variable-count sub-steps: small steps prevent tunnelling and keep slow motion smooth.
    const steps = Math.max(1, Math.ceil(simMs / PHYSICS.maxSubstepMs));
    const dt = simMs / steps;
    for (let i = 0; i < steps; i++) {
      this.simTime += dt;
      this.map.stepObstacles(dt);
      this.matter.world.step(dt);
      this.processContacts();
      this.enforceBallMotion();
    }
  }

  /**
   * Matter fires collisionstart *before* it resolves the contact, so here we only
   * record contacts; they are handled after the step once velocities are final.
   */
  private onCollisionStart(event: Phaser.Physics.Matter.Events.CollisionStartEvent): void {
    for (const pair of event.pairs) {
      const a = pair.bodyA as MatterJS.BodyType;
      const b = pair.bodyB as MatterJS.BodyType;
      let ball = this.ballByBody.get(a);
      let other = b;
      if (!ball) {
        ball = this.ballByBody.get(b);
        other = a;
      }
      if (!ball) continue;
      const support = (pair.collision as { supports?: Array<{ x: number; y: number } | undefined> }).supports?.[0];
      const x = support ? support.x : ball.x;
      const y = support ? support.y : ball.y;
      const paddle = this.paddleByBody.get(other);
      if (paddle) {
        this.contacts.push({ ball, kind: 'paddle', paddle, x, y });
        continue;
      }
      const wall = this.wallSide.get(other);
      if (wall) {
        this.contacts.push({ ball, kind: 'wall', wall, x, y });
        continue;
      }
      const obstacle = this.map.obstacleByBody(other);
      if (obstacle) this.contacts.push({ ball, kind: 'obstacle', obstacle, x, y });
    }
  }

  private processContacts(): void {
    if (this.contacts.length === 0) return;
    this.paddleHitThisStep.clear();
    this.wallHitThisStep.clear();
    // Paddles first: a ball touching a paddle and a wall corner in the same step counts as a paddle hit.
    for (const c of this.contacts) {
      if (c.kind !== 'paddle' || !c.paddle || !c.ball.body || this.paddleHitThisStep.has(c.ball)) continue;
      this.paddleHitThisStep.add(c.ball);
      this.handlePaddleHit(c.ball, c.paddle, c.x, c.y);
    }
    for (const c of this.contacts) {
      if (!c.ball.body || this.paddleHitThisStep.has(c.ball)) continue;
      if (c.kind === 'wall' && c.wall && !this.wallHitThisStep.has(c.ball)) {
        this.wallHitThisStep.add(c.ball);
        this.handleWallHit(c.ball, c.wall, c.x, c.y);
      } else if (c.kind === 'obstacle' && c.obstacle) {
        this.handleObstacleHit(c.ball, c.obstacle, c.x, c.y);
      }
    }
    this.contacts.length = 0;
  }

  private handlePaddleHit(ball: Ball, paddle: Paddle, x: number, y: number): void {
    const c = ctx();
    const body = ball.body;
    if (!body) return;
    const n = paddle.rail.normal;
    const horizontal = paddle.rail.axis === 'x';
    const speed = this.ballSpeed();
    const v = this.matter.body.getVelocity(body);

    // Rebuild the rebound: always away from the wall, plus a little Pong "english"
    // from where the ball struck and a subtle push from the paddle's own motion.
    const vn = Math.abs(v.x * n.x + v.y * n.y);
    let vt = horizontal ? v.x : v.y;
    const along = paddle.axisOf(body.position.x, body.position.y);
    const offset = clamp((along - paddle.pos) / (PADDLES.length / 2), -1, 1);
    vt += offset * PADDLES.english * speed;
    const influence = clamp((paddle.vel / 60) * PADDLES.influence, -PADDLES.maxInfluence * speed, PADDLES.maxInfluence * speed);
    vt += influence;
    const vx = horizontal ? vt : vn * n.x;
    const vy = horizontal ? vn * n.y : vt;
    const dir = clampDirection(vx, vy, MIN_FROM_H, MIN_FROM_V);
    this.matter.body.setVelocity(body, { x: dir.x * speed, y: dir.y * speed });
    ball.setDirection(dir.x, dir.y);
    ball.repeatCount = 0;
    ball.lastBounceAngle = Number.NaN;

    // Duplicate guard: one reward per ball per paddle within the cooldown.
    const last = ball.lastPaddleHit.get(paddle.id);
    if (last !== undefined && this.simTime - last < PADDLES.hitCooldownMs) return;
    ball.lastPaddleHit.set(paddle.id, this.simTime);

    const combo = comboMultiplier(ball.comboChain);
    ball.comboChain++;
    const reward = Math.max(1, Math.round(ballValue(ball.level) * combo * c.economy.multiplier));
    c.economy.earn(reward);
    c.state.stats.paddleHits++;

    const level = ball.level;
    paddle.hit(0.55 + Math.min(level, 8) * 0.1);
    ball.impact(n.x, n.y, JUICE.ballSquash + (level >= 4 ? JUICE.ballSquashStrongBonus : 0));
    const outDeg = Math.atan2(n.y, n.x) * RAD_TO_DEG;
    this.juice.hitBurst(x + n.x * 4, y + n.y * 4, outDeg, ball.color, level);
    this.juice.money(x + n.x * 64, y + n.y * 64, reward, level, combo >= ECONOMY.combo.max);
    c.audio.paddle(level, combo);
    const kick = Math.min(JUICE.cameraKickMax, JUICE.cameraKickBase + JUICE.cameraKickPerLevel * (level - 1));
    this.juice.kick(-n.x * kick, -n.y * kick);
    if (level >= JUICE.hapticPaddleMinLevel) c.haptics.pulse(6, 140);
    bus.emit('paddle-hit', reward, x, y, level);
  }

  private handleWallHit(ball: Ball, side: Side, x: number, y: number): void {
    const body = ball.body;
    if (!body) return;
    const n = WALL_NORMALS[side];
    const v = this.matter.body.getVelocity(body);
    const vn = v.x * n.x + v.y * n.y;
    // Safety reflection: whatever Matter did, a ball leaves a wall moving inward.
    let vx = v.x;
    let vy = v.y;
    if (vn < 0) {
      vx -= 2 * vn * n.x;
      vy -= 2 * vn * n.y;
    }
    this.finishBounce(ball, vx, vy);
    // Missing a paddle is not a failure: the ball simply bounces and its combo resets.
    ball.comboChain = 0;
    ball.impact(n.x, n.y, JUICE.ballSquash * 0.7);
    this.juice.wallPuff(x, y, Math.atan2(n.y, n.x) * RAD_TO_DEG, this.map.def.palette.rail);
    ctx().audio.wall();
  }

  private handleObstacleHit(ball: Ball, o: ObstacleRuntime, x: number, y: number): void {
    const body = ball.body;
    if (!body) return;
    let nx = body.position.x - o.x;
    let ny = body.position.y - o.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const v = this.matter.body.getVelocity(body);
    let vx = v.x;
    let vy = v.y;
    if (o.def.kind === 'bumper') {
      const vn = vx * nx + vy * ny;
      if (vn < 0) {
        vx -= 2 * vn * nx;
        vy -= 2 * vn * ny;
      }
    }
    this.finishBounce(ball, vx, vy);
    ball.impact(nx, ny, JUICE.ballSquash * 0.8);
    this.map.onObstacleHit(o);
    const p = this.map.def.palette;
    this.juice.sparksAt(x, y, Math.atan2(ny, nx) * RAD_TO_DEG, o.def.kind === 'bar' ? p.secondary : p.obstacleLight, 7);
    ctx().audio.obstacle(o.def.kind);
  }

  /**
   * Normalize speed, keep the angle away from flat axes, and nudge balls that keep
   * producing the same bounce angle so no trajectory loops forever.
   */
  private finishBounce(ball: Ball, vx: number, vy: number): void {
    const body = ball.body;
    if (!body) return;
    let dir = clampDirection(vx, vy, MIN_FROM_H, MIN_FROM_V);
    const angle = Math.atan2(Math.abs(dir.y), Math.abs(dir.x));
    if (!Number.isNaN(ball.lastBounceAngle) && Math.abs(angleDiff(angle, ball.lastBounceAngle)) < degToRad(PHYSICS.repeatAngleToleranceDeg)) {
      ball.repeatCount++;
    } else {
      ball.repeatCount = 0;
    }
    ball.lastBounceAngle = angle;
    if (ball.repeatCount >= PHYSICS.repeatBounceLimit) {
      dir = rotate(dir, degToRad(randRange(PHYSICS.repeatNudgeMinDeg, PHYSICS.repeatNudgeMaxDeg)) * randSign());
      dir = clampDirection(dir.x, dir.y, MIN_FROM_H, MIN_FROM_V);
      ball.repeatCount = 0;
      ball.lastBounceAngle = Number.NaN;
    }
    const s = this.ballSpeed();
    this.matter.body.setVelocity(body, { x: dir.x * s, y: dir.y * s });
    ball.setDirection(dir.x, dir.y);
  }

  /** Constant speed and no near-axis directions, every sub-step. Balls never rest. */
  private enforceBallMotion(): void {
    const s = this.ballSpeed();
    for (const ball of this.balls) {
      const body = ball.body;
      if (!body) continue;
      const v = this.matter.body.getVelocity(body);
      const dir = clampDirection(v.x, v.y, MIN_FROM_H, MIN_FROM_V);
      this.matter.body.setVelocity(body, { x: dir.x * s, y: dir.y * s });
    }
  }

  /** Escaped, stuck or embedded balls are restored – never deleted, never downgraded. */
  private checkBallHealth(): void {
    const simElapsed = this.simTime - this.lastHealthSim;
    this.lastHealthSim = this.simTime;
    for (const ball of this.balls) {
      const body = ball.body;
      if (!body) continue;
      const { x, y } = body.position;
      const margin = 6;
      const escaped =
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < ARENA.left - margin ||
        x > ARENA.right + margin ||
        y < ARENA.top - margin ||
        y > ARENA.bottom + margin;
      if (escaped) {
        this.restoreBall(ball);
        continue;
      }
      ball.obstacleOverlapMs = this.map.isInsideObstacle(x, y) ? ball.obstacleOverlapMs + simElapsed : 0;
      if (ball.obstacleOverlapMs > PHYSICS.obstacleOverlapLimitMs) {
        this.restoreBall(ball);
        continue;
      }
      const extent = ball.sampleTrack(x, y);
      if (this.simTime - ball.trackStart >= PHYSICS.stuckWindowMs) {
        if (extent < PHYSICS.stuckBoxSize) {
          this.restoreBall(ball);
          continue;
        }
        ball.restartTrackBox(x, y, this.simTime);
      }
    }
  }

  // =================================================================== purchases

  tryAddBall(): PurchaseResult {
    const c = ctx();
    if (this.isLocked()) return 'locked';
    if (this.balls.length >= BALLS.maxActive) {
      bus.emit('attention-merge');
      return 'full';
    }
    const cost = c.economy.ballCost;
    if (!c.economy.spend(cost)) return 'poor';
    c.state.ballsPurchased++;
    const p = this.map.findSpawnPoint(BALLS.baseRadius);
    this.spawnBall(1, p.x, p.y, 'buy');
    c.audio.addBall();
    c.haptics.pulse(12, 0);
    bus.emit('spent', cost);
    bus.emit('ball-added');
    this.persist();
    return 'ok';
  }

  tryAddPaddle(): PurchaseResult {
    const c = ctx();
    if (this.isLocked()) return 'locked';
    const cost = c.economy.paddleCost;
    if (cost === null) return 'max';
    if (!c.economy.spend(cost)) return 'poor';
    const side = this.sideForNewPaddle();
    c.state.paddlesPurchased++;
    const paddle = this.addPaddle(side, this.freeRailPosition(side), true);
    this.moveOnRail(paddle, paddle.pos);
    paddle.snapTo(paddle.target);
    this.map.flashRail(side, 1.6);
    const w = paddle.worldCenter();
    this.juice.sparksAt(w.x, w.y, Math.atan2(paddle.rail.normal.y, paddle.rail.normal.x) * RAD_TO_DEG, COLORS.yellow, 12);
    this.juice.ring(w.x, w.y, COLORS.yellow, 40, 190, 420, 6);
    c.audio.addPaddle();
    c.haptics.pulse(15, 0);
    bus.emit('spent', cost);
    bus.emit('paddle-added', side);
    this.persist();
    return 'ok';
  }

  tryMerge(): PurchaseResult {
    if (this.isLocked()) return 'locked';
    const pair = this.merger.findPair(this.balls);
    if (!pair) return 'nomatch';
    this.merger.start(pair[0], pair[1]);
    return 'ok';
  }

  // =================================================================== map flow

  private beginMapComplete(): void {
    const c = ctx();
    this.transitioning = true;
    this.releaseDrags();
    bus.emit('lock-changed', true);
    this.tweenSimScale(0, 420);

    const mapIndex = c.state.mapIndex;
    const tier = c.state.endless.tier;
    const onFinal = mapIndex >= FINAL_MAP_INDEX;
    const prototypeFinish = onFinal && tier === 0;

    c.audio.fanfare();
    c.haptics.pulse(40, 0);
    this.juice.shake(JUICE.mapCompleteShake.duration, JUICE.mapCompleteShake.intensity);
    const f = this.map.focus;
    this.juice.radialBurst(f.x, f.y, [COLORS.yellow, COLORS.green, COLORS.coral, 0x5db8ff, COLORS.textPrimary], 70);
    this.juice.ring(f.x, f.y, COLORS.yellow, 60, 620, 800, 18);
    bus.emit('map-complete', mapIndex, prototypeFinish, tier);

    if (prototypeFinish) {
      c.state.endless.prototypeComplete = true;
      this.persist();
      // The UI shows the celebration panel; play resumes through continueEndless().
      this.time.delayedCall(1500, () => bus.emit('prototype-complete'));
      return;
    }
    if (onFinal) {
      this.time.delayedCall(1600, () => this.enterEndlessTier(tier + 1));
      return;
    }
    this.time.delayedCall(1600, () => this.transitionToMap(mapIndex + 1));
  }

  /** Called by the prototype complete panel. */
  continueEndless(): void {
    if (!this.transitioning) return;
    this.enterEndlessTier(Math.max(1, ctx().state.endless.tier + 1));
  }

  private enterEndlessTier(tier: number): void {
    const c = ctx();
    c.state.endless.tier = tier;
    c.state.mapEarnings = 0;
    for (const b of this.balls) b.comboChain = 0;
    this.persist();
    bus.emit('map-entered', c.state.mapIndex, tier);
    this.finishTransition(450);
  }

  private transitionToMap(index: number): void {
    const cam = this.cameras.main;
    const oldBg = this.map.def.palette.background;
    cam.fadeOut(TIMING.mapFadeOutMs, (oldBg >> 16) & 0xff, (oldBg >> 8) & 0xff, oldBg & 0xff);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      const c = ctx();
      c.state.mapIndex = index;
      c.state.mapEarnings = 0;
      this.map.build(index);
      for (const p of this.paddles) p.setColor(this.map.def.palette.paddle);
      this.layoutPaddlesEvenly();
      this.respawnAllBalls();
      this.persist();
      bus.emit('map-entered', index, c.state.endless.tier);
      const bg = this.map.def.palette.background;
      cam.fadeIn(TIMING.mapFadeInMs, (bg >> 16) & 0xff, (bg >> 8) & 0xff, bg & 0xff);
      this.finishTransition(TIMING.mapFadeInMs + 250);
    });
  }

  private finishTransition(delayMs: number): void {
    this.time.delayedCall(delayMs, () => {
      this.tweenSimScale(1, 380);
      this.transitioning = false;
      bus.emit('lock-changed', false);
    });
  }

  // =================================================================== frame

  override update(_time: number, delta: number): void {
    const c = ctx();
    const frameMs = Math.min(delta, 100);
    const dt = frameMs / 1000;
    this.visualTime += dt;
    c.state.stats.playTimeMs += frameMs;

    this.updateDrags();
    this.updateCarry();
    this.updateBoost(dt);
    this.autopilot?.update(this.boost);
    for (const p of this.paddles) p.update(dt);
    this.updateRails();

    if (!c.orientationBlocked) this.stepPhysics(frameMs);
    this.merger.update(dt);

    const moving = this.sim.scale > 0.02;
    for (const ball of this.balls) {
      if (ball.body) {
        const v = ball.body.velocity;
        ball.setDirection(v.x, v.y);
      }
      ball.updateVisual(dt);
      if (moving || !ball.body) ball.pushTrail();
    }
    this.drawTrails();
    this.drawHighlights();
    this.map.updateVisuals(dt);
    this.juice.update(dt);

    this.healthTimer += frameMs;
    if (this.healthTimer >= HEALTH_INTERVAL_MS) {
      this.healthTimer = 0;
      this.checkBallHealth();
    }

    if (!this.transitioning && !this.merger.active && c.economy.mapCleared) this.beginMapComplete();

    this.saveTimer += frameMs;
    if (this.saveTimer >= TIMING.autosaveMs) {
      this.saveTimer = 0;
      this.persist();
    }
  }

  /**
   * Rails are faint where paddles sit and bright while one is being dragged.
   * While carrying a paddle (auto mode) every rail shows as a drop target.
   */
  private updateRails(): void {
    const carry = this.carry;
    for (const side of SIDES) {
      let has = false;
      let active = false;
      for (const p of this.paddles) {
        if (p.side !== side || p.carried) continue;
        has = true;
        if (p.dragging) active = true;
      }
      let alpha = active ? 0.95 : has ? 0.16 : 0;
      if (carry) alpha = side === carry.side && !carry.full ? 1 : 0.3;
      this.map.setRailAlpha(side, alpha);
    }
  }

  /** Short fading trail of circles; length grows with level. */
  private drawTrails(): void {
    const g = this.trailGfx;
    g.clear();
    for (const ball of this.balls) {
      const count = ball.trailCount;
      if (count < 2) continue;
      const cap = ball.trailCapacity;
      for (let i = count - 1; i >= 1; i--) {
        const t = i / cap;
        const p = ball.trailPoint(i);
        g.fillStyle(ball.color, 0.2 * (1 - t));
        g.fillCircle(p.x, p.y, ball.radius * (0.82 - 0.45 * t) * ball.animScale);
      }
    }
  }

  /** Pulsing ring around freshly bought / merged balls. */
  private drawHighlights(): void {
    const g = this.highlightGfx;
    g.clear();
    for (const ball of this.balls) {
      if (ball.highlightMs <= 0) continue;
      const k = ball.highlightMs / BALLS.spawnHighlightMs;
      const pulse = Math.sin(this.visualTime * 14) * 4;
      g.lineStyle(5, ball.color, 0.8 * k);
      g.strokeCircle(ball.container.x, ball.container.y, ball.radius * ball.animScale + 12 + pulse);
      g.lineStyle(2, COLORS.textPrimary, 0.5 * k);
      g.strokeCircle(ball.container.x, ball.container.y, ball.radius * ball.animScale + 22 + pulse * 1.5);
    }
  }
}
