import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Invariants enforced by lint rather than discipline (see AGENTS.md, ADR-0002):
//  - packages/core and packages/sim are engine-, DOM-, timer- and wall-clock-free
//  - no Math.random anywhere in core/sim: use named seeded Rng streams
const FORBIDDEN_GLOBALS = [
  'document',
  'window',
  'globalThis',
  'localStorage',
  'sessionStorage',
  'navigator',
  'location',
  'performance',
  'requestAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'fetch',
  'Image',
  'HTMLElement',
  'AudioContext',
  'WebGLRenderingContext',
  'alert',
  'console',
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-single/**',
      '**/node_modules/**',
      'legacy/**',
      'assets/**',
      'test-results/**',
      'playwright-report/**',
      '.freebuff/**',
      '*.d.ts',
      'scripts/*.mjs',
      // `npm run shots` output and the ad-hoc capture probes written beside it. They are
      // browser-side scripts (window, document, canvas), not product code, and the directory
      // is gitignored — but eslint does not read .gitignore, so linting them reported 194
      // errors about a `window` that is the whole point of the file.
      '.captures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-non-null-assertion': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
    },
  },
  {
    files: ['packages/core/src/**/*.ts', 'packages/sim/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            'three',
            'three/*',
            'three-mesh-bvh',
            'postprocessing',
            '@iron/render',
            '@iron/ui',
            '@iron/audio',
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Determinism: use a seeded Rng stream from @iron/core (ADR-0002).',
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: 'Determinism: sim uses tick time only, never the wall clock (ADR-0002).',
        },
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Determinism: sim uses tick time only, never the wall clock (ADR-0002).',
        },
      ],
    },
  },
  {
    files: ['tests/**/*.ts', 'apps/harness/**/*.ts', 'packages/tools/**/*.ts', 'packages/*/src/**/*.test.ts'],
    rules: { 'no-console': 'off' },
  },
);
