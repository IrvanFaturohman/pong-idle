import Phaser from 'phaser';
import { COLORS, CSS_COLORS, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { ctx, saveNow } from '../context';
import { formatDuration, formatMoney, formatNumber } from '../utils/formatNumber';
import { makePressable, PillButton, textStyle, Toggle } from './widgets';

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

/**
 * Base modal: dimmed backdrop that swallows input, a centered card and
 * open / close animations. While open, paddle input and upgrades are blocked.
 */
class Modal {
  readonly root: Phaser.GameObjects.Container;
  protected readonly card: Phaser.GameObjects.Container;
  private readonly backdrop: Phaser.GameObjects.Rectangle;
  isOpen = false;

  constructor(
    protected readonly scene: Phaser.Scene,
    protected readonly w: number,
    protected readonly h: number,
    depth: number,
  ) {
    this.backdrop = scene.add.rectangle(CX, CY, GAME_WIDTH + 40, GAME_HEIGHT + 40, 0x05070b, 0.72).setInteractive();
    const bg = scene.add.graphics();
    bg.fillStyle(COLORS.shadow, 0.55);
    bg.fillRoundedRect(-w / 2, -h / 2 + 18, w, h, 44);
    bg.fillStyle(0x1b2230, 1);
    bg.fillRoundedRect(-w / 2, -h / 2, w, h, 44);
    bg.lineStyle(2, 0xffffff, 0.07);
    bg.strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 43);
    this.card = scene.add.container(CX, CY, [bg]);
    this.root = scene.add.container(0, 0, [this.backdrop, this.card]).setDepth(depth).setVisible(false);
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    ctx().modalOpen = true;
    this.root.setVisible(true);
    this.backdrop.setAlpha(0);
    this.card.setScale(0.86).setAlpha(0);
    this.scene.tweens.add({ targets: this.backdrop, alpha: 1, duration: 200 });
    this.scene.tweens.add({ targets: this.card, scale: 1, alpha: 1, duration: 320, ease: 'Back.easeOut' });
  }

  close(onClosed?: () => void): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    ctx().modalOpen = false;
    this.scene.tweens.add({ targets: this.backdrop, alpha: 0, duration: 180 });
    this.scene.tweens.add({
      targets: this.card,
      scale: 0.9,
      alpha: 0,
      duration: 180,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.root.setVisible(false);
        onClosed?.();
      },
    });
  }
}

export class SettingsPanel extends Modal {
  private readonly main: Phaser.GameObjects.Container;
  private readonly confirm: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, depth: number, onSoundChanged: (on: boolean) => void) {
    super(scene, 820, 940, depth);
    const c = ctx();
    const half = this.h / 2;

    const title = scene.add.text(0, -half + 92, 'SETTINGS', textStyle(52, CSS_COLORS.textPrimary, '800', { letterSpacing: 4 })).setOrigin(0.5);
    const closeX = new IconCloseButton(scene, this.w / 2 - 80, -half + 92, () => this.close());

    this.main = scene.add.container(0, 0);
    const rowY = [-half + 250, -half + 400];
    const rowBg = scene.add.graphics();
    for (const y of rowY) {
      rowBg.fillStyle(0x242c39, 1);
      rowBg.fillRoundedRect(-this.w / 2 + 50, y - 62, this.w - 100, 124, 30);
    }
    const soundLabel = scene.add.text(-this.w / 2 + 90, rowY[0], 'Sound', textStyle(40, CSS_COLORS.textPrimary, '700')).setOrigin(0, 0.5);
    const soundToggle = new Toggle(scene, this.w / 2 - 150, rowY[0], c.state.settings.sound, (on) => {
      c.state.settings.sound = on;
      c.audio.setMuted(!on);
      onSoundChanged(on);
      saveNow();
    });
    const hapticLabel = scene.add.text(-this.w / 2 + 90, rowY[1] - (c.haptics.supported ? 0 : 14), 'Haptics', textStyle(40, CSS_COLORS.textPrimary, '700')).setOrigin(0, 0.5);
    const hapticNote = scene.add
      .text(-this.w / 2 + 90, rowY[1] + 26, 'Not supported on this device', textStyle(22, CSS_COLORS.textSecondary, '600'))
      .setOrigin(0, 0.5)
      .setVisible(!c.haptics.supported);
    const hapticToggle = new Toggle(scene, this.w / 2 - 150, rowY[1], c.state.settings.haptics, (on) => {
      c.state.settings.haptics = on;
      c.haptics.enabled = on;
      if (on) c.haptics.pulse(15, 0);
      saveNow();
    });

    const reset = new PillButton(scene, 0, -half + 560, 560, 100, 'RESET PROGRESS', COLORS.coral, CSS_COLORS.coral, () => this.showConfirm(true), true);
    // Back to the version picker (progress is saved on page hide).
    const menu = new PillButton(scene, 0, -half + 690, 560, 100, 'MAIN MENU', COLORS.textSecondary, CSS_COLORS.textPrimary, () => {
      window.location.href = '../';
    }, true);
    const done = new PillButton(scene, 0, half - 100, 560, 112, 'CLOSE', COLORS.yellow, CSS_COLORS.ink, () => this.close());
    this.main.add([rowBg, soundLabel, soundToggle, hapticLabel, hapticNote, hapticToggle, reset, menu, done]);

    // Confirmation step for the destructive reset.
    this.confirm = scene.add.container(0, 0).setVisible(false);
    const q = scene.add.text(0, -120, 'Reset all progress?', textStyle(48, CSS_COLORS.textPrimary, '800')).setOrigin(0.5);
    const warn = scene.add
      .text(0, -40, 'Coins, balls, paddles, maps and stats\nwill be erased. This cannot be undone.', textStyle(30, CSS_COLORS.textSecondary, '600', { align: 'center', lineSpacing: 8 }))
      .setOrigin(0.5);
    const cancel = new PillButton(scene, 0, 120, 560, 112, 'CANCEL', COLORS.buttonSurface, CSS_COLORS.textPrimary, () => this.showConfirm(false));
    const doReset = new PillButton(scene, 0, 260, 560, 112, 'RESET', COLORS.coral, CSS_COLORS.ink, () => this.performReset());
    this.confirm.add([q, warn, cancel, doReset]);

    this.card.add([title, closeX, this.main, this.confirm]);
  }

  override open(): void {
    this.showConfirm(false);
    super.open();
  }

  /** Swap between settings and the reset confirmation (hidden containers receive no input). */
  private showConfirm(show: boolean): void {
    this.main.setVisible(!show);
    this.confirm.setVisible(show);
  }

  private performReset(): void {
    ctx().saves.reset();
    this.scene.cameras.main.fadeOut(260, 15, 19, 28);
    this.scene.scene.get('Game').cameras.main.fadeOut(260, 15, 19, 28);
    this.scene.time.delayedCall(300, () => window.location.reload());
  }
}

