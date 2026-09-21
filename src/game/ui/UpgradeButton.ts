import Phaser from 'phaser';
import { COLORS, CSS_COLORS } from '../config';
import { hexToCss } from '../utils/math';
import { makePressable, textStyle } from './widgets';

/** ready = can be used now, poor = shows price but unaffordable, disabled = unavailable (MAX / FULL / NO MATCH). */
export type UpgradeState = 'ready' | 'poor' | 'disabled';

export type IconDrawer = (g: Phaser.GameObjects.Graphics, active: boolean) => void;

/**
 * One of the three large bottom-panel cards. Shows an icon, a title and a
 * price / requirement line, and animates press, affordability and attention.
 */
export class UpgradeButton extends Phaser.GameObjects.Container {
  private readonly shadow: Phaser.GameObjects.Graphics;
  private readonly surface: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Graphics;
  private readonly icon: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly sub: Phaser.GameObjects.Text;
  private current: UpgradeState | null = null;
  private subText = '';
  private shakeTween: Phaser.Tweens.Tween | null = null;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    readonly cardW: number,
    readonly cardH: number,
    titleText: string,
    private readonly accent: number,
    private readonly drawIcon: IconDrawer,
    onPress: () => void,
  ) {
    super(scene, x, y);
    const w = cardW;
    const h = cardH;
    this.shadow = scene.add.graphics();
    this.surface = scene.add.graphics();
    this.icon = scene.add.graphics().setPosition(0, -h / 2 + 72);
    this.title = scene.add.text(0, 14, titleText, textStyle(34, CSS_COLORS.textPrimary, '800', { letterSpacing: 2 })).setOrigin(0.5);
    this.sub = scene.add.text(0, h / 2 - 62, '', textStyle(40, CSS_COLORS.yellow, '800', { align: 'center' })).setOrigin(0.5);
    this.glow = scene.add.graphics().setAlpha(0);
    this.glow.fillStyle(accent, 1);
    this.glow.fillRoundedRect(-w / 2, -h / 2, w, h, 34);
    this.add([this.shadow, this.surface, this.icon, this.title, this.sub, this.glow]);

    this.shadow.fillStyle(COLORS.shadow, 0.5);
    this.shadow.fillRoundedRect(-w / 2, -h / 2 + 12, w, h, 34);

    makePressable(scene, this, w, h, onPress, 0.93);
    scene.add.existing(this);
  }

  /** Update the card; redraws only when something actually changed. */
  setInfo(sub: string, state: UpgradeState): void {
    const stateChanged = state !== this.current;
    if (stateChanged) {
      const becameReady = state === 'ready' && this.current === 'poor';
      this.current = state;
      this.redraw();
      if (becameReady) this.flashAffordable();
    }
    if (sub !== this.subText || stateChanged) {
      this.subText = sub;
      const color = state === 'ready' ? hexToCss(this.accent) : state === 'poor' ? CSS_COLORS.textSecondary : CSS_COLORS.textDisabled;
      this.sub.setColor(color);
      this.fitSub(sub);
    }
  }

  /** Shrink the requirement text until it fits the card (handles "FULL —\nMERGE BALLS"). */
  private fitSub(text: string): void {
    const maxW = this.cardW - 36;
    const lines = text.split('\n').length;
    let size = lines > 1 ? 30 : 40;
    this.sub.setText(text).setFontSize(size).setLineSpacing(-4);
    while (this.sub.width > maxW && size > 22) {
      size -= 2;
      this.sub.setFontSize(size);
    }
    this.sub.setY(this.cardH / 2 - (lines > 1 ? 70 : 62));
  }

  private redraw(): void {
    const w = this.cardW;
    const h = this.cardH;
    const s = this.surface;
    const state = this.current ?? 'poor';
    s.clear();
    s.fillStyle(state === 'disabled' ? COLORS.buttonDisabled : COLORS.buttonSurface, 1);
    s.fillRoundedRect(-w / 2, -h / 2, w, h, 34);
    // Thin top highlight.
    s.fillStyle(0xffffff, state === 'disabled' ? 0.03 : 0.07);
    s.fillRoundedRect(-w / 2 + 30, -h / 2 + 6, w - 60, 4, 2);
    if (state === 'ready') {
      s.lineStyle(4, this.accent, 0.95);
      s.strokeRoundedRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 32);
    } else {
      s.lineStyle(2, 0xffffff, 0.05);
      s.strokeRoundedRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 33);
    }
    this.title.setColor(state === 'disabled' ? CSS_COLORS.textDisabled : CSS_COLORS.textPrimary);
    this.icon.clear();
    this.drawIcon(this.icon, state !== 'disabled');
    this.icon.setAlpha(state === 'disabled' ? 0.45 : state === 'poor' ? 0.8 : 1);
  }

  /** Golden flash + bounce when the upgrade first becomes affordable. */
  flashAffordable(): void {
    this.glow.setAlpha(0.42);
    this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 650, ease: 'Cubic.easeOut' });
    this.scene.tweens.add({ targets: this, scale: { from: 1.07, to: 1 }, duration: 420, ease: 'Back.easeOut' });
  }

  /** Double pulse to draw the eye (e.g. Merge when the arena is full). */
  pulseAttention(): void {
    this.glow.setAlpha(0.35);
    this.scene.tweens.add({ targets: this.glow, alpha: 0, duration: 900, ease: 'Sine.easeOut' });
    this.scene.tweens.add({ targets: this, scale: 1.08, duration: 150, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
  }

  /** Horizontal "no" shake for unaffordable / unavailable presses. */
  shake(): void {
    this.shakeTween?.stop();
    const baseX = this.getData('baseX') as number | undefined;
    const x0 = baseX ?? this.x;
    this.setData('baseX', x0);
    this.x = x0;
    this.shakeTween = this.scene.tweens.add({
      targets: this,
      x: { from: x0 - 12, to: x0 },
      duration: 320,
      ease: 'Elastic.easeOut',
      easeParams: [1.2, 0.25],
    });
  }
}
