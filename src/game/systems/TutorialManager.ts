import Phaser from 'phaser';
import { ARENA, BALLS, COLORS, CSS_COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ctx, saveNow } from '../context';
import type { GameScene } from '../scenes/GameScene';
import { PillButton, textStyle } from '../ui/widgets';
import { clamp } from '../utils/math';
import { TEX } from '../utils/textures';
import { bus } from './EventBus';

/** Tutorial steps in order. The saved `tutorial.step` is an index into this list. */
const STEPS = ['drag', 'hit', 'tap', 'addBall', 'merge', 'higher', 'addPaddle'] as const;
type StepId = (typeof STEPS)[number];

export type TutorialTarget = 'addBall' | 'merge' | 'addPaddle';

interface Presentation {
  key: string;
  text: string;
  bubbleY: number;
  /** 'ui' dims HUD + panel (arena stays bright), 'focus' dims everything except the target. */
  dim: 'none' | 'ui' | 'focus';
  target?: Phaser.Geom.Rectangle;
  hand?: 'drag' | 'tap';
  /** Where the tapping hand points when there is no highlighted target. */
  handAt?: { x: number; y: number };
}

/**
 * Short interactive first-run tutorial. Each step waits for the player to do
 * the thing (drag, earn, buy, merge). Progress is saved so completed steps are
 * never shown again, and it can be skipped at any time.
 */
