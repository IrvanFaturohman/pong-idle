import Phaser from 'phaser';
import { CSS_COLORS, DEPTH, FONT_FAMILY, JUICE } from '../config';
import { formatNumber } from '../utils/formatNumber';
import { easeOutBack, easeOutCubic, randRange } from '../utils/math';
import { TEX } from '../utils/textures';

interface FloatText {
  text: Phaser.GameObjects.Text;
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  rise: number;
  amount: number;
  isMoney: boolean;
  pop: number;
  size: number;
}

interface RingFx {
  g: Phaser.GameObjects.Graphics;
  active: boolean;
  age: number;
  duration: number;
  x: number;
  y: number;
  r0: number;
  r1: number;
  width: number;
  color: number;
}

interface FlashFx {
  img: Phaser.GameObjects.Image;
  active: boolean;
  age: number;
  duration: number;
  scale: number;
}

const FLOAT_POOL = 28;
const RING_POOL = 10;
const FLASH_POOL = 6;

/**
 * Pooled game-feel effects: particles, floating reward text, rings, flashes and
 * a directional camera "kick". Nothing here allocates per frame.
 */
export class JuiceManager {
  private readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly dust: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly burst: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly floats: FloatText[] = [];
  private readonly rings: RingFx[] = [];
  private readonly flashes: FlashFx[] = [];

  // Values read by particle onEmit callbacks for the burst currently being emitted.
  private emitAngle = 0;
  private emitSpread = 60;
  private emitTint = 0xffffff;
  private burstTints: readonly number[] = [0xffffff];

  private kickX = 0;
  private kickY = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.sparks = scene.add.particles(0, 0, TEX.dot, {
      emitting: false,
      lifespan: { min: 200, max: 420 },
      speed: { min: 160, max: 520 },
      angle: { onEmit: () => this.emitAngle + randRange(-this.emitSpread, this.emitSpread) },
      scale: { start: 0.85, end: 0 },
      alpha: { start: 1, end: 0.2 },
      tint: { onEmit: () => this.emitTint },
      maxParticles: 260,
    });
    this.sparks.setDepth(DEPTH.particles);