/** Small "×" close button used on panels. */
class IconCloseButton extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, x: number, y: number, onPress: () => void) {
    super(scene, x, y);
    const g = scene.add.graphics();
    g.fillStyle(0x242c39, 1);
    g.fillCircle(0, 0, 42);
    g.lineStyle(7, COLORS.textPrimary, 1);
    g.lineBetween(-14, -14, 14, 14);
    g.lineBetween(14, -14, -14, 14);
    this.add(g);
    makePressable(scene, this, 136, 136, () => {
      ctx().audio.uiClick();
      onPress();
    }, 0.9);
    scene.add.existing(this);
  }
}

export class CompletePanel extends Modal {
  private readonly values: Phaser.GameObjects.Text[] = [];

  constructor(scene: Phaser.Scene, depth: number, onContinue: () => void) {
    super(scene, 880, 1180, depth);
    const half = this.h / 2;
    const trophy = scene.add.graphics();
    // Simple geometric trophy: cup, handles, stem and base.
    trophy.fillStyle(0xd99a1a, 1);
    trophy.fillRoundedRect(-70, -40, 140, 90, { tl: 10, tr: 10, bl: 44, br: 44 });
    trophy.fillStyle(COLORS.yellow, 1);
    trophy.fillRoundedRect(-66, -46, 132, 86, { tl: 10, tr: 10, bl: 42, br: 42 });
    trophy.lineStyle(12, COLORS.yellow, 1);
    trophy.strokeCircle(-72, -6, 26);
    trophy.strokeCircle(72, -6, 26);
    trophy.fillStyle(0xd99a1a, 1);
    trophy.fillRect(-12, 40, 24, 36);
    trophy.fillStyle(COLORS.yellow, 1);
    trophy.fillRoundedRect(-56, 72, 112, 26, 10);
    trophy.fillStyle(0xffffff, 0.4);
    trophy.fillRoundedRect(-48, -38, 28, 50, 12);
    trophy.setPosition(0, -half + 150);

    const title = scene.add.text(0, -half + 300, 'PROTOTYPE COMPLETE', textStyle(58, CSS_COLORS.yellow, '800', { letterSpacing: 2 })).setOrigin(0.5);
    const subtitle = scene.add.text(0, -half + 370, 'All three arenas cleared!', textStyle(32, CSS_COLORS.textSecondary, '600')).setOrigin(0.5);
    this.card.add([trophy, title, subtitle]);

    const labels = ['Total play time', 'Total money earned', 'Highest ball level', 'Total paddle hits', 'Total merges'];
    const statsBg = scene.add.graphics();
    statsBg.fillStyle(0x242c39, 1);
    statsBg.fillRoundedRect(-this.w / 2 + 50, -half + 430, this.w - 100, labels.length * 92 + 28, 30);
    this.card.add(statsBg);
    labels.forEach((label, i) => {
      const y = -half + 490 + i * 92;
      const l = scene.add.text(-this.w / 2 + 90, y, label, textStyle(34, CSS_COLORS.textSecondary, '600')).setOrigin(0, 0.5);
      const v = scene.add.text(this.w / 2 - 90, y, '', textStyle(38, CSS_COLORS.textPrimary, '800')).setOrigin(1, 0.5);
      this.values.push(v);
      this.card.add([l, v]);
      if (i < labels.length - 1) {
        const line = scene.add.rectangle(0, y + 46, this.w - 180, 2, 0xffffff, 0.05);
        this.card.add(line);
      }
    });

    const cont = new PillButton(scene, 0, half - 120, 640, 124, 'CONTINUE ENDLESS', COLORS.green, CSS_COLORS.ink, () => {
      this.close(onContinue);
    });
    this.card.add(cont);
  }

  override open(): void {
    const s = ctx().state;
    const values = [
      formatDuration(s.stats.playTimeMs),
      formatMoney(s.stats.totalEarned),
      `LV.${s.stats.highestLevel}`,
      formatNumber(s.stats.paddleHits),
      formatNumber(s.stats.merges),
    ];
    values.forEach((v, i) => this.values[i].setText(v));
    super.open();
  }
}
