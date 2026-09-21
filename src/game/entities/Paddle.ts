import Phaser from 'phaser';
import { ARENA, CATEGORY, DEPTH, JUICE, PADDLES } from '../config';
import type { Side, Vec2 } from '../types';
import { clamp, damp, degToRad } from '../utils/math';
import { ensurePaddleTextures } from '../utils/textures';

export interface Rail {
  /** Axis the paddle slides along. */
  axis: 'x' | 'y';
  /** Allowed range for the paddle center along its axis. */
  min: number;
  max: number;
  /** Visual rail extent (includes paddle half-length at both ends). */
  start: number;
  end: number;
  /** Cross-axis coordinate of the paddle center. */
  fixed: number;
  /** Unit normal pointing from the wall into the arena. */
  normal: Vec2;
  /** Container rotation so local +y (the paddle face) points into the arena. */
  rotation: number;
}

/** How many paddles fit on a side's rail with the minimum gap between them. */
export function sideCapacity(side: Side): number {
  const rail = railFor(side, PADDLES.length);
  return Math.floor((rail.end - rail.start + PADDLES.sameSideGap) / (PADDLES.length + PADDLES.sameSideGap));
}

/** Geometry of each side's rail for a paddle of `length`. Left/right rails stop short of the corners. */
export function railFor(side: Side, length: number = PADDLES.length): Rail {
  const L = length;
  const T = PADDLES.thickness;
  const gap = PADDLES.wallGap;
  const sideInset = gap + T + PADDLES.cornerClearance;
  switch (side) {
    case 'top':
    case 'bottom': {
      const start = ARENA.left + gap;
      const end = ARENA.right - gap;
      const top = side === 'top';
      return {
        axis: 'x',
        start,
        end,
        min: start + L / 2,
        max: end - L / 2,
        fixed: top ? ARENA.top + gap + T / 2 : ARENA.bottom - gap - T / 2,
        normal: { x: 0, y: top ? 1 : -1 },
        rotation: top ? 0 : Math.PI,
      };
    }
    case 'left':
    case 'right': {
      const start = ARENA.top + sideInset;
      const end = ARENA.bottom - sideInset;
      const left = side === 'left';
      return {
        axis: 'y',
        start,
        end,
        min: start + L / 2,
        max: end - L / 2,
        fixed: left ? ARENA.left + gap + T / 2 : ARENA.right - gap - T / 2,
        normal: { x: left ? 1 : -1, y: 0 },
        rotation: left ? -Math.PI / 2 : Math.PI / 2,
      };
    }
  }
}

let nextPaddleId = 1;

export interface PaddleOptions {
  /** Paddle length (defaults to PADDLES.length). */
  length?: number;
  /** A fixed paddle never moves or gets picked up (the classic full-width top bar). */
  fixed?: boolean;
}

/**
 * A paddle locked to one side of the arena. It is a static Matter body that is
 * teleported along its rail each frame, with a spring-driven visual on top.
 */
export class Paddle {
  readonly id = nextPaddleId++;
  readonly rail: Rail;
  readonly length: number;
  readonly fixed: boolean;
  readonly body: MatterJS.BodyType;
  readonly container: Phaser.GameObjects.Container;

  /** Current center along the rail axis (px). */
  pos: number;
  /** Where the paddle wants to be (finger target or constraint push). */
  target: number;
  /** Smoothed velocity along the rail (px/s). */
  vel = 0;
  dragging = false;

