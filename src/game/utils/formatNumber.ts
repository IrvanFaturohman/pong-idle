const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];

/**
 * Compact number formatting: 999 -> "999", 1250 -> "1.25K", 12500 -> "12.5K", 1250000 -> "1.25M".
 * Keeps three significant digits above one thousand.
 */
export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const sign = value < 0 ? '-' : '';
  let n = Math.abs(value);
  if (n < 1000) return sign + String(Math.floor(n));
  let tier = 0;
  while (n >= 1000 && tier < SUFFIXES.length - 1) {
    n /= 1000;
    tier++;
  }
  // Avoid "1000K" when rounding pushes the value over a tier boundary.
  if (n >= 999.5 && tier < SUFFIXES.length - 1) {
    n /= 1000;
    tier++;
  }
  const decimals = n >= 100 ? 0 : n >= 10 ? 1 : 2;
  let fixed = n.toFixed(decimals);
  if (fixed.includes('.')) fixed = fixed.replace(/\.?0+$/, '');
  return sign + fixed + SUFFIXES[tier];
}

export function formatMoney(value: number): string {
  return (value < 0 ? '-$' : '$') + formatNumber(Math.abs(value));
}

/** Income display keeps one decimal for small rates so early growth is visible. */
export function formatRate(value: number): string {
  if (value <= 0) return '$0/s';
  if (value < 10) return '$' + (Math.round(value * 10) / 10).toFixed(1) + '/s';
  return formatMoney(value) + '/s';
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** "×1.0", "×1.5", "×2.25". */
export function formatMultiplier(m: number): string {
  return '×' + (Number.isInteger(m) ? m.toFixed(1) : String(m));
}
