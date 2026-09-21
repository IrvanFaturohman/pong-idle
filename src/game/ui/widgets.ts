import Phaser from 'phaser';
import { COLORS, CSS_COLORS, FONT_FAMILY } from '../config';
import { ctx } from '../context';

export function textStyle(
  size: number,
  color: string = CSS_COLORS.textPrimary,
  weight: string = '700',
  extra: Phaser.Types.GameObjects.Text.TextStyle = {},
): Phaser.Types.GameObjects.Text.TextStyle {
  return { fontFamily: FONT_FAMILY, fontSize: `${size}px`, fontStyle: weight, color, ...extra };
}

/**
 * Wire press / release behaviour onto a container: compress on press, spring
 * back on release, and only fire when the press both started and ended on it –
 * so a finger dragging a paddle and lifting over a button never triggers it.
 */
export function makePressable(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.Container,
  width: number,
  height: number,
  onPress: () => void,
  pressScale = 0.94,
): void {
  target.setSize(width, height);
  target.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(0, 0, width, height),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  let pressed = false;
  let tween: Phaser.Tweens.Tween | null = null;
  const to = (scale: number, duration: number, ease: string) => {
    tween?.stop();
    tween = scene.tweens.add({ targets: target, scale, duration, ease });
  };
  target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
    pressed = true;
    to(pressScale, 70, 'Quad.easeOut');
  });
  target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
    if (!pressed) return;
    pressed = false;
    to(1, 320, 'Back.easeOut');
    onPress();
  });
  target.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
    if (!pressed) return;
    pressed = false;
    to(1, 200, 'Quad.easeOut');
  });
}

/** Rounded text button used in panels and the tutorial. */
export class PillButton extends Phaser.GameObjects.Container {
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    fill: number,
    textColor: string,
    onPress: () => void,
    outline = false,
  ) {
    super(scene, x, y);
    const g = scene.add.graphics();
    g.fillStyle(COLORS.shadow, 0.45);
    g.fillRoundedRect(-width / 2, -height / 2 + 8, width, height, height / 2);
    if (outline) {
      g.fillStyle(COLORS.buttonSurface, 1);
      g.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      g.lineStyle(4, fill, 1);
      g.strokeRoundedRect(-width / 2 + 2, -height / 2 + 2, width - 4, height - 4, height / 2 - 2);
    } else {
      g.fillStyle(fill, 1);
      g.fillRoundedRect(-width / 2, -height / 2, width, height, height / 2);
      g.fillStyle(0xffffff, 0.14);
      g.fillRoundedRect(-width / 2 + 18, -height / 2 + 6, width - 36, height * 0.28, height * 0.14);
    }
    const label = scene.add.text(0, 1, text, textStyle(Math.round(height * 0.36), textColor, '800', { letterSpacing: 2 })).setOrigin(0.5);
    this.add([g, label]);
    // Hit area never smaller than ~44 CSS px on a 360 px wide phone.
    makePressable(scene, this, Math.max(width, 132), Math.max(height, 132), () => {
      ctx().audio.uiClick();
      onPress();
    });
    scene.add.existing(this);
  }
}

export type IconKind = 'settings' | 'sound';

