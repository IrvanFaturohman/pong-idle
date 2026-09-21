import Phaser from 'phaser';
import { ARENA, BALLS, CATEGORY, DEPTH, GAME_HEIGHT, GAME_WIDTH, LAYOUT, PADDLES, PHYSICS } from '../config';
import { getMap } from '../data/maps';
import { railFor } from '../entities/Paddle';
import type { MapDef, ObstacleDef, Side, Vec2 } from '../types';
import { damp, hexToCss, mixColor, randRange } from '../utils/math';
import { roundRectPath, TEX } from '../utils/textures';

export type ObstacleKind = ObstacleDef['kind'];

export interface ObstacleRuntime {
  def: ObstacleDef;
  body: MatterJS.BodyType;
  view: Phaser.GameObjects.Container;
  flash: Phaser.GameObjects.Graphics;
  /** World-space center. */
  x: number;
  y: number;
  angle: number;
  pulse: number;
}

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];
const ARENA_PAD = 40;

/**
 * Builds and owns everything map-specific: arena art, the four boundary walls,
 * internal obstacles, rails and safe spawn points.
 */
export class MapManager {
  def: MapDef = getMap(0);
  readonly walls: MatterJS.BodyType[] = [];
  obstacles: ObstacleRuntime[] = [];

  private readonly vignette: Phaser.GameObjects.Image;
  private arenaImage: Phaser.GameObjects.Image | null = null;
  private arenaTextureKey: string | null = null;
  private readonly rails = new Map<Side, Phaser.GameObjects.Graphics>();
  private readonly railAlpha = new Map<Side, number>();
  private readonly railFlash = new Map<Side, number>();

  constructor(private readonly scene: Phaser.Scene) {
    this.vignette = scene.add
      .image(GAME_WIDTH / 2, GAME_HEIGHT / 2, TEX.vignette)
      .setDisplaySize(GAME_WIDTH + 200, GAME_HEIGHT + 200)
      .setDepth(DEPTH.background);
    this.createWalls();
    for (const side of SIDES) {
      const g = scene.add.graphics().setDepth(DEPTH.rails).setAlpha(0);
      this.rails.set(side, g);
      this.railAlpha.set(side, 0);
      this.railFlash.set(side, 0);
    }
  }

  get focus(): Vec2 {
    return { x: ARENA.centerX + this.def.focus.x, y: ARENA.centerY + this.def.focus.y };
  }

  /** Thick static walls just outside the visible arena; thickness prevents tunnelling. */
  private createWalls(): void {
    const t = PHYSICS.wallThickness;
    const opts = (label: string): MatterJS.IChamferableBodyDefinition => ({
      isStatic: true,
      label,
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      collisionFilter: { category: CATEGORY.wall, mask: CATEGORY.ball, group: 0 },
    });
    const m = this.scene.matter.add;
    this.walls.push(
      m.rectangle(ARENA.centerX, ARENA.top - t / 2, ARENA.width + t * 2, t, opts('wall-top')),
      m.rectangle(ARENA.centerX, ARENA.bottom + t / 2, ARENA.width + t * 2, t, opts('wall-bottom')),
      m.rectangle(ARENA.left - t / 2, ARENA.centerY, t, ARENA.height + t * 2, opts('wall-left')),
      m.rectangle(ARENA.right + t / 2, ARENA.centerY, t, ARENA.height + t * 2, opts('wall-right')),
    );
  }

  /** Tear down the previous map's art/obstacles and build map `index`. */
  build(index: number): void {
    this.def = getMap(index);
    const p = this.def.palette;
    this.scene.cameras.main.setBackgroundColor(p.background);

    this.buildArenaImage();
    for (const o of this.obstacles) {
      this.scene.matter.world.remove(o.body);
      o.view.destroy();
    }
    this.obstacles = this.def.obstacles.map((d) => this.createObstacle(d));
    for (const side of SIDES) this.drawRail(side);
  }

