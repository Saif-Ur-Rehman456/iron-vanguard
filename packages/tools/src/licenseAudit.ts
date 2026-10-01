/**
 * License audit (docs/LICENSING.md).
 *
 * Every binary in `assets/` must have a row in `assets/licenses/ledger.csv`
 * naming its source, author and license. CI fails otherwise — this is the check
 * that makes "where did this model come from?" a question nobody has to ask
 * after ship day. Ripped or unverifiable assets are never acceptable.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { parseModelManifest } from '@iron/content';

export interface LedgerRow {
  file: string;
  source: string;
  author: string;
  license: string;
  retrieved: string;
  notes?: string;
}

export interface AuditReport {
  ok: boolean;
  missing: string[];
  rows: number;
  orphans: string[];
  unknownLicenses: string[];
}

const ASSET_EXTENSIONS = new Set(['.glb', '.gltf', '.ktx2', '.png', '.jpg', '.jpeg', '.hdr', '.wav', '.ogg', '.mp3']);
/** Licenses we accept in the shipped build. Anything else needs an ADR. */
const ALLOWED_LICENSES = ['CC0', 'MIT', 'Apache-2.0', 'CC-BY', 'CC-BY-4.0', 'Mixamo-Royalty-Free', 'Proprietary-Purchased'];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (ASSET_EXTENSIONS.has(extname(entry).toLowerCase())) out.push(path);
  }
  return out;
}

export function parseLedger(csv: string): LedgerRow[] {
  const lines = csv.split('\n').map((line) => line.trim()).filter(Boolean);
  const rows: LedgerRow[] = [];
  for (const line of lines.slice(1)) {
    const [file, source, author, license, retrieved, notes] = line.split(',').map((v) => v?.trim() ?? '');
    if (!file) continue;
    rows.push({ file, source: source ?? '', author: author ?? '', license: license ?? '', retrieved: retrieved ?? '', notes });
  }
  return rows;
}

export function auditAssets(assetsDir = 'assets', ledgerPath = 'assets/licenses/ledger.csv'): AuditReport {
  const files = walk(assetsDir);
  const ledger = existsSync(ledgerPath) ? parseLedger(readFileSync(ledgerPath, 'utf8')) : [];
  const ledgerFiles = new Set(ledger.map((row) => row.file.replace(/\\/g, '/')));

  const missing: string[] = [];
  for (const file of files) {
    const relativePath = relative(assetsDir, file).replace(/\\/g, '/');
    if (!ledgerFiles.has(relativePath)) missing.push(relativePath);
  }

  const orphans = ledger
    .map((row) => row.file)
    .filter((file) => !files.some((candidate) => relative(assetsDir, candidate).replace(/\\/g, '/') === file));

  const unknownLicenses = ledger
    .filter((row) => row.license && !ALLOWED_LICENSES.includes(row.license))
    .map((row) => `${row.file} (${row.license})`);

  return {
    ok: missing.length === 0 && unknownLicenses.length === 0,
    missing,
    rows: ledger.length,
    orphans,
    unknownLicenses,
  };
}

export interface ModelAuditReport {
  ok: boolean;
  /** Manifest entries whose file is not on disk. */
  missingFiles: string[];
  /** Manifest entries with no licence ledger row (invariant 5). */
  unledgered: string[];
  /** Manifest entries whose licence is not on the accepted list. */
  badLicenses: string[];
  /** Entry-level schema problems (see parseModelManifest). */
  issues: string[];
  count: number;
}

/**
 * The model half of the licence audit: every downloaded model named in the manifest
 * must exist, carry an accepted licence, and have a ledger row. This is what stops a
 * model from being added to the manifest by hand and shipped unattributed.
 */
export function auditModels(
  assetsDir = 'assets',
  manifestPath = 'assets/manifest.json',
  ledgerPath = 'assets/licenses/ledger.csv',
): ModelAuditReport {
  const report: ModelAuditReport = {
    ok: true,
    missingFiles: [],
    unledgered: [],
    badLicenses: [],
    issues: [],
    count: 0,
  };
  if (!existsSync(manifestPath)) return report;
  const parsed = parseModelManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  report.issues.push(...parsed.issues);
  report.count = parsed.manifest.models.length;
  if (report.count === 0) {
    report.ok = report.issues.length === 0;
    return report;
  }

  const ledger = existsSync(ledgerPath) ? parseLedger(readFileSync(ledgerPath, 'utf8')) : [];
  const ledgerFiles = new Set(ledger.map((row) => row.file.replace(/\\/g, '/')));
  const base = parsed.manifest.modelBasePath.endsWith('/')
    ? parsed.manifest.modelBasePath
    : `${parsed.manifest.modelBasePath}/`;

  for (const entry of parsed.manifest.models) {
    const key = `${entry.slot}.${entry.id}`;
    const relativePath = `${base}${entry.file}`.replace(/\\/g, '/');
    if (!existsSync(join(assetsDir, relativePath))) report.missingFiles.push(`${key} (${relativePath})`);
    if (!ledgerFiles.has(relativePath)) report.unledgered.push(`${key} (${relativePath})`);
    if (!ALLOWED_LICENSES.includes(entry.license)) report.badLicenses.push(`${key} (${entry.license})`);
  }
  report.ok =
    report.issues.length === 0 &&
    report.missingFiles.length === 0 &&
    report.unledgered.length === 0 &&
    report.badLicenses.length === 0;
  return report;
}
