import type { Vec2 } from '../types';

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const randRange = (min: number, max: number): number => min + Math.random() * (max - min);

export const randSign = (): number => (Math.random() < 0.5 ? -1 : 1);

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;

/** Frame-rate independent exponential smoothing factor. */
export const damp = (sharpness: number, dt: number): number => 1 - Math.exp(-sharpness * dt);

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutBack = (t: number, s = 1.70158): number => {
  const c3 = s + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
};

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function rotate(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/**
 * Keep a direction away from the pure horizontal / vertical axes so balls never get
 * locked into endless flat trajectories. Returns a unit vector.
 */
export function clampDirection(dx: number, dy: number, minFromHorizontal: number, minFromVertical: number): Vec2 {
  let len = length(dx, dy);
  if (len < 1e-6) {
    const a = randRange(0, Math.PI * 2);
    dx = Math.cos(a);
    dy = Math.sin(a);
    len = 1;
  }
  let x = dx / len;
  let y = dy / len;
  const minY = Math.sin(minFromHorizontal);
  const minX = Math.sin(minFromVertical);
  if (Math.abs(y) < minY) {
    y = (y === 0 ? randSign() : Math.sign(y)) * minY;
    x = (x === 0 ? randSign() : Math.sign(x)) * Math.sqrt(1 - y * y);
  }
  if (Math.abs(x) < minX) {
    x = (x === 0 ? randSign() : Math.sign(x)) * minX;
    y = (y === 0 ? randSign() : Math.sign(y)) * Math.sqrt(1 - x * x);
  }
  return { x, y };
}

/** Shortest signed difference between two angles (radians). */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function hexToCss(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** Mix two 0xRRGGBB colors. */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}
