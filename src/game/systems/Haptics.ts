/**
 * Optional, very light vibration feedback. Never required for gameplay and
 * silently ignored where `navigator.vibrate` is unsupported (e.g. iOS Safari).
 */
export class Haptics {
  readonly supported: boolean;
  private last = 0;

  constructor(public enabled: boolean) {
    this.supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  pulse(ms: number, minIntervalMs = 60): void {
    if (!this.enabled || !this.supported || document.visibilityState === 'hidden') return;
    // Browsers reject (and log) vibration before the user has interacted with the page.
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    const now = performance.now();
    if (now - this.last < minIntervalMs) return;
    this.last = now;
    try {
      navigator.vibrate(ms);
    } catch {
      /* ignore */
    }
  }
}