/** Round HUD button with a primitive-drawn icon and a large invisible hit area. */
export class IconButton extends Phaser.GameObjects.Container {
  private readonly icon: Phaser.GameObjects.Graphics;
  private isOn = true;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    private readonly radius: number,
    hitSize: number,
    private readonly kind: IconKind,
    onPress: () => void,
  ) {
    super(scene, x, y);
    const bg = scene.add.graphics();
    bg.fillStyle(COLORS.shadow, 0.4);
    bg.fillCircle(0, 6, radius);
    bg.fillStyle(COLORS.buttonSurface, 1);
    bg.fillCircle(0, 0, radius);
    bg.lineStyle(2, 0xffffff, 0.06);
    bg.strokeCircle(0, 0, radius - 1);
    this.icon = scene.add.graphics();
    this.add([bg, this.icon]);
    this.drawIcon();
    makePressable(scene, this, hitSize, hitSize, onPress, 0.9);
    scene.add.existing(this);
  }

  /** For the sound icon: true = sound on. */
  setOn(on: boolean): void {
    this.isOn = on;
    this.drawIcon();
  }

  private drawIcon(): void {
    const g = this.icon;
    g.clear();
    const s = this.radius / 50;
    const color = COLORS.textPrimary;
    if (this.kind === 'settings') {
      // Gear: ring of teeth around a hub.
      const teeth = 8;
      const outer = 22 * s;
      const inner = 16 * s;
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < teeth * 2; i++) {
        const a0 = (i / (teeth * 2)) * Math.PI * 2;
        const a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
        const r = i % 2 === 0 ? outer : inner;
        pts.push(new Phaser.Math.Vector2(Math.cos(a0) * r, Math.sin(a0) * r));
        pts.push(new Phaser.Math.Vector2(Math.cos(a1) * r, Math.sin(a1) * r));
      }
      g.fillStyle(color, 1);
      g.fillPoints(pts, true);
      g.fillCircle(0, 0, 15 * s);
      g.fillStyle(COLORS.buttonSurface, 1);
      g.fillCircle(0, 0, 7 * s);
    } else {
      const alpha = this.isOn ? 1 : 0.55;
      g.fillStyle(color, alpha);
      g.fillRect(-20 * s, -8 * s, 11 * s, 16 * s);
      g.fillTriangle(-11 * s, -8 * s, 4 * s, -20 * s, 4 * s, 20 * s);
      g.fillTriangle(-11 * s, -8 * s, 4 * s, 20 * s, -11 * s, 8 * s);
      if (this.isOn) {
        g.lineStyle(4 * s, color, 1);
        g.beginPath();
        g.arc(6 * s, 0, 10 * s, -0.9, 0.9);
        g.strokePath();
        g.beginPath();
        g.arc(6 * s, 0, 19 * s, -0.9, 0.9);
        g.strokePath();
      } else {
        g.lineStyle(4 * s, COLORS.coral, 1);
        g.lineBetween(10 * s, -9 * s, 26 * s, 9 * s);
        g.lineBetween(26 * s, -9 * s, 10 * s, 9 * s);
      }
    }
  }
}

/** On/off switch. */
export class Toggle extends Phaser.GameObjects.Container {
  private readonly track: Phaser.GameObjects.Graphics;
  private readonly knob: Phaser.GameObjects.Graphics;
  private value: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, initial: boolean, onChange: (v: boolean) => void) {
    super(scene, x, y);
    this.value = initial;
    this.track = scene.add.graphics();
    this.knob = scene.add.graphics();
    this.knob.fillStyle(COLORS.shadow, 0.35);
    this.knob.fillCircle(0, 4, 28);
    this.knob.fillStyle(COLORS.textPrimary, 1);
    this.knob.fillCircle(0, 0, 28);
    this.add([this.track, this.knob]);
    this.redraw(false);
    makePressable(scene, this, 170, 132, () => {
      this.value = !this.value;
      ctx().audio.uiClick();
      this.redraw(true);
      onChange(this.value);
    }, 0.95);
    scene.add.existing(this);
  }

  private redraw(animate: boolean): void {
    const w = 130;
    const h = 72;
    this.track.clear();
    this.track.fillStyle(this.value ? COLORS.green : COLORS.buttonDisabled, 1);
    this.track.fillRoundedRect(-w / 2, -h / 2, w, h, h / 2);
    const x = this.value ? w / 2 - h / 2 : -w / 2 + h / 2;
    if (animate) this.scene.tweens.add({ targets: this.knob, x, duration: 180, ease: 'Back.easeOut' });
    else this.knob.x = x;
  }
}
