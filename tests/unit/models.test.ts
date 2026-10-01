/**
 * Downloaded-model contract.
 *
 * Two things must hold for the drop-in art pipeline to be safe: a manifest entry
 * without provenance is rejected (not warned about), and a slot with no model is a
 * tested, expected state rather than a crash.
 */
import { describe, expect, it } from 'vitest';
import { modelKey, parseModelManifest } from '@iron/content';
import { ModelLibrary, emptyModelLibrary } from '@iron/render';
import { auditModels } from '@iron/tools/node';

const validEntry = {
  slot: 'prop',
  id: 'wreck',
  file: 'prop_wreck.glb',
  license: 'CC0',
  source: 'https://example.com/wreck',
  author: 'Someone',
};

function manifest(models: Record<string, unknown>): unknown {
  return { version: 1, modelBasePath: 'models/', models };
}

describe('model manifest', () => {
  it('accepts a fully attributed entry', () => {
    const parsed = parseModelManifest(manifest({ 'prop.wreck': validEntry }));
    expect(parsed.issues).toEqual([]);
    expect(parsed.manifest.models).toHaveLength(1);
    expect(parsed.manifest.models[0]!.file).toBe('prop_wreck.glb');
  });

  it('rejects entries with no licence, source or author', () => {
    const parsed = parseModelManifest(
      manifest({
        'prop.a': { slot: 'prop', id: 'a', file: 'a.glb' },
        'prop.b': { ...validEntry, id: 'b', license: '' },
        'prop.c': { ...validEntry, id: 'c', source: '' },
        'prop.d': { ...validEntry, id: 'd', author: '' },
      }),
    );
    expect(parsed.manifest.models).toHaveLength(0);
    expect(parsed.issues).toHaveLength(4);
    expect(parsed.issues.join('\n')).toContain('license');
  });

  it('rejects an entry whose key disagrees with slot.id', () => {
    const parsed = parseModelManifest(manifest({ 'prop.wrongname': validEntry }));
    expect(parsed.manifest.models).toHaveLength(0);
    expect(parsed.issues[0]).toContain('does not match slot.id');
  });

  it('never throws on a broken manifest, and keeps the baseline', () => {
    for (const broken of [null, 42, {}, { models: 'nope' }, { models: { a: 3 } }]) {
      const parsed = parseModelManifest(broken);
      expect(parsed.manifest.models).toEqual([]);
      expect(parsed.manifest.modelBasePath).toBe('models/');
    }
  });
});

describe('model library fallback', () => {
  it('reports no models and instantiates nothing when the manifest is empty', () => {
    const library = emptyModelLibrary();
    expect(library.count).toBe(0);
    expect(library.has('prop', 'wreck')).toBe(false);
    expect(library.instantiate('prop', 'wreck')).toBeNull();
  });

  it('resolves files against the manifest base path', () => {
    const parsed = parseModelManifest(
      manifest({
        'weapon.m4a1': { ...validEntry, slot: 'weapon', id: 'm4a1', file: 'weapon_m4a1.glb' },
      }),
    ).manifest;
    const entry = parsed.models[0]!;
    expect(ModelLibrary.url('/assets/', parsed, entry)).toBe('/assets/models/weapon_m4a1.glb');
    expect(ModelLibrary.url('/assets', parsed, entry)).toBe('/assets/models/weapon_m4a1.glb');
    expect(modelKey('weapon', 'm4a1')).toBe('weapon.m4a1');
  });
});

describe('licence audit of downloaded models', () => {
  it('passes for the repository as shipped, with zero downloaded models', () => {
    const report = auditModels();
    expect(report.ok).toBe(true);
    expect(report.count).toBe(0);
  });

  it('fails on an unattributed, missing or badly licensed model', () => {
    // The three failure modes the gate exists for, checked against a fixture so the
    // rule cannot quietly degrade into "warn only".
    const report = auditModels(
      'tests/fixtures/audit-assets',
      'tests/fixtures/audit-assets/manifest.json',
      'tests/fixtures/audit-assets/licenses/ledger.csv',
    );
    expect(report.ok).toBe(false);
    expect(report.unledgered.join(' ')).toContain('prop.unledgered');
    expect(report.badLicenses.join(' ')).toContain('prop.badlicence');
    expect(report.missingFiles.join(' ')).toContain('prop.missing');
  });
});
