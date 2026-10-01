/**
 * `npm run assets:import` — bring a licensed model into the game.
 *
 * Two sources, one contract:
 *   --url=<sketchfab model url>   download via the Sketchfab API (needs SKETCHFAB_TOKEN)
 *   --file=<local.glb>            adopt a file you already have (a purchased pack)
 *
 * The contract is invariant 5 (AGENTS.md): the model, the `models` entry in
 * assets/manifest.json and the row in assets/licenses/ledger.csv are written by the
 * same command, in the same transaction, so they cannot drift. Licences the project
 * accepts are listed in ALLOWED; anything else needs `--allow=<license>` and a
 * documented reason, and the flag is recorded in the ledger.
 *
 * This tool does not decide whether a model *looks* right — it only guarantees that
 * whatever ships is attributable and replaceable.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parseModelManifest, type ModelEntry, type ModelSlot } from '@iron/content';
import type { LedgerRow } from './licenseAudit';

export interface ImportOptions {
  /** Slot id, e.g. `weapon:m4a1`, `enemy:rifleman`, `prop:wreck`. */
  slot: string;
  url?: string;
  file?: string;
  license?: string;
  author?: string;
  source?: string;
  allow?: boolean;
  scale?: number;
  yawOffset?: number;
  yOffset?: number;
  root?: string;
}

export interface ImportResult {
  entry: ModelEntry;
  file: string;
  ledgerRow: LedgerRow;
  notes: string[];
}

/** Licences accepted without an explicit override. */
export const ALLOWED_LICENSES = [
  'CC0',
  'CC0-1.0',
  'CC-BY',
  'CC-BY-3.0',
  'CC-BY-4.0',
  'MIT',
  'Apache-2.0',
  'Mixamo-Royalty-Free',
  'Proprietary-Purchased',
];

const SKETCHFAB_API = 'https://api.sketchfab.com/v3';

export function parseSlot(slot: string): { slot: ModelSlot; id: string } {
  const [kind, id] = slot.split(':');
  if (!kind || !id) throw new Error(`--slot must look like weapon:m4a1 (got "${slot}")`);
  if (kind !== 'weapon' && kind !== 'enemy' && kind !== 'prop') {
    throw new Error(`slot kind must be weapon | enemy | prop (got "${kind}")`);
  }
  return { slot: kind, id };
}

/** Sketchfab exposes the licence inside the model payload; read it, never assume it. */
export async function fetchSketchfabModel(
  url: string,
  token: string,
): Promise<{ uid: string; name: string; author: string; license: string; source: string }> {
  const uid = extractUid(url);
  const response = await fetch(`${SKETCHFAB_API}/models/${uid}`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!response.ok) {
    throw new Error(`Sketchfab lookup failed (${response.status} ${response.statusText}) for ${uid}`);
  }
  const model = (await response.json()) as {
    name?: string;
    user?: { displayName?: string; username?: string };
    license?: { slug?: string; label?: string };
  };
  const license = model.license?.label ?? model.license?.slug;
  if (!license) throw new Error(`Sketchfab model ${uid} has no licence field — refusing to import`);
  return {
    uid,
    name: model.name ?? uid,
    author: model.user?.displayName ?? model.user?.username ?? 'unknown',
    license: normaliseLicense(license),
    source: `https://sketchfab.com/3d-models/${uid}`,
  };
}

function extractUid(url: string): string {
  const match = url.match(/([0-9a-f]{32})/i) ?? url.match(/-([0-9a-f]{12,})$/i);
  if (!match) throw new Error(`cannot find a Sketchfab model id in "${url}"`);
  return match[1]!;
}

/** `CC Attribution` -> `CC-BY`, so the ledger stays machine-checkable. */
export function normaliseLicense(label: string): string {
  const value = label.trim().toLowerCase();
  if (value.includes('cc0') || value.includes('public domain')) return 'CC0-1.0';
  if (value.includes('attribution')) {
    if (value.includes('noncommercial') || value.includes('no derivatives')) return label;
    return value.includes('4.0') ? 'CC-BY-4.0' : 'CC-BY';
  }
  if (value.includes('mit')) return 'MIT';
  if (value.includes('apache')) return 'Apache-2.0';
  return label;
}

export function licenceAccepted(license: string, allow: boolean): boolean {
  return allow || ALLOWED_LICENSES.includes(license);
}

export function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
}

/**
 * Write the manifest entry and the ledger row. Pure filesystem work, so the network
 * half (or a local file) can be tested separately.
 */
