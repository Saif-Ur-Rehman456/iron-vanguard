/**
 * Asset manifest contract.
 *
 * Which downloaded models may replace which procedural slot, and what provenance
 * each one carries. It lives in `content` because it is data with an invariants it
 * must satisfy — including AGENTS.md invariant 5: a model with no licence, source
 * and author is rejected, not warned about.
 *
 * Validation is deliberately *non-fatal* at load time: the game must render from the
 * procedural baseline when the manifest is empty, stale or half-broken. `parseIssues`
 * is what CI and the import tool look at.
 */
import { z } from 'zod';

export const ModelSlotSchema = z.enum(['weapon', 'enemy', 'prop']);
export type ModelSlot = z.infer<typeof ModelSlotSchema>;

export const ModelEntrySchema = z.object({
  slot: ModelSlotSchema,
  id: z.string().min(1),
  /** Path relative to `modelBasePath`. */
  file: z.string().min(1),
  /** Licence identifier; see ALLOWED_LICENSES in packages/tools/src/assetsImport.ts. */
  license: z.string().min(1),
  source: z.string().min(1),
  author: z.string().min(1),
  scale: z.number().positive().optional(),
  yawOffset: z.number().optional(),
  yOffset: z.number().optional(),
});
export type ModelEntry = z.infer<typeof ModelEntrySchema>;

export const ModelManifestSchema = z.object({
  version: z.number().int().positive().default(1),
  modelBasePath: z.string().default('models/'),
  models: z.array(ModelEntrySchema).default([]),
});
export type ModelManifest = z.infer<typeof ModelManifestSchema>;

export interface ModelManifestParse {
  manifest: ModelManifest;
  /** One line per rejected entry — reported by the loader and by `assets:import`. */
  issues: string[];
}

/**
 * Accepts the on-disk shape (`models` as an object keyed by `slot.id`) and returns
 * the runtime shape (an array), so the manifest stays readable and hand-editable
 * while the loader gets something it can iterate.
 */
export function parseModelManifest(raw: unknown): ModelManifestParse {
  const issues: string[] = [];
  const fallback: ModelManifest = { version: 1, modelBasePath: 'models/', models: [] };
  if (raw === null || typeof raw !== 'object') {
    return { manifest: fallback, issues: ['manifest is not an object — procedural baseline kept'] };
  }
  const record = raw as Record<string, unknown>;
  const manifest: ModelManifest = {
    version: typeof record['version'] === 'number' ? record['version'] : 1,
    modelBasePath: typeof record['modelBasePath'] === 'string' ? record['modelBasePath'] : 'models/',
    models: [],
  };
  const entries = record['models'];
  if (entries === undefined) return { manifest, issues };
  if (entries === null || typeof entries !== 'object') {
    return { manifest, issues: ['`models` must be an object of "slot.id" -> entry'] };
  }

  for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
    const result = ModelEntrySchema.safeParse(value);
    if (!result.success) {
      const detail = result.error.issues.map((issue) => `${issue.path.join('.') || 'entry'}: ${issue.message}`).join('; ');
      issues.push(`${key}: ${detail}`);
      continue;
    }
    const expected = `${result.data.slot}.${result.data.id}`;
    if (expected !== key) {
      // A mismatch here is how a model silently never loads; say so out loud.
      issues.push(`${key}: key does not match slot.id (${expected})`);
      continue;
    }
    manifest.models.push(result.data);
  }
  return { manifest, issues };
}

/** Slot lookup key, as used by the manifest and the renderer. */
export function modelKey(slot: ModelSlot, id: string): string {
  return `${slot}.${id}`;
}
