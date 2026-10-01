import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@iron/core', replacement: r('../../packages/core/src/index.ts') },
      { find: '@iron/sim', replacement: r('../../packages/sim/src/index.ts') },
      { find: '@iron/content', replacement: r('../../packages/content/src/index.ts') },
      { find: '@iron/tools', replacement: r('../../packages/tools/src/index.ts') },
    ],
  },
  server: { port: 5175, strictPort: false },
  build: { target: 'es2022' },
});