export class TutorialManager {
  private step: number;
  private done: boolean;
  private current: Presentation | null = null;
  private readonly dim: Phaser.GameObjects.Graphics;
  private readonly focusRing: Phaser.GameObjects.Graphics;
  private readonly hitRing: Phaser.GameObjects.Graphics;
  private readonly bubble: Phaser.GameObjects.Container;
  private readonly bubbleBg: Phaser.GameObjects.Graphics;
  private readonly bubbleText: Phaser.GameObjects.Text;
  private readonly skip: PillButton;
  private readonly hand: Phaser.GameObjects.Image;
  private handTween: Phaser.Tweens.Tween | null = null;
  private time = 0;
  private stepTimer = 0;
  private hitSeen = false;
  private hitRingT = 1;
  private hitX = 0;
  private hitY = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly arena: GameScene,
    private readonly targetRect: (t: TutorialTarget) => Phaser.Geom.Rectangle,
    depth: number,
  ) {
    const t = ctx().state.tutorial;
    this.step = t.step;
    this.done = t.done || t.step >= STEPS.length;

    this.dim = scene.add.graphics().setDepth(depth).setAlpha(0);
    this.focusRing = scene.add.graphics().setDepth(depth + 1);
    this.hitRing = scene.add.graphics().setDepth(depth + 1);
    this.bubbleBg = scene.add.graphics();
    this.bubbleText = scene.add.text(0, 0, '', textStyle(40, CSS_COLORS.ink, '800')).setOrigin(0, 0.5);
    this.skip = new PillButton(scene, 0, 0, 150, 60, 'SKIP', COLORS.buttonSurface, CSS_COLORS.textPrimary, () => this.skipAll());
    this.bubble = scene.add.container(GAME_WIDTH / 2, 0, [this.bubbleBg, this.bubbleText, this.skip]).setDepth(depth + 2).setAlpha(0).setVisible(false);
    this.hand = scene.add.image(0, 0, TEX.hand).setOrigin(0.5, 0.06).setDepth(depth + 3).setVisible(false);

    // Step 0 is "drag along the rail" in classic and "move to another side" in auto.
    bus.on('paddle-dragged', () => this.complete('drag'), this);
    bus.on('paddle-moved', () => this.complete('drag'), this);
    bus.on('speed-boost', () => this.complete('tap'), this);
    bus.on('paddle-hit', this.onPaddleHit, this);
    bus.on('ball-added', () => this.complete('addBall'), this);
    bus.on('merged', () => this.complete('merge'), this);
    bus.on('paddle-added', () => this.complete('addPaddle'), this);
  }

  private get stepId(): StepId | null {
    return this.done ? null : STEPS[this.step] ?? null;
  }

  private onPaddleHit(_amount: number, x: number, y: number): void {
    if (this.stepId !== 'hit' || this.hitSeen) return;
    // Highlight the very first profitable hit, then move on shortly after.
    this.hitSeen = true;
    this.hitX = x;
    this.hitY = y;
    this.hitRingT = 0;
    this.stepTimer = 1.8;
  }

  /** Mark a step as done if it is the active one (events can arrive in any order). */
  private complete(id: StepId): void {
    if (this.stepId !== id) return;
    this.advance();
  }

  private advance(): void {
    this.step++;
    this.hitSeen = false;
    this.stepTimer = 0;
    if (this.step >= STEPS.length) this.done = true;
    const t = ctx().state.tutorial;
    t.step = this.step;
    t.done = this.done;
    saveNow();
    this.present(null);
  }

  private skipAll(): void {
    this.done = true;
    const t = ctx().state.tutorial;
    t.done = true;
    t.step = STEPS.length;
    saveNow();
    this.present(null);
  }

  update(dt: number): void {
    this.time += dt;
    this.drawHitRing(dt);
    const id = this.stepId;
    if (!id) {
      if (this.current) this.present(null);
      return;
    }
    const c = ctx();
    const st = c.state;

    // Skip steps whose goal was already reached some other way (e.g. after a reload).
    if ((id === 'addBall' && st.ballsPurchased > 0) || (id === 'merge' && st.stats.merges > 0) || (id === 'addPaddle' && st.paddlesPurchased > 0)) {
      this.advance();
      return;
    }

    if (this.stepTimer > 0) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0 && (id === 'hit' || id === 'higher')) {
        this.advance();
        return;
      }
    }

    if (c.modalOpen || this.arena.transitioning) {
      this.present(null);
      return;
    }

    const locked = this.arena.isLocked();
    const arenaTextY = ARENA.top + 200;
    const lowerTextY = ARENA.bottom - 290;
    switch (id) {
      case 'drag':
        this.present(
          c.mode === 'auto'
            ? { key: 'move', text: 'Drag a paddle to another side', bubbleY: arenaTextY, dim: 'ui', hand: 'drag' }
            : { key: 'drag', text: 'Drag the paddle', bubbleY: lowerTextY, dim: 'ui', hand: 'drag' },
        );
        break;
      case 'hit':
        this.present({ key: 'hit', text: 'Paddle hits earn cash', bubbleY: arenaTextY, dim: 'none' });
        break;
      case 'tap':
        this.present({ key: 'tap', text: 'Tap the arena to speed up', bubbleY: arenaTextY, dim: 'ui', hand: 'tap', handAt: { x: ARENA.centerX + 60, y: ARENA.centerY + 40 } });
        break;
      case 'addBall': {
        const ready = !locked && this.arena.balls.length < BALLS.maxActive && c.economy.canAfford(c.economy.ballCost);
        this.present(ready ? { key: 'addBall', text: 'Add another ball', bubbleY: lowerTextY, dim: 'focus', target: this.targetRect('addBall'), hand: 'tap' } : null);
        break;
      }
      case 'merge': {
        const ready = !locked && this.arena.lowestMergeLevel() !== null;
        this.present(ready ? { key: 'merge', text: 'Merge matching balls', bubbleY: lowerTextY, dim: 'focus', target: this.targetRect('merge'), hand: 'tap' } : null);
        break;
      }
      case 'higher':
        if (this.stepTimer <= 0) this.stepTimer = 3.2;
        this.present({ key: 'higher', text: 'Higher-level balls earn more', bubbleY: arenaTextY, dim: 'none' });
        break;
      case 'addPaddle': {
        const cost = c.economy.paddleCost;
        const ready = !locked && cost !== null && c.economy.canAfford(cost);
        this.present(
          ready ? { key: 'addPaddle', text: 'Add paddles to cover every side', bubbleY: lowerTextY, dim: 'focus', target: this.targetRect('addPaddle'), hand: 'tap' } : null,
        );
        break;
      }
    }

    this.updateHand();
    this.drawFocusRing();
  }

  /** Switch to a new presentation (or hide with null). Rebuilds visuals only when the step changes. */
  private present(p: Presentation | null): void {
    if ((p?.key ?? null) === (this.current?.key ?? null)) return;
    this.current = p;
    this.handTween?.stop();
    this.handTween = null;
    this.scene.tweens.killTweensOf([this.bubble, this.dim, this.hand]);

    if (!p) {
      this.scene.tweens.add({ targets: [this.bubble, this.dim], alpha: 0, duration: 180, onComplete: () => this.bubble.setVisible(false) });
      this.hand.setVisible(false);
      this.focusRing.clear();
      return;
    }

    this.drawDim(p);
    this.scene.tweens.add({ targets: this.dim, alpha: p.dim === 'none' ? 0 : 1, duration: 260 });
    this.layoutBubble(p);
    this.bubble.setVisible(true).setScale(0.9);
    this.scene.tweens.add({ targets: this.bubble, alpha: 1, scale: 1, duration: 300, ease: 'Back.easeOut' });

    if (p.hand === 'drag') {
      this.hand.setVisible(true).setAlpha(0);
      this.scene.tweens.add({ targets: this.hand, alpha: 1, duration: 250 });
    } else if (p.hand === 'tap' && (p.target || p.handAt)) {
      const hx = p.target ? p.target.centerX + 30 : (p.handAt?.x ?? 0);
      const hy = p.target ? p.target.centerY + 10 : (p.handAt?.y ?? 0);
      this.hand.setVisible(true).setAlpha(0).setScale(1);
      this.hand.setPosition(hx, hy);
      this.scene.tweens.add({ targets: this.hand, alpha: 1, duration: 250 });
      this.handTween = this.scene.tweens.add({
        targets: this.hand,
        scale: 0.86,
        y: hy + 14,
        duration: 420,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    } else {
      this.hand.setVisible(false);
    }
  }

  private layoutBubble(p: Presentation): void {
    const maxTextW = GAME_WIDTH - 140 - 150 - 70;
    this.bubbleText.setText(p.text).setFontSize(40);
    let size = 40;
    while (this.bubbleText.width > maxTextW && size > 28) {
      size -= 2;
      this.bubbleText.setFontSize(size);
    }
    const textW = this.bubbleText.width;
    // [dot + 76px] [text] [24px gap] [150px SKIP] [20px]
    const w = 76 + textW + 24 + 150 + 20;
    const h = 116;
    this.bubbleBg.clear();
    this.bubbleBg.fillStyle(COLORS.shadow, 0.4);
    this.bubbleBg.fillRoundedRect(-w / 2, -h / 2 + 10, w, h, h / 2);
    this.bubbleBg.fillStyle(COLORS.textPrimary, 1);
    this.bubbleBg.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    this.bubbleBg.fillStyle(COLORS.yellow, 1);
    this.bubbleBg.fillCircle(-w / 2 + 48, 0, 12);
    this.bubbleText.setPosition(-w / 2 + 76, 2);
    this.skip.setPosition(w / 2 - 95, 0);
    this.bubble.setPosition(GAME_WIDTH / 2, p.bubbleY);
  }

  private drawDim(p: Presentation): void {
    const g = this.dim;
    g.clear();
    g.fillStyle(0x05070b, 0.62);
    const W = GAME_WIDTH + 40;
    const Hh = GAME_HEIGHT + 40;
    if (p.dim === 'ui') {
      g.fillRect(-20, -20, W, ARENA.top + 12);
      g.fillRect(-20, ARENA.bottom + 50, W, Hh - ARENA.bottom);
    } else if (p.dim === 'focus' && p.target) {
      const r = Phaser.Geom.Rectangle.Clone(p.target);
      Phaser.Geom.Rectangle.Inflate(r, 16, 16);
      g.fillRect(-20, -20, W, r.top + 20);
      g.fillRect(-20, r.bottom, W, Hh - r.bottom);
      g.fillRect(-20, r.top, r.left + 20, r.height);
      g.fillRect(r.right, r.top, W - r.right, r.height);
    }
  }

  private drawFocusRing(): void {
    const g = this.focusRing;
    g.clear();
    const p = this.current;
    if (!p?.target) return;
    const pulse = (Math.sin(this.time * 6) + 1) / 2;
    const r = Phaser.Geom.Rectangle.Clone(p.target);
    Phaser.Geom.Rectangle.Inflate(r, 10 + pulse * 6, 10 + pulse * 6);
    g.lineStyle(6, COLORS.yellow, 0.55 + pulse * 0.45);
    g.strokeRoundedRect(r.x, r.y, r.width, r.height, 40);
  }

  /**
   * Classic: the hand sweeps along the bottom paddle's rail.
   * Auto: it picks up the bottom paddle and carries it over to the right side.
   */
  private updateHand(): void {
    if (this.current?.hand !== 'drag') return;
    const anchor = this.arena.paddleAnchor('bottom') ?? this.arena.paddleAnchor('top');
    if (!anchor) return;
    if (ctx().mode === 'auto') {
      const cycle = (this.time % 2.4) / 2.4;
      const u = clamp((cycle - 0.15) / 0.55, 0, 1);
      const e = u * u * (3 - 2 * u);
      const endX = ARENA.right - 40;
      const endY = ARENA.centerY + 200;
      // Curved path: bow inward so the gesture reads as "carry across".
      const x = anchor.x + (endX - anchor.x) * e - Math.sin(e * Math.PI) * 60;
      const y = anchor.y + (endY - anchor.y) * e - Math.sin(e * Math.PI) * 120;
      this.hand.setPosition(x, y + 6);
      this.hand.setAlpha(cycle > 0.85 ? 1 - (cycle - 0.85) / 0.15 : 1);
      this.hand.setScale(cycle < 0.12 || cycle > 0.72 ? 1 : 0.9);
      return;
    }
    const sweep = Math.sin(this.time * 2.4) * 150;
    const x = clamp(anchor.x + sweep, ARENA.left + 120, ARENA.right - 120);
    this.hand.setPosition(x, anchor.y + 6);
    this.hand.setScale(0.95 + Math.abs(Math.cos(this.time * 2.4)) * 0.05);
  }

  private drawHitRing(dt: number): void {
    const g = this.hitRing;
    g.clear();
    if (this.hitRingT >= 1) return;
    this.hitRingT = Math.min(1, this.hitRingT + dt / 1.2);
    const t = this.hitRingT;
    for (let i = 0; i < 2; i++) {
      const k = (t * 2 + i * 0.35) % 1;
      g.lineStyle(8 * (1 - k), COLORS.yellow, 1 - k);
      g.strokeCircle(this.hitX, this.hitY, 30 + k * 150);
    }
  }

  destroy(): void {
    bus.offContext(this);
  }
}
