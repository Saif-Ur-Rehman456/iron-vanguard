# ADR-0011 — Realism without borrowed assets

- Status: accepted (M2 realism pass)
- Supersedes nothing. Extends ADR-0005 (procedural-first art) and ADR-0006 (parity as a
  target).

## Context

The M1 build played correctly but looked like what it was: scaled boxes with flat canvas
textures. The brief for this pass was "make the models realistic — and if you cannot,
import them from Sketchfab". Both halves of that are judgement calls with real
consequences, so they are recorded rather than assumed.

Three facts framed the decision:

1. **The simulation is pristine and must stay that way.** All 87 tests pass, including a
   golden replay that hashes a full mission. Any art approach that touches `@iron/sim`
   costs a re-record and a parity note; one that touches only `@iron/render` costs
   nothing. This is the benefit M0 was built for.
2. **Provenance is an invariant, not a preference** (AGENTS.md #5). Downloading models
   moves the problem from "make it look right" to "prove where it came from", and most
   Sketchfab models are CC-BY-NC or store-licensed, i.e. unusable here.
3. **A downloaded asset is a liability at the exact moment it matters.** A 404 on
   `wreck.glb`, a 40 MB GLB on a phone, a licence that turns out to be wrong: none of
   those should be able to break or legally poison a build that already works.

## Decision

Reach realism **procedurally first**, and make downloaded models an *optional upgrade*
behind a named slot, never a dependency.

Concretely:

- **One height field → five maps** (`packages/render/src/materials/pbr.ts`). Albedo,
  normal, roughness, AO and metalness are derived from the same relief, so shading and
  colour agree. Every surface is a named lookup, so a scanned set can replace one
  surface later.
- **Nothing is a scaled cube** (`packages/render/src/geometry.ts`): beveled boxes, lathed
  profiles, extruded cross-sections, convex rubble. Silhouette first, surface detail
  second.
- **Image-based lighting from the procedural sky** (`level/lighting.ts`) — the single
  biggest realism lever for metals.
- **Detail is paid for by batching, not by frame rate** (`packages/render/src/batch.ts`).
  A prop's parts bake into one mesh per material; a limb, a reloading magazine, an
  exploding barrel and a swaying banner each keep their own transform.
- **GPU particles**: 480 live particles cost two draw calls (two point clouds), instead
  of one per particle.
- **Licensed models are a slot table, not a build step**
  (`packages/content/src/assets.ts`, `assets/models/`): `weapon.<id>`, `enemy.<id>`,
  `prop.<kind>`. `npm run assets:import` writes the file, the manifest entry and the
  licence ledger row together and refuses anything outside the approved licences. A
  missing or broken model logs one line and falls back.

## Consequences

Good:

- The build still ships with **zero binaries**; the single-file artifact stays a single
  file, and `assets/` can be deleted without breaking the game.
- The look improved substantially with no licensing exposure, and every improvement is
  reproducible from source (`npm run shots` captures the evidence).
- A downloaded model is now a *data* change: delete one line and the game reverts.
- The GLB path is real and tested (`window.__IV__.models()`, `tests/unit/models.test.ts`),
  so the "import it from Sketchfab" option exists without being load-bearing.

Costs, accepted knowingly:

- Procedural realism has a ceiling. Faces, cloth and complex silhouettes will not reach
  scanned quality, and animation stays a hand-built walk cycle until a rigged GLB lands.
- The generator code is now a meaningful share of `@iron/render` and needs its own
  perf attention (a `Sketch` texture bake costs a few ms at boot; `npm run shots` plus
  the devtools panel keep it honest).
- A downloaded model bypasses the batching discipline: it arrives with whatever material
  and skeleton its author used. The loader reads the file; it cannot fix it.
- Draw calls now scale with hostile count (~20 each), which is why
  `docs/PERF_BUDGET.md` documents a *model* rather than a single limit.

## Alternatives rejected

- **Download a pack of CC0 models and wire them in now.** Rejected: it moves the visual
  problem to a licensing problem for little gain, and every model still needs materials,
  scale, orientation and collision work — the procedural version has none of those steps.
- **Rip models from a commercial shooter for "reference".** Not a candidate. ADR-0005 and
  rule zero of `docs/LICENSING.md` both exist to make this a non-conversation.
- **A full skinned-animation system for GLB characters in this pass.** Rejected as
  scope: procedural animation is good enough to *play*, and the interface (`update()` with
  a pose) is already the seam a rig would plug into.
- **Mesh-accurate collision (`three-mesh-bvh`) so downloaded props fit their visuals.**
  Rejected for now: it changes gameplay, so it belongs with the navigation work in M2,
  where the golden is being re-recorded anyway.
