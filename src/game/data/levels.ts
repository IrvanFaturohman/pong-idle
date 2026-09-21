import { BALLS } from '../config';

/** Curated colors for the first six ball levels. */
const LEVEL_COLORS: readonly number[] = [
  0xeef1f6, // 1 soft white
  0xff7e8a, // 2 coral pink
  0x5db8ff, // 3 sky blue
  0x8be36a, // 4 lime green
  0xffd454, // 5 warm yellow
  0xa68bff, // 6 violet
];

/** Levels at or above this get a small star marker and hue-cycled colors. */
export const STAR_LEVEL = LEVEL_COLORS.length + 1;

function hslToHex(h: number, s: number, l: number): number {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return (r << 16) | (g << 8) | b;
}

export function levelColor(level: number): number {
  if (level <= LEVEL_COLORS.length) return LEVEL_COLORS[Math.max(0, level - 1)];
  // Higher levels cycle hue in large, readable steps.
  const hue = (24 + (level - STAR_LEVEL) * 53) % 360;
  return hslToHex(hue, 0.82, 0.64);
}

export function levelColorCss(level: number): string {
  return '#' + levelColor(level).toString(16).padStart(6, '0');
}

export function ballRadius(level: number): number {
  return Math.min(BALLS.maxRadius, BALLS.baseRadius + BALLS.radiusPerLevel * (level - 1));
}

/** Number of small stars drawn above very high level balls. */
export function levelStars(level: number): number {
  if (level < STAR_LEVEL) return 0;
  return Math.min(3, 1 + Math.floor((level - STAR_LEVEL) / 3));
}
