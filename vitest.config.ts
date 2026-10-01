import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    // Ordered, anchored patterns: a plain object alias does prefix matching, so
    // '@iron/tools' would swallow '@iron/tools/node' and resolve it to a path that
    // does not exist.
    alias: [
      { find: /^@iron\/tools\/node$/, replacement: r('packages/tools/src/node.ts') },
      { find: /^@iron\/core$/, replacement: r('packages/core/src/index.ts') },
      { find: /^@iron\/sim$/, replacement: r('packages/sim/src/index.ts') },
      { find: /^@iron\/content$/, replacement: r('packages/content/src/index.ts') },
      { find: /^@iron\/render$/, replacement: r('packages/render/src/index.ts') },
      { find: /^@iron\/audio$/, replacement: r('packages/audio/src/index.ts') },
      { find: /^@iron\/ui$/, replacement: r('packages/ui/src/index.ts') },
      { find: /^@iron\/tools$/, replacement: r('packages/tools/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    testTimeout: 30_000,
    reporters: ['default'],
  },
});
