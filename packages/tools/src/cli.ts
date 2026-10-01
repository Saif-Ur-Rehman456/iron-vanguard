/**
 * Tooling CLI used by npm scripts and CI:
 *   content  — schema + cross-reference validation
 *   maps     — per-map sanity (spawn, gates, cover, density)
 *   assets   — every asset has a licence ledger row
 *   licenses — full licence audit incl. unknown licences
 *   model    — import a licensed model into a named slot (assets:import)
 */
import { importFromSketchfab, importLocalFile, parseSlot } from './assetsImport';
import { auditAssets, auditModels } from './licenseAudit';
import { validateAll } from './index';

const command = process.argv[2] ?? 'content';

switch (command) {
  case 'content': {
    const summary = validateAll();
    for (const issue of summary.content) console.error(`content ${issue.where}: ${issue.message}`);
    for (const issue of summary.maps) {
      const log = issue.severity === 'error' ? console.error : console.warn;
      log(`map     ${issue.mapId}: ${issue.message} [${issue.severity}]`);
    }
    if (!summary.ok) {
      console.error('\ncontent validation FAILED');
      process.exit(1);
    }
    console.log('content + maps OK');
    break;
  }

  case 'maps': {
    const summary = validateAll();
    for (const issue of summary.maps) console.log(`${issue.severity.toUpperCase()} ${issue.mapId}: ${issue.message}`);
    console.log(`${summary.maps.length} map issues`);
    break;
  }

  case 'assets':
  case 'licenses': {
    const report = auditAssets();
    // Downloaded models are audited too: manifest entry, file on disk and ledger row
    // must all three exist (invariant 5).
    const models = auditModels();
    console.log(`ledger rows: ${report.rows}`);
    console.log(`manifest models: ${models.count}`);
    for (const issue of models.issues) console.error(`manifest model issue: ${issue}`);
    for (const entry of models.missingFiles) console.error(`model file missing: ${entry}`);
    for (const entry of models.unledgered) console.error(`model has no ledger row: ${entry}`);
    for (const entry of models.badLicenses) console.error(`model licence not accepted: ${entry}`);
    if (!models.ok) {
      console.error('model audit FAILED (see docs/LICENSING.md)');
      process.exit(1);
    }
    if (report.orphans.length > 0) {
      console.warn(`ledger rows with no file (${report.orphans.length}): ${report.orphans.join(', ')}`);
    }
    if (report.unknownLicenses.length > 0) {
      for (const entry of report.unknownLicenses) console.error(`unapproved licence: ${entry}`);
    }
    if (report.missing.length > 0) {
      for (const file of report.missing) console.error(`missing ledger row: assets/${file}`);
      console.error(
        `\n${report.missing.length} asset(s) have no licence row. Add them to assets/licenses/ledger.csv ` +
          '(see docs/LICENSING.md) before shipping.',
      );
      process.exit(1);
    }
    if (!report.ok) process.exit(1);
    console.log('licence audit OK');
    break;
  }

  case 'model': {
    // assets:import -- --slot=weapon:m4a1 --url=<sketchfab>|--file=<local.glb> [...]
    const flags = new Map<string, string>();
    for (const argument of process.argv.slice(3)) {
      const [key, value] = argument.replace(/^--/, '').split('=');
      if (key) flags.set(key, value ?? 'true');
    }
    const slot = flags.get('slot');
    if (!slot) {
      console.error('usage: assets:import -- --slot=<weapon|enemy|prop>:<id> --url=<sketchfab url> | --file=<local.glb> [--license=CC-BY-4.0] [--author=…] [--source=…] [--scale=1] [--allow]');
      process.exit(1);
    }
    parseSlot(slot);
    const options = {
      slot,
      url: flags.get('url'),
      file: flags.get('file'),
      license: flags.get('license'),
      author: flags.get('author'),
      source: flags.get('source'),
      allow: flags.has('allow'),
      scale: flags.has('scale') ? Number(flags.get('scale')) : undefined,
      yawOffset: flags.has('yawOffset') ? Number(flags.get('yawOffset')) : undefined,
      yOffset: flags.has('yOffset') ? Number(flags.get('yOffset')) : undefined,
    };
    const result = options.url
      ? await importFromSketchfab(options)
      : importLocalFile(options);
    console.log(`imported ${result.entry.slot}.${result.entry.id} -> assets/${result.file}`);
    console.log(`  licence ${result.entry.license} by ${result.entry.author} (${result.entry.source})`);
    for (const note of result.notes) console.warn(`  ${note}`);
    const audit = auditAssets();
    const models = auditModels();
    console.log(`licence audit: ${audit.ok && models.ok ? 'OK' : 'FAILED'}`);
    if (!audit.ok || !models.ok) process.exit(1);
    break;
  }

  default:
    console.error(`unknown command: ${command} (content | maps | assets | licenses | model)`);
    process.exit(1);
}
