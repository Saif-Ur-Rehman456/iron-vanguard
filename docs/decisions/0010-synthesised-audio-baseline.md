# ADR-0010 — Synthesised audio baseline, recorded audio as a swap-in

**Status:** accepted · **Date:** 2026-09-20

## Context

Audio is where license-clean projects usually break down: gunshots and impacts are
exactly the samples nobody can source freely. The prototype used raw WebAudio
synthesis and, while it sounds like a prototype, **every gameplay-critical cue was
audible and correctly positioned** — you could hear which side you were being shot
from.

## Decision

`packages/audio` keeps synthesis as the shipping baseline:

- `SoundLibrary.play({ cue, pos?, volume?, listener })` is the only entry point.
- Cues are named strings from content data (`wpn_rifle_fire`, `impact_metal`,
  `enemy_death`, `ui_*`, `wpn_rifle_dry`), not file paths.
- Buses (`master → music / sfx / ui`), a noise buffer, distance attenuation and
  stereo panning live in the package, so a sample player and the synth share the
  spatial path.
- The listener is fed from the camera rig each frame, so panning tracks the real
  view instead of a stale snapshot.

Replacing a cue with a recording in M2 is a table edit in `SoundLibrary` plus a
loader. No call site, no content row and no test changes.

## Consequences

- Zero audio assets means zero license risk and a zero-byte audio payload in the
  single-file build (ADR-0007).
- Cue identity is stable, so `docs/recipes/add-a-sound.md` can describe one path for
  both synth and sample.
- Synth patches are code, so they are reviewable in a diff and can be unit-tested
  (cue → bus, distance gain monotonicity) — unlike opaque `.wav` swaps.
- Trade-off: the baseline will not pass as AAA audio. That is a known, scheduled gap
  (`docs/ROADMAP.md` M3), not an accident.

## Alternatives rejected

- **Free sample packs (freesound CC0 etc.).** Tempting, but per-file provenance,
  attribution requirements and inconsistent loudness/format make it a pipeline
  project of its own; the ledger and audit gate exist precisely so this can be added
  deliberately later.
- **No audio until assets exist.** Loses a real gameplay channel (directional damage
  feedback) for the entire vertical slice.
