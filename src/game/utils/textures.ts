import Phaser from 'phaser';
import { PADDLES } from '../config';

/**
 * Every texture in the game is drawn procedurally into canvases at boot –
 * there are no image files. Most are white so they can be tinted per level / map.
 */
export const TEX = {
  ball: 'tex-ball',
  ballHighlight: 'tex-ball-hl',
  softShadow: 'tex-soft-shadow',
  glow: 'tex-glow',
  dot: 'tex-dot',
  confetti: 'tex-confetti',
  confettiTri: 'tex-confetti-tri',
  hand: 'tex-hand',
  vignette: 'tex-vignette',
} as const;

type Ctx2D = CanvasRenderingContext2D;

function canvasTexture(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx2D, w: number, h: number) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const c = tex.getContext();
  c.clearRect(0, 0, w, h);
  draw(c, w, h);
  tex.refresh();
}

export function roundRectPath(c: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.lineTo(x + w - rr, y);
  c.arcTo(x + w, y, x + w, y + rr, rr);
  c.lineTo(x + w, y + h - rr);
  c.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  c.lineTo(x + rr, y + h);
  c.arcTo(x, y + h, x, y + h - rr, rr);
  c.lineTo(x, y + rr);
  c.arcTo(x, y, x + rr, y, rr);
  c.closePath();
}

export interface PaddleTextures {
  face: string;
  flash: string;
  shadow: string;
}

/**
 * Paddle textures for a given length, drawn in local space: long axis = x,
 * +y = the face that looks into the arena. Created on first use and cached.
 */
export function ensurePaddleTextures(scene: Phaser.Scene, length: number): PaddleTextures {
  const L = Math.round(length);
  const T = PADDLES.thickness;
  const keys = { face: `tex-paddle-${L}`, flash: `tex-paddle-flash-${L}`, shadow: `tex-paddle-shadow-${L}` };
  const pad = 4;
  canvasTexture(scene, keys.face, L + pad * 2, T + pad * 2, (c) => {
    const g = c.createLinearGradient(0, pad, 0, pad + T);
    g.addColorStop(0, '#c9ced8');
    g.addColorStop(0.45, '#f4f5f8');
    g.addColorStop(1, '#ffffff');
    c.fillStyle = g;
    roundRectPath(c, pad, pad, L, T, T / 2);
    c.fill();
    // Thin bright strip along the arena-facing edge.
    c.fillStyle = 'rgba(255,255,255,0.9)';
    roundRectPath(c, pad + 14, pad + T - 8, L - 28, 4, 2);
    c.fill();
  });
  canvasTexture(scene, keys.flash, L + pad * 2, T + pad * 2, (c) => {
    c.fillStyle = '#ffffff';
    roundRectPath(c, pad, pad, L, T, T / 2);
    c.fill();
  });
  canvasTexture(scene, keys.shadow, L + 80, T + 80, (c, w, h) => {
    // Draw the shape far off-canvas and keep only its blurred shadow (works in every browser,
    // unlike ctx.filter which Safari lacks).
    const off = 4000;
    c.shadowColor = 'rgba(0,0,0,0.85)';
    c.shadowBlur = 22;
    c.shadowOffsetX = off;
    c.fillStyle = '#000000';
    roundRectPath(c, 36 - off, 36, w - 72, h - 72, T / 2);
    c.fill();
  });
  return keys;
}

export function generateTextures(scene: Phaser.Scene): void {
  // Ball: white sphere with soft top-left light. Tinted per level at runtime.
  canvasTexture(scene, TEX.ball, 128, 128, (c) => {
    const g = c.createRadialGradient(48, 44, 6, 64, 64, 64);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#f1f3f7');
    g.addColorStop(0.85, '#d4d9e2');
    g.addColorStop(1, '#b9c0cc');
    c.fillStyle = g;
    c.beginPath();
    c.arc(64, 64, 63, 0, Math.PI * 2);
    c.fill();
  });

  // Specular highlight that stays roughly top-left while the ball squashes.
  canvasTexture(scene, TEX.ballHighlight, 64, 44, (c) => {
    const g = c.createRadialGradient(32, 22, 2, 32, 22, 30);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.save();
    c.translate(32, 22);
    c.scale(1, 0.68);
    c.beginPath();
    c.arc(0, 0, 30, 0, Math.PI * 2);
    c.fill();
    c.restore();
  });

  canvasTexture(scene, TEX.softShadow, 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,0.75)');
    g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  canvasTexture(scene, TEX.glow, 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
  });

  canvasTexture(scene, TEX.dot, 16, 16, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(8, 8, 7.5, 0, Math.PI * 2);
    c.fill();
  });

  canvasTexture(scene, TEX.confetti, 18, 10, (c) => {
    c.fillStyle = '#ffffff';
    roundRectPath(c, 0, 0, 18, 10, 2);
    c.fill();
  });

  canvasTexture(scene, TEX.confettiTri, 16, 14, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(8, 0);
    c.lineTo(16, 14);
    c.lineTo(0, 14);
    c.closePath();
    c.fill();
  });

  ensurePaddleTextures(scene, PADDLES.length);

  // Simple pointing hand for the tutorial (fingertip at the top center).
  canvasTexture(scene, TEX.hand, 128, 168, (c) => {
    c.save();
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 14;
    c.shadowOffsetY = 6;
    c.fillStyle = '#f5f7fa';
    // index finger
    roundRectPath(c, 50, 10, 30, 92, 15);
    c.fill();
    // folded fingers
    roundRectPath(c, 76, 64, 26, 50, 13);
    c.fill();
    roundRectPath(c, 96, 76, 22, 44, 11);
    c.fill();
    // thumb
    c.save();
    c.translate(40, 100);
    c.rotate(-0.55);
    roundRectPath(c, -12, -34, 24, 58, 12);
    c.fill();
    c.restore();
    // palm
    roundRectPath(c, 36, 84, 82, 76, 30);
    c.fill();
    c.restore();
    // subtle crease lines
    c.strokeStyle = 'rgba(40,48,64,0.18)';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(79, 70);
    c.lineTo(79, 100);
    c.moveTo(99, 82);
    c.lineTo(99, 108);
    c.stroke();
  });

  // Low-res vignette, scaled up to cover the screen (gradients scale cleanly).
  canvasTexture(scene, TEX.vignette, 216, 384, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h * 0.45, h * 0.12, w / 2, h * 0.45, h * 0.72);
    g.addColorStop(0, 'rgba(255,255,255,0.035)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.42)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
}