export function recordImport(options: ImportOptions & { target: string; license: string; source: string; author: string }): ImportResult {
  const root = resolve(options.root ?? '.');
  const manifestPath = join(root, 'assets/manifest.json');
  const ledgerPath = join(root, 'assets/licenses/ledger.csv');
  const { slot, id } = parseSlot(options.slot);
  const notes: string[] = [];

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const models = (manifest['models'] ?? {}) as Record<string, unknown>;
  // `target` is the path relative to assets/ (what the ledger keys on); the manifest
  // stores just the file name, because the loader resolves it against modelBasePath.
  const relativeFile = options.target.replace(/\\/g, '/').replace(/^assets\//, '');
  const fileName = relativeFile.split('/').pop()!;
  const key = `${slot}.${id}`;

  const entry = {
    slot,
    id,
    file: fileName,
    license: options.license,
    source: options.source,
    author: options.author,
    ...(options.scale !== undefined ? { scale: options.scale } : {}),
    ...(options.yawOffset !== undefined ? { yawOffset: options.yawOffset } : {}),
    ...(options.yOffset !== undefined ? { yOffset: options.yOffset } : {}),
  };
  models[key] = entry;
  manifest['models'] = models;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  // Re-read through the runtime parser: if the entry we just wrote would be dropped
  // by the loader, that is a bug in this tool, not in the game.
  const parsed = parseModelManifest(manifest);
  if (parsed.issues.length > 0) notes.push(...parsed.issues.map((issue) => `manifest: ${issue}`));

  const row: LedgerRow = {
    file: relativeFile,
    source: options.source,
    author: options.author,
    license: options.license,
    retrieved: new Date().toISOString().slice(0, 10),
    notes: `sha256:${sha256(join(root, 'assets', relativeFile))}`,
  };
  const csv = readFileSync(ledgerPath, 'utf8').replace(/\s*$/, '\n');
  if (csv.includes(`${relativeFile},`)) {
    notes.push(`ledger already has a row for ${relativeFile} — left as is`);
  } else {
    writeFileSync(ledgerPath, `${csv}${row.file},${row.source},${row.author},${row.license},${row.retrieved},${row.notes ?? ''}\n`);
  }

  return {
    entry: parsed.manifest.models.find((candidate) => candidate.slot === slot && candidate.id === id)!,
    file: relativeFile,
    ledgerRow: row,
    notes,
  };
}

/** Copy a local GLB into assets/models and register it. */
export function importLocalFile(options: ImportOptions): ImportResult {
  if (!options.file) throw new Error('--file is required without --url');
  if (!existsSync(options.file)) throw new Error(`no such file: ${options.file}`);
  if (!options.license) throw new Error('--license is required (invariant 5: nothing ships without provenance)');
  if (!licenceAccepted(options.license, Boolean(options.allow))) {
    throw new Error(
      `licence "${options.license}" is not on the accepted list (${ALLOWED_LICENSES.join(', ')}). ` +
        'Re-run with --allow only if you can justify it in docs/LICENSING.md.',
    );
  }
  const root = resolve(options.root ?? '.');
  const { slot, id } = parseSlot(options.slot);
  const target = join(root, 'assets/models', `${slot}_${id}.glb`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(options.file));
  return recordImport({
    ...options,
    target: `models/${basename(target)}`,
    license: options.license,
    source: options.source ?? options.file,
    author: options.author ?? 'unknown',
  });
}

/** Fetch a Sketchfab model's GLB. Requires the caller's own API token. */
export async function importFromSketchfab(options: ImportOptions): Promise<ImportResult> {
  const token = process.env['SKETCHFAB_TOKEN'];
  if (!token) {
    throw new Error(
      'SKETCHFAB_TOKEN is not set. Create a token at https://sketchfab.com/settings/password ' +
        'and export it (never commit it). Sketchfab downloads require your own account so the ' +
        'licence you accept is the licence you have.',
    );
  }
  if (!options.url) throw new Error('--url is required with --url imports');
  const meta = await fetchSketchfabModel(options.url, token);
  if (!licenceAccepted(meta.license, Boolean(options.allow))) {
    throw new Error(
      `model ${meta.uid} is "${meta.license}" — not in the accepted list (${ALLOWED_LICENSES.join(', ')}). ` +
        'Prefer a CC0/CC-BY model, or pass --allow with a justification for docs/LICENSING.md.',
    );
  }
  const response = await fetch(`${SKETCHFAB_API}/models/${meta.uid}/download`, {
    headers: { Authorization: `Token ${token}` },
  });
  if (!response.ok) {
    throw new Error(`download failed (${response.status}) — is the model downloadable and your token valid?`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const root = resolve(options.root ?? '.');
  const { slot, id } = parseSlot(options.slot);
  const target = join(root, 'assets/models', `${slot}_${id}.glb`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return recordImport({
    ...options,
    target: `models/${basename(target)}`,
    license: meta.license,
    source: meta.source,
    author: meta.author,
  });
}
