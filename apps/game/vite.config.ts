import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Two build targets from one source (ADR-0007):
 *  - `vite build`          → product build (code-split, hashed assets, PWA-ready)
 *  - `vite build --config vite.single.config.ts` → dist-single/callofduty.html
 */
export default defineConfig({
  resolve: {
    // Ordered aliases: the CSS entry must resolve before the bare package name.
    alias: [
      { find: '@iron/ui/theme.css', replacement: r('../../packages/ui/src/theme.css') },
      { find: '@iron/core', replacement: r('../../packages/core/src/index.ts') },
      { find: '@iron/sim', replacement: r('../../packages/sim/src/index.ts') },
      { find: '@iron/content', replacement: r('../../packages/content/src/index.ts') },
      { find: '@iron/render', replacement: r('../../packages/render/src/index.ts') },
      { find: '@iron/audio', replacement: r('../../packages/audio/src/index.ts') },
      { find: '@iron/ui', replacement: r('../../packages/ui/src/index.ts') },
    ],
  },
  // The repo-wide assets/ folder is the shipped asset root: downloaded models
  // (assets/models/*.glb) are served at /models/* and copied into dist/ by the
  // product build. The zero-asset baseline means this folder can also be empty.
  publicDir: r('../../assets'),
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
