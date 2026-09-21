import { ARENA, AUTO, PADDLES } from '../config';
import type { Ball } from '../entities/Ball';
import { railFor, type Paddle } from '../entities/Paddle';
import type { GameScene } from '../scenes/GameScene';
import type { Side } from '../types';

const SIDES: readonly Side[] = ['top', 'bottom', 'left', 'right'];

interface Threat {
  along: number;
  frames: number;
  ball: Ball;
}

/** Reflect a coordinate into [lo, hi] the way a ball bouncing between two walls would travel. */
function fold(x: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (span <= 0) return lo;
  let u = (x - lo) % (2 * span);
  if (u < 0) u += 2 * span;
  return lo + (u <= span ? u : 2 * span - u);
}

/**
 * Auto mode: every paddle predicts where incoming balls will cross its rail
 * and slides there at a limited speed. Balls are assigned soonest-first to the
 * nearest free paddle on that side; idle paddles drift back to evenly spaced
 * home slots. Obstacles are ignored by the prediction, so the AI can be fooled.
 */
export class AutoPilot {
  private readonly threats: Threat[] = [];

  constructor(private readonly game: GameScene) {}

  update(boost: number): void {
    for (const side of SIDES) {
      const paddles = this.game.paddlesOn(side).filter((p) => !p.carried);
      if (paddles.length === 0) continue;
      for (const p of paddles) p.speedLimit = AUTO.paddleSpeed * boost;
      this.steerSide(side, paddles);
    }
  }

  private steerSide(side: Side, paddles: Paddle[]): void {
    const rail = railFor(side);
    const n = rail.normal;
    const horizontal = rail.axis === 'x';
    const faceOffset = PADDLES.thickness / 2;
    const threats = this.threats;
    threats.length = 0;

    for (const ball of this.game.balls) {
      const body = ball.body;
      if (!body) continue;
      const v = this.game.matter.body.getVelocity(body);
      const approach = -(v.x * n.x + v.y * n.y);
      if (approach <= 0.01) continue;
      // Distance (along the normal) until the ball's edge meets the paddle face.
      const face = rail.fixed + (horizontal ? n.y : n.x) * faceOffset;
      const across = horizontal ? body.position.y : body.position.x;
      const dist = (across - face) * (horizontal ? n.y : n.x) - ball.radius;
      if (dist < -ball.radius) continue;
      const frames = Math.max(0, dist) / approach;
      if (frames > AUTO.horizonFrames) continue;
      const lo = (horizontal ? ARENA.left : ARENA.top) + ball.radius;
      const hi = (horizontal ? ARENA.right : ARENA.bottom) - ball.radius;
      const start = horizontal ? body.position.x : body.position.y;
      const vt = horizontal ? v.x : v.y;
      // Slightly off-center aim (stable per ball) keeps rebound angles varied.
      const aim = (((ball.id * 53) % 100) / 100 - 0.5) * 2 * AUTO.aimSpread;
      threats.push({ along: fold(start + vt * frames, lo, hi) + aim, frames, ball });
    }
    threats.sort((a, b) => a.frames - b.frames);

    // Soonest ball first: send the paddle that can get there fastest.
    const targets = new Array<number>(paddles.length);
    const taken = new Array<boolean>(paddles.length).fill(false);
    let assigned = 0;
    for (const t of threats) {
      if (assigned >= paddles.length) break;
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < paddles.length; i++) {
        if (taken[i]) continue;
        const d = Math.abs(paddles[i].pos - t.along);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      if (best < 0) break;
      taken[best] = true;
      targets[best] = t.along;
      assigned++;
    }
    // Idle paddles return to evenly spaced home slots.
    const seg = (rail.end - rail.start) / paddles.length;
    for (let i = 0; i < paddles.length; i++) {
      if (!taken[i]) targets[i] = rail.start + seg * (i + 0.5);
    }

    // Keep paddles in order with the minimum gap, inside the rail.
    const order = targets.slice().sort((a, b) => a - b);
    const step = PADDLES.length + PADDLES.sameSideGap;
    for (let i = 0; i < order.length; i++) {
      const min = rail.min + i * step;
      const max = rail.max - (order.length - 1 - i) * step;
      order[i] = Math.min(max, Math.max(min, order[i], i > 0 ? order[i - 1] + step : min));
    }
    for (let i = order.length - 2; i >= 0; i--) order[i] = Math.min(order[i], order[i + 1] - step);
    for (let i = 0; i < paddles.length; i++) paddles[i].target = order[i];
  }
}
