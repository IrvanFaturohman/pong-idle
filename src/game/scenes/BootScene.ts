import Phaser from 'phaser';
import { generateTextures } from '../utils/textures';

/** Generates every procedural texture, then starts the game (which launches the UI). */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateTextures(this);
    this.scene.start('Game');
    const boot = document.getElementById('boot-screen');
    if (boot) {
      boot.classList.add('hidden');
      window.setTimeout(() => boot.remove(), 400);
    }
  }
}
