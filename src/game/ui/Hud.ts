import Phaser from 'phaser';
import { COLORS, CSS_COLORS, JUICE, LAYOUT } from '../config';
import { ctx } from '../context';
import { getMap } from '../data/maps';
import { formatMoney, formatMultiplier, formatRate } from '../utils/formatNumber';
import { damp, hexToCss } from '../utils/math';
import { textStyle } from './widgets';

const H = LAYOUT.hud;

/**
 * Top HUD: map name + multiplier, animated wallet, rolling income and the map
 * progress bar. Text objects are only re-rendered when their string changes.
 */
export class Hud {
  private readonly mapLabel: Phaser.GameObjects.Text;
  private readonly mapName: Phaser.GameObjects.Text;
  private readonly multPill: Phaser.GameObjects.Container;
  private readonly multBg: Phaser.GameObjects.Graphics;
  private readonly multText: Phaser.GameObjects.Text;
  private readonly wallet: Phaser.GameObjects.Text;
  private readonly coin: Phaser.GameObjects.Container;
  private readonly income: Phaser.GameObjects.Text;
  private readonly goalLabel: Phaser.GameObjects.Text;
  private readonly goalValue: Phaser.GameObjects.Text;
  private readonly bar: Phaser.GameObjects.Graphics;
  private readonly barFlash: Phaser.GameObjects.Graphics;
  private readonly spendTexts: Phaser.GameObjects.Text[] = [];

  private shownWallet = 0;
  private shownProgress = 0;
  private shownIncome = 0;
  private incomeTimer = 0;
  private shimmer = 0;
  private walletPop = 0;
  private lastWalletText = '';
  private lastGoalText = '';
  private lastIncomeText = '';
  private accent: number = COLORS.yellow;

  constructor(private readonly scene: Phaser.Scene) {
    const s = scene;
    this.mapLabel = s.add.text(H.left, H.mapLabelY, '', textStyle(26, CSS_COLORS.textSecondary, '800', { letterSpacing: 4 })).setOrigin(0, 0.5);
    this.mapName = s.add.text(H.left, H.mapNameY, '', textStyle(44, CSS_COLORS.textPrimary, '800', { letterSpacing: 1 })).setOrigin(0, 0.5);
    this.multBg = s.add.graphics();
    this.multText = s.add.text(0, 1, '', textStyle(28, CSS_COLORS.yellow, '800')).setOrigin(0.5);
    this.multPill = s.add.container(0, H.mapNameY, [this.multBg, this.multText]);

    const coinG = s.add.graphics();
    coinG.fillStyle(0xd99a1a, 1);
    coinG.fillCircle(0, 3, 26);
    coinG.fillStyle(COLORS.yellow, 1);
    coinG.fillCircle(0, 0, 26);
    coinG.lineStyle(4, 0xe0a526, 1);
    coinG.strokeCircle(0, 0, 16);
    coinG.fillStyle(0xffffff, 0.45);
    coinG.fillEllipse(-9, -11, 12, 7);
    this.coin = s.add.container(H.left + 26, H.walletY, [coinG]);
    this.wallet = s.add.text(H.left + 68, H.walletY + 2, '$0', textStyle(80, CSS_COLORS.textPrimary, '800')).setOrigin(0, 0.5);

    s.add.text(H.right, H.walletY - 30, 'INCOME', textStyle(22, CSS_COLORS.textSecondary, '800', { letterSpacing: 3 })).setOrigin(1, 0.5);
    this.income = s.add.text(H.right, H.walletY + 10, '$0/s', textStyle(40, CSS_COLORS.green, '800')).setOrigin(1, 0.5);

    this.goalLabel = s.add.text(H.left, H.progressLabelY, '', textStyle(24, CSS_COLORS.textSecondary, '800', { letterSpacing: 3 })).setOrigin(0, 0.5);
    this.goalValue = s.add.text(H.right, H.progressLabelY, '', textStyle(26, CSS_COLORS.textPrimary, '700')).setOrigin(1, 0.5);
    this.bar = s.add.graphics();
    this.barFlash = s.add.graphics().setAlpha(0);

    for (let i = 0; i < 3; i++) {
      this.spendTexts.push(s.add.text(0, 0, '', textStyle(40, CSS_COLORS.coral, '800')).setOrigin(0, 0.5).setVisible(false));
    }

    const st = ctx().state;
    this.shownWallet = st.wallet;
    this.shownProgress = ctx().economy.progress;
    this.refreshMap();
  }

  /** Update map title, multiplier pill and goal label for the current map / endless tier. */
  refreshMap(): void {
    const st = ctx().state;
    const def = getMap(st.mapIndex);
    const tier = st.endless.tier;
    this.accent = def.palette.accent;
    this.mapLabel.setText(tier > 0 ? `MAP ${def.id}  ·  ENDLESS ${tier}` : `MAP ${def.id}`);
    this.mapName.setText(def.name.toUpperCase());
    const mult = ctx().economy.multiplier;
    this.multText.setText(formatMultiplier(mult)).setColor(hexToCss(this.accent));
    const pw = this.multText.width + 34;
    this.multBg.clear();
    this.multBg.fillStyle(this.accent, 0.16);
    this.multBg.fillRoundedRect(-pw / 2, -24, pw, 48, 24);
    this.multPill.setPosition(H.left + this.mapName.width + 22 + pw / 2, H.mapNameY);
    this.goalLabel.setText(tier > 0 ? `ENDLESS TIER ${tier} GOAL` : 'MAP GOAL');
    this.lastGoalText = '';
  }

