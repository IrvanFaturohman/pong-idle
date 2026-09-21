import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages /pong-idle/).
  base: './',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      // Three pages: the version picker, and one page per game version.
      input: {
        index: root('./index.html'),
        classic: root('./classic/index.html'),
        auto: root('./auto/index.html'),
      },
      output: {
        manualChunks: {
          phaser: ['phaser'],
        },
      },
    },
  },
});