  /** Bake the arena surface (gradient, inner shade, faint court lines, border) into one canvas texture. */
  private buildArenaImage(): void {
    const p = this.def.palette;
    const key = `arena-${this.def.id}`;
    if (this.arenaTextureKey && this.arenaTextureKey !== key && this.scene.textures.exists(this.arenaTextureKey)) {
      this.arenaImage?.destroy();
      this.arenaImage = null;
      this.scene.textures.remove(this.arenaTextureKey);
    }
    this.arenaTextureKey = key;

    if (!this.scene.textures.exists(key)) {
      const w = ARENA.width + ARENA_PAD * 2;
      const h = ARENA.height + ARENA_PAD * 2;
      const tex = this.scene.textures.createCanvas(key, w, h);
      if (tex) {
        const c = tex.getContext();
        const r = LAYOUT.arena.cornerRadius;
        const x0 = ARENA_PAD;
        const y0 = ARENA_PAD;

        // Soft drop shadow for depth.
        c.save();
        c.shadowColor = 'rgba(0,0,0,0.55)';
        c.shadowBlur = 36;
        c.shadowOffsetY = 14;
        c.fillStyle = hexToCss(p.arenaBottom);
        roundRectPath(c, x0, y0, ARENA.width, ARENA.height, r);
        c.fill();
        c.restore();

        // Surface gradient.
        const g = c.createLinearGradient(0, y0, 0, y0 + ARENA.height);
        g.addColorStop(0, hexToCss(p.arenaTop));
        g.addColorStop(1, hexToCss(p.arenaBottom));
        c.fillStyle = g;
        roundRectPath(c, x0, y0, ARENA.width, ARENA.height, r);
        c.fill();

        c.save();
        roundRectPath(c, x0, y0, ARENA.width, ARENA.height, r);
        c.clip();
        // Inner shading along the edges.
        const edge = 60;
        const shade = 'rgba(0,0,0,0.22)';
        const clear = 'rgba(0,0,0,0)';
        const edges: Array<[number, number, number, number, number, number, number, number]> = [
          [x0, y0, x0, y0 + edge, x0, y0, ARENA.width, edge],
          [x0, y0 + ARENA.height, x0, y0 + ARENA.height - edge, x0, y0 + ARENA.height - edge, ARENA.width, edge],
          [x0, y0, x0 + edge, y0, x0, y0, edge, ARENA.height],
          [x0 + ARENA.width, y0, x0 + ARENA.width - edge, y0, x0 + ARENA.width - edge, y0, edge, ARENA.height],
        ];
        for (const [gx0, gy0, gx1, gy1, rx, ry, rw, rh] of edges) {
          const eg = c.createLinearGradient(gx0, gy0, gx1, gy1);
          eg.addColorStop(0, shade);
          eg.addColorStop(1, clear);
          c.fillStyle = eg;
          c.fillRect(rx, ry, rw, rh);
        }
        // Faint dot grid.
        c.fillStyle = 'rgba(255,255,255,0.035)';
        const step = 94;
        for (let gx = x0 + step / 2; gx < x0 + ARENA.width; gx += step) {
          for (let gy = y0 + step / 2 + 10; gy < y0 + ARENA.height; gy += step) {
            c.beginPath();
            c.arc(gx, gy, 3, 0, Math.PI * 2);
            c.fill();
          }
        }
        // Dashed Pong center line.
        c.strokeStyle = 'rgba(255,255,255,0.045)';
        c.lineWidth = 6;
        c.setLineDash([26, 22]);
        c.beginPath();
        c.moveTo(x0 + 30, y0 + ARENA.height / 2);
        c.lineTo(x0 + ARENA.width - 30, y0 + ARENA.height / 2);
        c.stroke();
        c.setLineDash([]);
        c.restore();

        // Border.
        c.strokeStyle = hexToCss(p.border);
        c.lineWidth = 6;
        roundRectPath(c, x0 + 3, y0 + 3, ARENA.width - 6, ARENA.height - 6, r - 3);
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.04)';
        c.lineWidth = 2;
        roundRectPath(c, x0 + 7, y0 + 7, ARENA.width - 14, ARENA.height - 14, r - 7);
        c.stroke();
        tex.refresh();
      }
    }

