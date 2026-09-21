import Phaser from 'phaser';
import { ARENA, BALLS, COLORS, CSS_COLORS, GAME_WIDTH, LAYOUT } from '../config';
import { ctx, saveNow } from '../context';
import { levelColor } from '../data/levels';
import { getMap } from '../data/maps';
import { mapMultiplier } from '../data/economy';
import { bus } from '../systems/EventBus';
import { TutorialManager, type TutorialTarget } from '../systems/TutorialManager';
import { Hud } from '../ui/Hud';
import { SpeedLines } from '../ui/SpeedLines';
import { CompletePanel, SettingsPanel } from '../ui/Panels';
import { UpgradeButton } from '../ui/UpgradeButton';
import { IconButton, textStyle } from '../ui/widgets';
import { formatMoney, formatMultiplier } from '../utils/formatNumber';
import { hexToCss, randRange } from '../utils/math';
import { TEX } from '../utils/textures';
import type { GameScene } from './GameScene';

const DEPTH_UI = {
  hud: 10,
  buttons: 10,
  speed: 20,
  card: 30,
  tutorial: 50,
  modal: 60,
  confetti: 70,
} as const;

const CONFETTI_COLORS = [COLORS.yellow, COLORS.green, COLORS.coral, 0x5db8ff, 0xa68bff, COLORS.textPrimary];

/**
 * Everything drawn above the arena: HUD, upgrade cards, map cards, confetti,
 * tutorial and modals. Talks to the GameScene through its public API.
 */
export class UIScene extends Phaser.Scene {
  private arena!: GameScene;
  private hud!: Hud;
  private addBallBtn!: UpgradeButton;
  private mergeBtn!: UpgradeButton;
  private addPaddleBtn!: UpgradeButton;
  private soundBtn!: IconButton;
  private settings!: SettingsPanel;
  private complete!: CompletePanel;
  private tutorial!: TutorialManager;
  private speedLines!: SpeedLines;
  private card!: Phaser.GameObjects.Container;
  private cardBg!: Phaser.GameObjects.Graphics;
  private cardLabel!: Phaser.GameObjects.Text;
  private cardTitle!: Phaser.GameObjects.Text;
  private cardSub!: Phaser.GameObjects.Text;
  private confettiRect!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confettiTri!: Phaser.GameObjects.Particles.ParticleEmitter;
  private confettiAngle = -90;
  private confettiSpread = 25;

  constructor() {
    super('UI');
  }

