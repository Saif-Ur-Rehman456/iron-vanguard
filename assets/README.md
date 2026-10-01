# assets/

Runtime art. Every file here is **licence-clean and ledgered** — CI fails the build
if a binary in this folder has no row in `licenses/ledger.csv` (`npm run licenses:audit`).

```
assets/
  manifest.json          logical asset id → file, kind, licence, LOD chain
  licenses/ledger.csv    provenance for every binary in this folder
  licenses/SOURCES.md    where each source came from, and its terms
  models/                GLB: weapons, kits, props, fractures, anims
  textures/              KTX2 (PBR: albedo/normal/roughness/AO)
  audio/                 WAV/OGG: weapon, impact, voice, ambience, music
  ui/                    HUD icons, fonts
```

## The rules

1. **One binary, one ledger row.** `file,source,author,license,retrieved,notes`.
   Allowed licences are listed in `packages/tools/src/licenseAudit.ts`; anything else
   needs an ADR.
2. **Procedural is the fallback, not the exception.** Every prop, texture and sound
   has a generated stand-in in `@iron/render` / `@iron/audio`. Delete this whole
   folder and `apps/game` still boots and plays — it just looks and sounds plainer.
   That is what lets art land incrementally instead of gating the game on it.
3. **Nothing ships that we cannot prove the rights to.** Ripped assets, "found"
   models and unattributed textures are never acceptable, no matter how good they
   look. See `docs/LICENSING.md`.
4. **Sources are fetched by hash, not committed, when large.** `manifest.json`
   records the expected byte size and the ledger records the source URL, so a
   re-download is verifiable.

## Where art comes from

| Source | What we take | Licence |
| --- | --- | --- |
| Poly Haven | HDRIs, PBR texture sets | CC0 |
| ambientCG | PBR materials, decals | CC0 |
| Quaternius | low-poly props + animated characters | CC0 |
| Kenney / KayKit / Poly Pizza | props, UI packs | CC0 |
| Mixamo | animation clips only, retargeted onto `IK_iron_*` | royalty-free, **not redistributable** |
| Blender (ours) | characters, weapons, level kits | ours |

Mixamo is the trap: its clips are free to *use*, not to *redistribute as assets*, and
its character meshes never ship. `tools/blender/mixamo_retarget.py` enforces this by
importing the animation, renaming the rig, and deleting the imported mesh.
