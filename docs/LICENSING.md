# Licensing doctrine

Rule zero: **if we cannot prove the rights to an asset, it does not ship.** Not at
the end of the project, not "temporarily", not as a placeholder we will remember to
replace. Everything else here is bookkeeping in service of that rule.

## Enforcement

```bash
npm run licenses:audit     # CI runs this; it fails the build
```

`packages/tools/src/licenseAudit.ts` walks `assets/` for binaries (`.glb`, `.gltf`,
`.ktx2`, `.png`, `.jpg`, `.hdr`, `.wav`, `.ogg`, `.mp3`) and requires a row in
`assets/licenses/ledger.csv`:

```
file,source,author,license,retrieved,notes
models/weapons/m4_vanguard.glb,Blender / in-house,IRON VANGUARD art team,Proprietary-Purchased,2026-09-20,hand-modelled from concept sheet 04
```

- A binary with no row → **build failure**.
- A row with an unapproved licence → **build failure**.
- A row with no matching file → warning (an asset was removed; clean the row up).

Approved licences: `CC0`, `MIT`, `Apache-2.0`, `CC-BY`, `CC-BY-4.0`,
`Mixamo-Royalty-Free`, `Proprietary-Purchased`. Anything else requires an ADR —
deliberate friction, because "is this licence OK?" is a human question with legal
consequences, and a machine should not answer it silently.

## The procedural baseline

M1 ships **no binary assets at all**: textures are canvas noise, geometry is built
from `MapDef` data, animations are procedural, audio is synthesised. So the audit
passes on a clean checkout because there is nothing to audit.

This is not a stopgap, it is a design decision:

- the game boots and plays if `assets/` is deleted entirely;
- art lands incrementally, file by file, without a flag day;
- there is no "we will replace the ripped placeholder later" failure mode, because
  there are no placeholders — the fallback is ours.

See `assets/licenses/SOURCES.md` for the table of what is used and its terms.

## Downloaded models (the upgrade path)

Every prop, weapon and character in the shipped game is procedural, so nothing *needs* a
downloaded model. Licensed models are an upgrade, and there are exactly two ways to add
one — both of which write the manifest entry, the file and the ledger row in a single
step, then run the audit:

```bash
# Your own file (a purchased pack, your own Blender export)
npm run assets:import -- --slot=prop:wreck --file=~/Downloads/wreck.glb   --license=CC0 --author="Someone" --source="https://example.com/wreck"

# Sketchfab, with your own API token
export SKETCHFAB_TOKEN=...            # https://sketchfab.com/settings/password
npm run assets:import -- --slot=weapon:m4a1 --url=https://sketchfab.com/3d-models/...
```

The audit now covers models as well as files (`auditModels` in
`packages/tools/src/licenseAudit.ts`):

- a manifest entry whose `.glb` is missing → **build failure**;
- a manifest entry with no ledger row → **build failure** (invariant 5);
- a manifest entry whose licence is not on the approved list → **build failure**;
- a manifest entry the schema rejects (no licence, source or author) → **rejected at
  load, reported by the audit**.

### Sketchfab specifically

Sketchfab hosts models under many licences, and most of them are **not** usable here.
The import tool reads the licence from the model payload and refuses anything outside
the approved list unless `--allow=<license>` is passed with a written justification:

| Sketchfab licence | Verdict | Why |
| --- | --- | --- |
| CC0 / Public Domain | allowed | no conditions |
| CC Attribution (CC-BY, CC-BY-4.0) | allowed | credit the author in the ledger + `SOURCES.md` |
| CC Attribution-NonCommercial / NoDerivatives / ShareAlike | **rejected** | commercial or derivative restrictions |
| "Standard" / "Editorial" (paid store licence) | **rejected** | per-seat terms we cannot verify |
| No licence field at all | **rejected** | unverifiable provenance is the one thing rule zero forbids |

Also: a Sketchfab download is only permitted for models whose author enabled
downloads. Needing your *own* token is deliberate — the licence you accept has to be
the licence you actually have.

Whatever the source, the model must be *replaceable*: it slots into one named id
(`weapon.m4a1`, `enemy.rifleman`, `prop.wreck`) and deleting the file returns the game
to its procedural version with no code change.

## Source policy

| Source | Allowed | Notes |
| --- | --- | --- |
| Poly Haven / ambientCG | yes | CC0, no attribution required (we credit anyway) |
| Quaternius / Kenney / KayKit / Poly Pizza | yes | CC0 |
| Mixamo | animation data only | royalty-free to use, **not** to redistribute |
| Blender, authored by us | yes | `Proprietary-Purchased` in the ledger |
| Anything from a search engine, a Discord, or a "free models" site | **no** | unverifiable provenance |
| Anything ripped from another game | **no** | never, for any reason |

### Mixamo specifically

Mixamo clips are free for commercial projects with an Adobe account. They are not
free to redistribute as assets. So:

1. FBX files stay outside the repository (they are gitignored).
2. `tools/blender/mixamo_retarget.py` imports a clip, renames every bone to
   `IK_iron_*`, **deletes the imported mesh**, and exports a GLB containing only
   animation data against our skeleton.
3. The ledger row records `Mixamo-Royalty-Free` with a note that it is animation
   data, so a future audit can distinguish "licensed a clip" from "redistributed a
   character".

Characters that ship are Blender-authored. This is checked in review, not by CI,
because it is a judgement about what a mesh *is*.

## Adding an asset

```bash
# 1. put the source (not the export) in assets_src/
cp ~/Downloads/m4.blend assets_src/blender/m4_vanguard.blend

# 2. write its provenance
cp assets_src/blender/_TEMPLATE.license.json assets_src/blender/m4_vanguard.license.json
$EDITOR assets_src/blender/m4_vanguard.license.json

# 3. export (writes the GLB, the ledger row and the manifest entry)
npm run assets:pipeline

# 4. prove it
npm run licenses:audit
```

If step 3 refuses to run, the sidecar is missing or malformed — that is the guard
working, not a bug.

## What to do when you are unsure

Ask before the asset is used, not after it ships. The cost of a question is a
message; the cost of an unlicensed asset in a shipped game is a takedown, a
replacement art pass, and every streamer who showed it being told to re-edit.