  create(): void {
    this.arena = this.scene.get('Game') as GameScene;
    this.hud = new Hud(this);
    this.createButtons();
    this.createIconButtons();
    this.createMapCard();
    this.createConfetti();
    this.speedLines = new SpeedLines(this, DEPTH_UI.speed);

    this.settings = new SettingsPanel(this, DEPTH_UI.modal, (on) => this.soundBtn.setOn(on));
    this.complete = new CompletePanel(this, DEPTH_UI.modal, () => this.arena.continueEndless());
    this.tutorial = new TutorialManager(this, this.arena, (t) => this.buttonRect(t), DEPTH_UI.tutorial);

    bus.on('spent', (amount) => this.hud.showSpend(amount), this);
    bus.on('attention-merge', () => this.mergeBtn.pulseAttention(), this);
    bus.on('speed-boost', () => this.speedLines.pulse(), this);
    bus.on('map-complete', this.onMapComplete, this);
    bus.on('map-entered', this.onMapEntered, this);
    bus.on('prototype-complete', this.onPrototypeComplete, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      bus.offContext(this);
      this.tutorial.destroy();
    });
  }

  // ------------------------------------------------------------ construction

  private createButtons(): void {
    const P = LAYOUT.panel;
    const w = (P.width - P.gap * 2) / 3;
    const h = P.height;
    const y = P.y + h / 2;
    const x = (i: number) => P.x + w / 2 + i * (w + P.gap);

    this.addBallBtn = new UpgradeButton(this, x(0), y, w, h, 'ADD BALL', COLORS.yellow, (g, active) => {
      g.fillStyle(COLORS.shadow, 0.35);
      g.fillCircle(-4, 6, 30);
      g.fillStyle(levelColor(1), 1);
      g.fillCircle(-6, 2, 30);
      g.fillStyle(0xffffff, 0.8);
      g.fillEllipse(-16, -10, 16, 10);
      g.fillStyle(active ? COLORS.yellow : COLORS.textSecondary, 1);
      g.fillCircle(24, -18, 18);
      g.fillStyle(COLORS.background, 1);
      g.fillRect(16, -20, 16, 4);
      g.fillRect(22, -26, 4, 16);
    }, () => this.onAddBall());

    this.mergeBtn = new UpgradeButton(this, x(1), y, w, h, 'MERGE BALLS', COLORS.green, (g, active) => {
      const c1 = levelColor(1);
      const c2 = levelColor(2);
      g.fillStyle(c1, 1);
      g.fillCircle(-46, -14, 15);
      g.fillCircle(-46, 18, 15);
      g.lineStyle(5, active ? COLORS.green : COLORS.textSecondary, 1);
      g.lineBetween(-20, 2, 4, 2);
      g.fillStyle(active ? COLORS.green : COLORS.textSecondary, 1);
      g.fillTriangle(4, -8, 16, 2, 4, 12);
      g.fillStyle(c2, 1);
      g.fillCircle(42, 2, 25);
      g.fillStyle(0xffffff, 0.6);
      g.fillEllipse(34, -8, 12, 7);
    }, () => this.onMerge());

    this.addPaddleBtn = new UpgradeButton(this, x(2), y, w, h, 'ADD PADDLE', COLORS.yellow, (g, active) => {
      g.fillStyle(COLORS.shadow, 0.35);
      g.fillRoundedRect(-44, 18, 80, 20, 10);
      g.fillStyle(COLORS.yellow, 1);
      g.fillRoundedRect(-46, 12, 80, 20, 10);
      g.fillStyle(0xffffff, 0.45);
      g.fillRoundedRect(-38, 15, 64, 5, 2);
      g.fillStyle(levelColor(1), 1);
      g.fillCircle(-6, -16, 12);
      g.fillStyle(active ? COLORS.yellow : COLORS.textSecondary, 1);
      g.fillCircle(36, -20, 17);
      g.fillStyle(COLORS.background, 1);
      g.fillRect(28, -22, 16, 4);
      g.fillRect(34, -28, 4, 16);
    }, () => this.onAddPaddle());

    for (const b of [this.addBallBtn, this.mergeBtn, this.addPaddleBtn]) b.setDepth(DEPTH_UI.buttons);
    this.refreshButtons();
  }

  private createIconButtons(): void {
    const H = LAYOUT.hud;
    const r = H.iconButtonRadius;
    const settingsX = H.right - r;
    const soundX = settingsX - 140;
    this.soundBtn = new IconButton(this, soundX, H.iconButtonY, r, H.iconButtonHit, 'sound', () => this.toggleSound());
    this.soundBtn.setOn(ctx().state.settings.sound);
    new IconButton(this, settingsX, H.iconButtonY, r, H.iconButtonHit, 'settings', () => {
      ctx().audio.uiClick();
      this.settings.open();
    });
  }

  private createMapCard(): void {
    this.cardBg = this.add.graphics();
    this.cardLabel = this.add.text(0, -78, '', textStyle(30, CSS_COLORS.textSecondary, '800', { letterSpacing: 6 })).setOrigin(0.5);
    this.cardTitle = this.add.text(0, -8, '', textStyle(76, CSS_COLORS.textPrimary, '800', { letterSpacing: 1 })).setOrigin(0.5);
    this.cardSub = this.add.text(0, 76, '', textStyle(34, CSS_COLORS.yellow, '800', { letterSpacing: 2 })).setOrigin(0.5);
    this.card = this.add
      .container(GAME_WIDTH / 2, ARENA.centerY - 60, [this.cardBg, this.cardLabel, this.cardTitle, this.cardSub])
      .setDepth(DEPTH_UI.card)
      .setVisible(false);
  }

  private createConfetti(): void {
    const config = (): Phaser.Types.GameObjects.Particles.ParticleEmitterConfig => ({
      emitting: false,
      lifespan: { min: 1500, max: 2600 },
      speed: { min: 650, max: 1450 },
      angle: { onEmit: () => this.confettiAngle + randRange(-this.confettiSpread, this.confettiSpread) },
      gravityY: 1500,
      rotate: { onEmit: () => randRange(0, 360), onUpdate: (_p, _k, _t, value) => value + 7 },
      scale: { min: 0.9, max: 1.6 },
      alpha: { start: 1, end: 0, ease: 'Quad.easeIn' },
      tint: { onEmit: () => CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] },
      maxParticles: 220,
    });
    this.confettiRect = this.add.particles(0, 0, TEX.confetti, config()).setDepth(DEPTH_UI.confetti);
    this.confettiTri = this.add.particles(0, 0, TEX.confettiTri, config()).setDepth(DEPTH_UI.confetti);
  }

  buttonRect(target: TutorialTarget): Phaser.Geom.Rectangle {
    const b = target === 'addBall' ? this.addBallBtn : target === 'merge' ? this.mergeBtn : this.addPaddleBtn;
    return new Phaser.Geom.Rectangle(b.x - b.cardW / 2, b.y - b.cardH / 2, b.cardW, b.cardH);
  }

  // ------------------------------------------------------------ actions

  private onAddBall(): void {
    const c = ctx();
    const result = this.arena.tryAddBall();
    if (result === 'poor' || result === 'full') {
      c.audio.error();
      this.addBallBtn.shake();
    }
  }

  private onMerge(): void {
    const c = ctx();
    const result = this.arena.tryMerge();
    if (result === 'nomatch') {
      c.audio.error();
      this.mergeBtn.shake();
    }
  }

  private onAddPaddle(): void {
    const c = ctx();
    const result = this.arena.tryAddPaddle();
    if (result === 'poor' || result === 'max') {
      c.audio.error();
      this.addPaddleBtn.shake();
    }
  }

  private toggleSound(): void {
    const c = ctx();
    const on = !c.state.settings.sound;
    c.state.settings.sound = on;
    c.audio.setMuted(!on);
    this.soundBtn.setOn(on);
    c.audio.uiClick();
    saveNow();
    bus.emit('settings-changed');
  }

  private refreshButtons(): void {
    const c = ctx();
    const e = c.economy;

    if (this.arena.balls.length >= BALLS.maxActive) {
      this.addBallBtn.setInfo('FULL —\nMERGE BALLS', 'disabled');
    } else {
      const cost = e.ballCost;
      this.addBallBtn.setInfo(formatMoney(cost), e.canAfford(cost) ? 'ready' : 'poor');
    }

    const level = this.arena.lowestMergeLevel();
    if (level === null) {
      this.mergeBtn.setInfo('NO MATCH', 'disabled');
    } else {
      const pairs = this.arena.mergePairCount();
      const arrow = `LV.${level} → LV.${level + 1}`;
      this.mergeBtn.setInfo(pairs > 1 ? `${pairs} PAIRS\n${arrow}` : `2× ${arrow}`, 'ready');
    }

    const paddleCost = e.paddleCost;
    if (paddleCost === null) this.addPaddleBtn.setInfo('MAX', 'disabled');
    else this.addPaddleBtn.setInfo(formatMoney(paddleCost), e.canAfford(paddleCost) ? 'ready' : 'poor');
  }

  // ------------------------------------------------------------ map flow

  private onMapComplete(mapIndex: number, final: boolean, tier: number): void {
    this.hud.burstProgress();
    this.burstConfetti();
    const def = getMap(mapIndex);
    if (tier > 0) {
      this.showCard('ENDLESS', `TIER ${tier} CLEARED`, `NEXT: TIER ${tier + 1}`, COLORS.green, 1500);
    } else if (final) {
      this.showCard(`MAP ${def.id}`, 'ARENA CLEARED', 'ALL MAPS COMPLETE', COLORS.green, 1400);
    } else {
      const next = getMap(mapIndex + 1);
      this.showCard(`MAP ${def.id}`, 'ARENA CLEARED', `NEXT: ${next.name.toUpperCase()}`, COLORS.green, 1500);
    }
  }

  private onMapEntered(mapIndex: number, tier: number): void {
    this.hud.refreshMap();
    this.hud.resetProgressDisplay();
    const def = getMap(mapIndex);
    const mult = mapMultiplier(mapIndex, tier);
    const label = tier > 0 ? `MAP ${def.id}  ·  ENDLESS ${tier}` : `MAP ${def.id}`;
    this.time.delayedCall(tier > 0 ? 0 : 120, () => this.showCard(label, def.name.toUpperCase(), `${formatMultiplier(mult)} EARNINGS`, def.palette.accent, 1300));
  }

  private onPrototypeComplete(): void {
    this.complete.open();
    this.time.delayedCall(250, () => this.burstConfetti());
  }

  /** Centered name card that pops in, holds and floats away. */
  private showCard(label: string, title: string, sub: string, accent: number, holdMs: number): void {
    this.tweens.killTweensOf(this.card);
    this.cardLabel.setText(label);
    this.cardTitle.setText(title);
    this.cardSub.setText(sub).setColor(hexToCss(accent));
    const w = Math.max(700, this.cardTitle.width + 120);
    const h = 270;
    const g = this.cardBg;
    g.clear();
    g.fillStyle(COLORS.shadow, 0.5);
    g.fillRoundedRect(-w / 2, -h / 2 + 16, w, h, 40);
    g.fillStyle(0x1b2230, 0.97);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, 40);
    g.fillStyle(accent, 1);
    g.fillRoundedRect(-80, -h / 2 + 18, 160, 8, 4);
    g.lineStyle(2, 0xffffff, 0.07);
    g.strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 39);
    this.card.setVisible(true).setAlpha(0).setScale(0.8).setY(ARENA.centerY - 60);
    this.tweens.add({ targets: this.card, alpha: 1, scale: 1, duration: 380, ease: 'Back.easeOut' });
    this.tweens.add({
      targets: this.card,
      alpha: 0,
      y: ARENA.centerY - 110,
      delay: 380 + holdMs,
      duration: 320,
      ease: 'Cubic.easeIn',
      onComplete: () => this.card.setVisible(false),
    });
  }

  private burstConfetti(): void {
    const shots: Array<[number, number, number, number]> = [
      [ARENA.left + 30, ARENA.bottom - 60, -62, 18],
      [ARENA.right - 30, ARENA.bottom - 60, -118, 18],
      [GAME_WIDTH / 2, ARENA.top - 20, 90, 55],
    ];
    for (const [x, y, angle, spread] of shots) {
      this.confettiAngle = angle;
      this.confettiSpread = spread;
      this.confettiRect.explode(26, x, y);
      this.confettiTri.explode(16, x, y);
    }
    const tip = this.hud.progressTip();
    this.confettiAngle = -90;
    this.confettiSpread = 70;
    this.confettiRect.explode(14, tip.x, tip.y);
  }

  override update(_time: number, delta: number): void {
    const dt = Math.min(delta, 100) / 1000;
    this.hud.update(dt);
    this.speedLines.update(dt, this.arena.speedBoost);
    this.refreshButtons();
    this.tutorial.update(dt);
  }
}