  private readonly face: Phaser.GameObjects.Image;
  private readonly flash: Phaser.GameObjects.Image;
  private readonly shadow: Phaser.GameObjects.Image;
  private kick = 0;
  private kickVel = 0;
  private squash = 0;
  private squashVel = 0;
  private flashAlpha = 0;
  private tilt = 0;
  private dragAmount = 0;
  /** 0..1 build-in animation progress (1 = fully built). */
  appear = 1;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly side: Side,
    normalizedPos: number,
    color: number,
    options: PaddleOptions = {},
  ) {
    this.length = options.length ?? PADDLES.length;
    this.fixed = options.fixed ?? false;
    this.rail = railFor(side, this.length);
    this.pos = this.fromNormalized(normalizedPos);
    this.target = this.pos;

    const { x, y } = this.worldCenter();
    const horizontal = this.rail.axis === 'x';
    this.body = scene.matter.add.rectangle(
      x,
      y,
      horizontal ? this.length : PADDLES.thickness,
      horizontal ? PADDLES.thickness : this.length,
      {
        isStatic: true,
        label: 'paddle',
        restitution: 1,
        friction: 0,
        frictionStatic: 0,
        chamfer: { radius: PADDLES.thickness / 2 - 2 },
        collisionFilter: { category: CATEGORY.paddle, mask: CATEGORY.ball, group: 0 },
      },
    );

    const tex = ensurePaddleTextures(scene, this.length);
    this.shadow = scene.add.image(0, 4, tex.shadow).setAlpha(0.5);
    this.face = scene.add.image(0, 0, tex.face).setTint(color);
    this.flash = scene.add.image(0, 0, tex.flash).setAlpha(0);
    this.container = scene.add.container(x, y, [this.shadow, this.face, this.flash]).setDepth(DEPTH.paddles);
    this.container.setRotation(this.rail.rotation);
  }

  get normalized(): number {
    const span = this.rail.max - this.rail.min;
    return span <= 0 ? 0.5 : clamp((this.pos - this.rail.min) / span, 0, 1);
  }

  fromNormalized(n: number): number {
    return this.rail.min + clamp(n, 0, 1) * (this.rail.max - this.rail.min);
  }

  worldCenter(): Vec2 {
    return this.rail.axis === 'x' ? { x: this.pos, y: this.rail.fixed } : { x: this.rail.fixed, y: this.pos };
  }

  /** Coordinate along this paddle's axis for a world point. */
  axisOf(x: number, y: number): number {
    return this.rail.axis === 'x' ? x : y;
  }

  setColor(color: number): void {
    this.face.setTint(color);
  }

  /** Is the point inside the generous touch area of this paddle? */
  hitTest(px: number, py: number): boolean {
    if (this.fixed) return false;
    const along = this.axisOf(px, py);
    if (Math.abs(along - this.pos) > this.length / 2 + PADDLES.hitboxAlongExtra) return false;
    // Signed distance from the wall line into the arena.
    let depth: number;
    if (this.side === 'top') depth = py - ARENA.top;
    else if (this.side === 'bottom') depth = ARENA.bottom - py;
    else if (this.side === 'left') depth = px - ARENA.left;
    else depth = ARENA.right - px;
    return depth >= -PADDLES.hitboxOutside && depth <= PADDLES.hitboxInside;
  }

  /** Snap instantly (map changes / construction), no smoothing. */
  snapTo(pos: number): void {
    this.pos = clamp(pos, this.rail.min, this.rail.max);
    this.target = this.pos;
    this.vel = 0;
    this.syncBody();
  }

  /** Ball impact: squash, kick back toward the wall and flash. `strength` ~0.4..1.5. */
  hit(strength: number): void {
    // The long fixed bar is hit constantly, so it only twitches.
    const k = this.fixed ? JUICE.fullBarFeedbackScale : 1;
    this.kick = Math.max(this.kick, JUICE.paddleKick * strength * k);
    this.kickVel = 0;
    this.squash = Math.max(this.squash, Math.min(0.45, JUICE.paddleSquash * strength * k));
    this.squashVel = 0;
    this.flashAlpha = Math.max(this.flashAlpha, Math.min(0.9, (0.45 + 0.3 * strength) * k));
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const prev = this.pos;
    // Exponential follow, capped by a max speed so a fast swipe never teleports into balls.
    let next = this.pos + (this.target - this.pos) * damp(PADDLES.followSharpness, dt);
    const maxStep = PADDLES.maxSpeed * dt;
    next = clamp(next, this.pos - maxStep, this.pos + maxStep);
    this.pos = clamp(next, this.rail.min, this.rail.max);
    const instVel = (this.pos - prev) / dt;
    this.vel += (instVel - this.vel) * damp(18, dt);
    this.syncBody();

    // Springs: kick (px toward the wall) and squash (thickness compression).
    const k = 650;
    const c = 20;
    this.kickVel += (-k * this.kick - c * this.kickVel) * dt;
    this.kick += this.kickVel * dt;
    this.squashVel += (-k * this.squash - c * this.squashVel) * dt;
    this.squash += this.squashVel * dt;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 5);

    this.dragAmount += ((this.dragging ? 1 : 0) - this.dragAmount) * damp(16, dt);
    const tiltTarget = this.dragging
      ? clamp(this.vel / PADDLES.maxSpeed, -1, 1) * degToRad(PADDLES.maxTiltDeg) * (this.rail.axis === 'x' ? 1 : -1)
      : 0;
    this.tilt += (tiltTarget - this.tilt) * damp(14, dt);

    // Build-in animation: slides out of the wall and stretches to full length.
    const appearOffset = (1 - this.appear) * 70;
    const n = this.rail.normal;
    const { x, y } = this.worldCenter();
    const back = this.kick + appearOffset;
    this.container.setPosition(x - n.x * back, y - n.y * back);
    this.container.setRotation(this.rail.rotation + this.tilt);
    const grow = 1 + (PADDLES.dragScale - 1) * this.dragAmount;
    const lengthScale = (0.25 + 0.75 * this.appear) * grow * (this.fixed ? 1 : 1 + this.squash * 0.18);
    const thickScale = grow * (1 - this.squash);
    this.face.setScale(lengthScale, thickScale);
    this.flash.setScale(lengthScale, thickScale).setAlpha(this.flashAlpha);
    this.shadow.setScale(lengthScale * 1.02, 1 + this.dragAmount * 0.5).setAlpha((0.45 + this.dragAmount * 0.35) * this.appear);
    this.face.setAlpha(Math.min(1, this.appear * 1.6));
  }

  private syncBody(): void {
    const { x, y } = this.worldCenter();
    this.scene.matter.body.setPosition(this.body, { x, y }, false);
  }

  destroy(): void {
    this.scene.matter.world.remove(this.body);
    this.container.destroy();
  }
}