    if (!this.arenaImage) {
      this.arenaImage = this.scene.add.image(ARENA.left - ARENA_PAD, ARENA.top - ARENA_PAD, key).setOrigin(0).setDepth(DEPTH.arena);
    } else {
      this.arenaImage.setTexture(key);
    }
  }

  private createObstacle(def: ObstacleDef): ObstacleRuntime {
    const p = this.def.palette;
    const x = ARENA.centerX + def.x;
    const y = ARENA.centerY + def.y;
    const common = {
      isStatic: true,
      restitution: 1,
      friction: 0,
      frictionStatic: 0,
      collisionFilter: { category: CATEGORY.obstacle, mask: CATEGORY.ball, group: 0 },
    };
    const m = this.scene.matter.add;
    const shape = this.scene.add.graphics();
    const flash = this.scene.add.graphics().setAlpha(0);
    const shadow = this.scene.add.graphics();
    let body: MatterJS.BodyType;

    switch (def.kind) {
      case 'diamond': {
        const { halfWidth: hw, halfHeight: hh } = def;
        body = m.fromVertices(x, y, [
          { x: 0, y: -hh },
          { x: hw, y: 0 },
          { x: 0, y: hh },
          { x: -hw, y: 0 },
        ], { ...common, label: 'obstacle-diamond' });
        this.scene.matter.body.setPosition(body, { x, y }, false);
        shadow.fillStyle(0x000000, 0.28);
        shadow.fillPoints([new Phaser.Math.Vector2(0, -hh + 14), new Phaser.Math.Vector2(hw + 6, 14), new Phaser.Math.Vector2(0, hh + 18), new Phaser.Math.Vector2(-hw - 6, 14)], true);
        // Faceted shading: four triangles lit from the top-left.
        const facets: Array<[number, Vec2, Vec2]> = [
          [p.obstacleLight, { x: 0, y: -hh }, { x: -hw, y: 0 }],
          [p.obstacle, { x: 0, y: -hh }, { x: hw, y: 0 }],
          [p.obstacleDark, { x: hw, y: 0 }, { x: 0, y: hh }],
          [mixColor(p.obstacle, p.obstacleDark, 0.45), { x: -hw, y: 0 }, { x: 0, y: hh }],
        ];
        for (const [color, a, b] of facets) {
          shape.fillStyle(color, 1);
          shape.fillTriangle(0, 0, a.x, a.y, b.x, b.y);
        }
        const inset = 0.42;
        shape.lineStyle(3, 0xffffff, 0.22);
        shape.strokePoints([new Phaser.Math.Vector2(0, -hh * inset), new Phaser.Math.Vector2(hw * inset, 0), new Phaser.Math.Vector2(0, hh * inset), new Phaser.Math.Vector2(-hw * inset, 0)], true, true);
        flash.fillStyle(0xffffff, 1);
        flash.fillPoints([new Phaser.Math.Vector2(0, -hh), new Phaser.Math.Vector2(hw, 0), new Phaser.Math.Vector2(0, hh), new Phaser.Math.Vector2(-hw, 0)], true);
        break;
      }
      case 'bumper': {
        const r = def.radius;
        body = m.circle(x, y, r, { ...common, label: 'obstacle-bumper' });
        shadow.fillStyle(0x000000, 0.3);
        shadow.fillCircle(4, 12, r + 4);
        shape.fillStyle(p.obstacleDark, 1);
        shape.fillCircle(0, 0, r);
        shape.fillStyle(p.obstacle, 1);
        shape.fillCircle(0, -3, r - 10);
        shape.fillStyle(mixColor(p.obstacle, p.obstacleDark, 0.35), 1);
        shape.fillCircle(0, 0, r * 0.42);
        shape.fillStyle(p.obstacleLight, 0.9);
        shape.fillCircle(0, -2, r * 0.3);
        shape.fillStyle(0xffffff, 0.35);
        shape.fillEllipse(-r * 0.32, -r * 0.42, r * 0.5, r * 0.26);
        flash.fillStyle(0xffffff, 1);
        flash.fillCircle(0, 0, r);
        break;
      }
      case 'bar': {
        const { length: L, thickness: T } = def;
        body = m.rectangle(x, y, L, T, { ...common, label: 'obstacle-bar', chamfer: { radius: T / 2 - 1 } });
        shadow.fillStyle(0x000000, 0.3);
        shadow.fillRoundedRect(-L / 2 + 4, -T / 2 + 10, L, T, T / 2);
        shape.fillStyle(mixColor(p.secondary, 0x000000, 0.25), 1);
        shape.fillRoundedRect(-L / 2, -T / 2, L, T, T / 2);
        shape.fillStyle(p.secondary, 1);
        shape.fillRoundedRect(-L / 2 + 3, -T / 2 + 2, L - 6, T - 8, (T - 8) / 2);
        shape.fillStyle(0xffffff, 0.3);
        shape.fillRoundedRect(-L / 2 + 16, -T / 2 + 5, L - 32, 4, 2);
        shape.fillStyle(mixColor(p.secondary, 0x000000, 0.45), 1);
        shape.fillCircle(0, 0, 9);
        shape.fillStyle(0xffffff, 0.5);
        shape.fillCircle(-2, -2, 3.5);
        flash.fillStyle(0xffffff, 1);
        flash.fillRoundedRect(-L / 2, -T / 2, L, T, T / 2);
        break;
      }
    }

    const view = this.scene.add.container(x, y, [shadow, shape, flash]).setDepth(DEPTH.obstacles);
    return { def, body, view, flash, x, y, angle: 0, pulse: 0 };
  }

  /** Advance moving obstacles by one physics sub-step. */
  stepObstacles(dtMs: number): void {
    for (const o of this.obstacles) {
      if (o.def.kind !== 'bar') continue;
      o.angle += o.def.angularSpeed * (dtMs / 1000);
      this.scene.matter.body.setAngle(o.body, o.angle, false);
    }
  }

  /** Per-frame visuals (real time). */
  updateVisuals(dt: number): void {
    for (const o of this.obstacles) {
      o.view.setRotation(o.angle);
      o.pulse = Math.max(0, o.pulse - dt * 4.5);
      o.flash.setAlpha(o.pulse * 0.55);
      const s = 1 + o.pulse * (o.def.kind === 'bumper' ? 0.1 : 0.035);
      o.view.setScale(s);
    }
    for (const side of SIDES) {
      const g = this.rails.get(side);
      if (!g) continue;
      const flashLeft = Math.max(0, (this.railFlash.get(side) ?? 0) - dt);
      this.railFlash.set(side, flashLeft);
      const target = Math.max(this.railAlpha.get(side) ?? 0, flashLeft > 0 ? 0.9 : 0);
      g.setAlpha(g.alpha + (target - g.alpha) * damp(12, dt));
    }
  }

  onObstacleHit(o: ObstacleRuntime): void {
    o.pulse = 1;
  }

  obstacleByBody(body: MatterJS.BodyType): ObstacleRuntime | undefined {
    for (const o of this.obstacles) if (o.body === body) return o;
    return undefined;
  }

  private drawRail(side: Side): void {
    const g = this.rails.get(side);
    if (!g) return;
    const rail = railFor(side);
    const accent = this.def.palette.accent;
    g.clear();
    const w = 6;
    if (rail.axis === 'x') {
      g.fillStyle(this.def.palette.rail, 1);
      g.fillRoundedRect(rail.start + 10, rail.fixed - w / 2, rail.end - rail.start - 20, w, w / 2);
      g.fillStyle(accent, 1);
      g.fillCircle(rail.start + 10, rail.fixed, 7);
      g.fillCircle(rail.end - 10, rail.fixed, 7);
    } else {
      g.fillStyle(this.def.palette.rail, 1);
      g.fillRoundedRect(rail.fixed - w / 2, rail.start + 10, w, rail.end - rail.start - 20, w / 2);
      g.fillStyle(accent, 1);
      g.fillCircle(rail.fixed, rail.start + 10, 7);
      g.fillCircle(rail.fixed, rail.end - 10, 7);
    }
  }

  /** Target opacity of a side's rail (eased in updateVisuals). */
  setRailAlpha(side: Side, alpha: number): void {
    this.railAlpha.set(side, alpha);
  }

  /** Briefly show a rail (new paddle built on it). */
  flashRail(side: Side, seconds = 1.4): void {
    this.railFlash.set(side, seconds);
  }

  /** True if the point lies inside any obstacle's solid shape. */
  isInsideObstacle(px: number, py: number): boolean {
    for (const o of this.obstacles) {
      const dx = px - o.x;
      const dy = py - o.y;
      const d = o.def;
      if (d.kind === 'bumper' && dx * dx + dy * dy < d.radius * d.radius) return true;
      if (d.kind === 'diamond' && Math.abs(dx) / d.halfWidth + Math.abs(dy) / d.halfHeight < 1) return true;
      if (d.kind === 'bar') {
        const c = Math.cos(-o.angle);
        const s = Math.sin(-o.angle);
        const lx = dx * c - dy * s;
        const ly = dx * s + dy * c;
        if (Math.abs(lx) < d.length / 2 && Math.abs(ly) < d.thickness / 2) return true;
      }
    }
    return false;
  }

  /** Clearance radius of each obstacle (the bar uses its full sweep circle). */
  private clearance(d: ObstacleDef): number {
    if (d.kind === 'bumper') return d.radius;
    if (d.kind === 'diamond') return Math.max(d.halfWidth, d.halfHeight);
    return d.length / 2;
  }

  /** Is a ball of `radius` at (x, y) safely inside the playfield and clear of obstacles? */
  isClear(x: number, y: number, radius: number, margin = 14): boolean {
    const inner = PADDLES.wallGap + PADDLES.thickness + radius + margin;
    if (x < ARENA.left + inner || x > ARENA.right - inner || y < ARENA.top + inner || y > ARENA.bottom - inner) return false;
    for (const o of this.obstacles) {
      const need = this.clearance(o.def) + radius + margin;
      const dx = x - o.x;
      const dy = y - o.y;
      if (dx * dx + dy * dy < need * need) return false;
    }
    return true;
  }

  /** A random safe spawn point near the map's focus point. */
  findSpawnPoint(radius: number = BALLS.maxRadius, spread = 120): Vec2 {
    const f = this.focus;
    for (let i = 0; i < 40; i++) {
      const a = randRange(0, Math.PI * 2);
      const d = randRange(0, spread) * (i < 20 ? 1 : 1.8);
      const x = f.x + Math.cos(a) * d;
      const y = f.y + Math.sin(a) * d;
      if (this.isClear(x, y, radius)) return { x, y };
    }
    return f;
  }

  /** Evenly spread spawn points around the focus for re-spawning a whole collection. */
  ringSpawnPoints(count: number, radius: number = BALLS.maxRadius): Vec2[] {
    const f = this.focus;
    const pts: Vec2[] = [];
    const offset = randRange(0, Math.PI * 2);
    for (let i = 0; i < count; i++) {
      const ring = i === 0 && count % 2 === 1 ? 0 : i % 2 === 0 ? 150 : 95;
      const a = offset + (i / Math.max(1, count)) * Math.PI * 2;
      const p = { x: f.x + Math.cos(a) * ring, y: f.y + Math.sin(a) * ring };
      pts.push(this.isClear(p.x, p.y, radius, 4) ? p : this.findSpawnPoint(radius));
    }
    return pts;
  }

  destroy(): void {
    for (const o of this.obstacles) o.view.destroy();
    this.obstacles = [];
    this.vignette.destroy();
    this.arenaImage?.destroy();
    for (const g of this.rails.values()) g.destroy();
  }
}
