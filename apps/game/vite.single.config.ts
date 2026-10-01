import { existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import base from './vite.config.ts';

/**
 * The shareable artifact: one `callofduty.html` with all JS/CSS inlined.
 * Textures and audio are procedural, so this file is genuinely self-contained —
 * the M2 asset pipeline will stream GLB/KTX2 from `assets/` beside it, and the
 * procedural baseline keeps the artifact playable if that folder is missing.
 */

/**
 * Emit the artifact under the name the project promises: `callofduty.html`.
 *
 * Renaming on disk in `closeBundle` rather than mutating the bundle object: Rollup
 * deprecated assigning to `bundle`, and Rolldown (Vite 8) ignores it outright — which
 * silently produced `index.html` and left the budget gate reporting "not built yet".
 * An fs rename after the write is boring and works.
 */
function renameArtifact(): Plugin {
  let root = process.cwd();
  let outDir = 'dist-single';
  return {
    name: 'iron-rename-artifact',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const from = join(resolve(root, outDir), 'index.html');
      const to = join(resolve(root, outDir), 'callofduty.html');
      if (existsSync(from)) renameSync(from, to);
    },
  };
}

export default defineConfig({
  ...base,
  plugins: [viteSingleFile({ removeViteModuleLoader: true, inlinePattern: [] }), renameArtifact()],
  build: {
    ...(typeof base === 'object' && base.build ? base.build : {}),
    outDir: 'dist-single',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    sourcemap: false,
  },
});