    this.dust = scene.add.particles(0, 0, TEX.dot, {
      emitting: false,
      lifespan: { min: 160, max: 300 },
      speed: { min: 50, max: 150 },
      angle: { onEmit: () => this.emitAngle + randRange(-70, 70) },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.5, end: 0 },
      tint: { onEmit: () => this.emitTint },
      maxParticles: 120,
    });
    this.dust.setDepth(DEPTH.particles);

    this.burst = scene.add.particles(0, 0, TEX.dot, {
      emitting: false,
      lifespan: { min: 380, max: 780 },
      speed: { min: 220, max: 820 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.5, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: { onEmit: () => this.burstTints[Math.floor(Math.random() * this.burstTints.length)] },
      maxParticles: 160,
    });
    this.burst.setDepth(DEPTH.particles);

    for (let i = 0; i < FLOAT_POOL; i++) {
      const text = scene.add
        .text(0, 0, '', { fontFamily: FONT_FAMILY, fontSize: '44px', fontStyle: '800', color: CSS_COLORS.yellow })
        .setOrigin(0.5)
        .setDepth(DEPTH.floatText)
        .setShadow(0, 4, 'rgba(0,0,0,0.45)', 8, false, true)
        .setVisible(false);
      this.floats.push({ text, active: false, age: 0, duration: 0, x: 0, y: 0, rise: 0, amount: 0, isMoney: false, pop: 0, size: 44 });
    }
    for (let i = 0; i < RING_POOL; i++) {
      const g = scene.add.graphics().setDepth(DEPTH.fx).setVisible(false);
      this.rings.push({ g, active: false, age: 0, duration: 0, x: 0, y: 0, r0: 0, r1: 0, width: 0, color: 0 });
    }
    for (let i = 0; i < FLASH_POOL; i++) {
      const img = scene.add.image(0, 0, TEX.glow).setDepth(DEPTH.fx).setVisible(false);
      this.flashes.push({ img, active: false, age: 0, duration: 0, scale: 1 });
    }
  }

  // ------------------------------------------------------------ particles

  /** Directional burst at a paddle hit. `angleDeg` = direction the ball leaves in. */
  hitBurst(x: number, y: number, angleDeg: number, color: number, level: number): void {
    this.emitAngle = angleDeg;
    this.emitSpread = 55;
    this.emitTint = color;
    const n = Math.min(JUICE.hitParticlesMax, JUICE.hitParticlesBase + level * JUICE.hitParticlesPerLevel);
    this.sparks.explode(n, x, y);
    if (level >= 4) {
      this.emitTint = 0xffffff;
      this.sparks.explode(Math.floor(n / 3), x, y);
    }
  }

  wallPuff(x: number, y: number, angleDeg: number, color: number): void {
    this.emitAngle = angleDeg;
    this.emitTint = color;
    this.dust.explode(3, x, y);
  }

  sparksAt(x: number, y: number, angleDeg: number, color: number, count = 6): void {
    this.emitAngle = angleDeg;
    this.emitSpread = 70;
    this.emitTint = color;
    this.sparks.explode(count, x, y);
  }

  /** Single soft particle left behind by balls being pulled together during a merge. */
  trailDot(x: number, y: number, color: number): void {
    this.emitAngle = randRange(0, 360);
    this.emitTint = color;
    this.dust.explode(1, x, y);
  }

  radialBurst(x: number, y: number, tints: readonly number[], count: number): void {
    this.burstTints = tints;
    this.burst.explode(count, x, y);
  }

  // ------------------------------------------------------------ floating text

  private acquireFloat(): FloatText {
    let oldest = this.floats[0];
    for (const f of this.floats) {
      if (!f.active) return f;
      if (f.age / f.duration > oldest.age / oldest.duration) oldest = f;
    }
    return oldest;
  }

  /**
   * Floating "+$X". Hits that land close together in space and time are merged
   * into one growing number instead of stacking dozens of labels.
   */
  money(x: number, y: number, amount: number, level: number, maxCombo: boolean): void {
    const r2 = JUICE.floatTextMergeRadius * JUICE.floatTextMergeRadius;
    for (const f of this.floats) {
      if (!f.active || !f.isMoney || f.age > JUICE.floatTextMergeWindowMs) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      if (dx * dx + dy * dy < r2) {
        f.amount += amount;
        f.text.setText('+$' + formatNumber(f.amount));
        f.pop = 1;
        f.age = Math.min(f.age, 80);
        return;
      }
    }
    const f = this.acquireFloat();
    const size = Math.round(40 + Math.min(level, 7) * 4);
    f.active = true;
    f.isMoney = true;
    f.amount = amount;
    f.age = 0;
    f.duration = JUICE.floatTextMs;
    f.x = x;
    f.y = y;
    f.rise = 110;
    f.pop = 1;
    f.size = size;
    f.text
      .setText('+$' + formatNumber(amount))
      .setFontSize(size)
      .setColor(maxCombo ? CSS_COLORS.green : CSS_COLORS.yellow)
      .setVisible(true)
      .setAlpha(1)
      .setPosition(x, y);
  }

  /** Non-merging label such as "LEVEL UP!". */
  label(x: number, y: number, text: string, color: string, size = 64, duration = 1100): void {
    const f = this.acquireFloat();
    f.active = true;
    f.isMoney = false;
    f.amount = 0;
    f.age = 0;
    f.duration = duration;
    f.x = x;
    f.y = y;
    f.rise = 90;
    f.pop = 1;
    f.size = size;
    f.text.setText(text).setFontSize(size).setColor(color).setVisible(true).setAlpha(1).setPosition(x, y);
  }

  // ------------------------------------------------------------ rings & flashes

  ring(x: number, y: number, color: number, r0: number, r1: number, durationMs: number, width = 10): void {
    let ring = this.rings.find((r) => !r.active);
    if (!ring) ring = this.rings.reduce((a, b) => (a.age / a.duration > b.age / b.duration ? a : b));
    Object.assign(ring, { active: true, age: 0, duration: durationMs, x, y, r0, r1, width, color });
    ring.g.setVisible(true);
  }

  flash(x: number, y: number, color: number, scale: number, durationMs = 320): void {
    let fx = this.flashes.find((f) => !f.active);
    if (!fx) fx = this.flashes[0];
    fx.active = true;
    fx.age = 0;
    fx.duration = durationMs;
    fx.scale = scale;
    fx.img.setPosition(x, y).setTint(color).setVisible(true).setAlpha(1).setScale(scale * 0.4);
  }

  // ------------------------------------------------------------ camera

  /** Small directional nudge of the camera that springs back (used for strong hits). */
  kick(dx: number, dy: number): void {
    this.kickX += dx;
    this.kickY += dy;
    const len = Math.hypot(this.kickX, this.kickY);
    if (len > JUICE.cameraKickMax) {
      this.kickX = (this.kickX / len) * JUICE.cameraKickMax;
      this.kickY = (this.kickY / len) * JUICE.cameraKickMax;
    }
  }

  shake(durationMs: number, intensity: number): void {
    this.scene.cameras.main.shake(durationMs, intensity, true);
  }

  // ------------------------------------------------------------ update

  update(dt: number): void {
    const ms = dt * 1000;
    for (const f of this.floats) {
      if (!f.active) continue;
      f.age += ms;
      const t = Math.min(1, f.age / f.duration);
      if (t >= 1) {
        f.active = false;
        f.text.setVisible(false);
        continue;
      }
      f.pop = Math.max(0, f.pop - dt * 6);
      const y = f.y - easeOutCubic(t) * f.rise;
      f.text.setPosition(f.x, y);
      f.text.setScale(1 + f.pop * 0.28 * easeOutBack(1 - f.pop));
      f.text.setAlpha(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }

    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += ms;
      const t = Math.min(1, r.age / r.duration);
      r.g.clear();
      if (t >= 1) {
        r.active = false;
        r.g.setVisible(false);
        continue;
      }
      const e = easeOutCubic(t);
      r.g.lineStyle(Math.max(1, r.width * (1 - t)), r.color, 1 - t);
      r.g.strokeCircle(r.x, r.y, r.r0 + (r.r1 - r.r0) * e);
    }

    for (const f of this.flashes) {
      if (!f.active) continue;
      f.age += ms;
      const t = Math.min(1, f.age / f.duration);
      if (t >= 1) {
        f.active = false;
        f.img.setVisible(false);
        continue;
      }
      f.img.setScale(f.scale * (0.4 + 0.8 * easeOutCubic(t)));
      f.img.setAlpha(0.85 * (1 - t));
    }

    // Camera kick decays quickly back to rest.
    const decay = Math.exp(-16 * dt);
    this.kickX *= decay;
    this.kickY *= decay;
    if (Math.abs(this.kickX) < 0.05) this.kickX = 0;
    if (Math.abs(this.kickY) < 0.05) this.kickY = 0;
    this.scene.cameras.main.setScroll(-this.kickX, -this.kickY);
  }
}