  /** Coral "-$X" that drops from the wallet after a purchase. */
  showSpend(amount: number): void {
    const t = this.spendTexts.find((x) => !x.visible) ?? this.spendTexts[0];
    this.scene.tweens.killTweensOf(t);
    t.setText('-' + formatMoney(amount))
      .setPosition(this.wallet.x + this.wallet.width + 18, H.walletY - 6)
      .setAlpha(1)
      .setVisible(true);
    this.scene.tweens.add({
      targets: t,
      y: H.walletY + 34,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.easeOut',
      onComplete: () => t.setVisible(false),
    });
  }

  /** White flash on the progress bar when a map is cleared. */
  burstProgress(): void {
    this.barFlash.clear();
    this.barFlash.fillStyle(0xffffff, 1);
    this.barFlash.fillRoundedRect(H.left, H.progressBarY, H.right - H.left, H.progressBarHeight, H.progressBarHeight / 2);
    this.barFlash.setAlpha(0.9);
    this.scene.tweens.add({ targets: this.barFlash, alpha: 0, duration: 700, ease: 'Cubic.easeOut' });
  }

  /** Right end of the filled bar (particle origin for the burst). */
  progressTip(): { x: number; y: number } {
    return { x: H.left + (H.right - H.left) * this.shownProgress, y: H.progressBarY + H.progressBarHeight / 2 };
  }

  resetProgressDisplay(): void {
    this.shownProgress = ctx().economy.progress;
  }

  update(dt: number): void {
    const c = ctx();
    const st = c.state;

    // Wallet counts toward the real value instead of jumping.
    const prev = this.shownWallet;
    this.shownWallet += (st.wallet - this.shownWallet) * damp(JUICE.walletLerp, dt);
    if (Math.abs(st.wallet - this.shownWallet) < 0.5) this.shownWallet = st.wallet;
    if (Math.floor(this.shownWallet) > Math.floor(prev)) this.walletPop = Math.min(1, this.walletPop + 0.25);
    const wText = formatMoney(Math.floor(this.shownWallet));
    if (wText !== this.lastWalletText) {
      this.lastWalletText = wText;
      this.wallet.setText(wText);
    }
    this.walletPop = Math.max(0, this.walletPop - dt * 4);
    this.wallet.setScale(1 + this.walletPop * 0.06);
    this.coin.setScale(1 + this.walletPop * 0.12);

    // Income: sample the rolling average a few times a second and ease the display.
    this.incomeTimer -= dt;
    if (this.incomeTimer <= 0) {
      this.incomeTimer = 0.25;
      this.shownIncome += (c.economy.incomePerSecond() - this.shownIncome) * 0.5;
      const iText = '+' + formatRate(this.shownIncome);
      if (iText !== this.lastIncomeText) {
        this.lastIncomeText = iText;
        this.income.setText(iText);
      }
    }

    const target = c.economy.target;
    const gText = `${formatMoney(Math.min(st.mapEarnings, target))} / ${formatMoney(target)}`;
    if (gText !== this.lastGoalText) {
      this.lastGoalText = gText;
      this.goalValue.setText(gText);
    }

    const progress = c.economy.progress;
    this.shownProgress += (progress - this.shownProgress) * damp(progress < this.shownProgress ? 14 : 6, dt);
    this.shimmer = (this.shimmer + dt * 0.55) % 1.4;
    this.drawBar();
  }

  private drawBar(): void {
    const g = this.bar;
    const x = H.left;
    const y = H.progressBarY;
    const w = H.right - H.left;
    const h = H.progressBarHeight;
    g.clear();
    g.fillStyle(COLORS.buttonSurface, 1);
    g.fillRoundedRect(x, y, w, h, h / 2);
    const p = Math.max(0, Math.min(1, this.shownProgress));
    if (p > 0.001) {
      const fw = Math.max(h, w * p);
      const done = p >= 0.999;
      g.fillStyle(done ? COLORS.green : this.accent, 1);
      g.fillRoundedRect(x, y, fw, h, h / 2);
      g.fillStyle(0xffffff, 0.22);
      g.fillRoundedRect(x + 6, y + 4, fw - 12, h * 0.3, h * 0.15);
      // Moving shimmer inside the filled part.
      const sx = x + (this.shimmer - 0.2) * w;
      const sw = 70;
      const left = Math.max(x + h / 2, sx);
      const right = Math.min(x + fw - h / 2, sx + sw);
      if (right > left) {
        g.fillStyle(0xffffff, 0.18);
        g.fillRect(left, y + 3, right - left, h - 6);
      }
    }
  }
}
