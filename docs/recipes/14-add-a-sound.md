# Recipe 14 — Add a sound

**Time:** ~30 minutes · **Risk:** low · **Touches:** `packages/audio/src/sfx.ts`,
content `audio` id fields, `apps/game/src/main.ts` (event plumbing)

A cue is a **named string**, never a filename. Content data holds cue ids
(`wpn_rifle_fire`, `enemy_heavy_fire`, `impact_metal`); the audio package decides how to
make that sound. Today it synthesises (ADR-0010); later a sample table slots in behind
the same ids without touching call sites.

## Two ways a cue gets played

1. **From the simulation** — the sim pushes a `{ type: 'audio', cue, pos?, volume? }`
   event and the app plays it with the listener position from the camera. Use this for
   anything with a position in the world: weapon fire, impacts, enemy deaths, barrels.
2. **From the app** — UI, stingers and menu feedback call `audio.play(cue, pos, volume,
   listener)` directly. Anything that is not a world event belongs here.

## Steps

1. **Add the case** in `SoundLibrary.play()` (`packages/audio/src/sfx.ts`). Composers
   available: `burst()` (filtered noise: useful for impacts and mechanical clicks) and
   `tone()` (oscillator sweep: useful for stings, hums, UI). Both take `f0`/`f1`, `dur`,
   `vol`, and an optional `at` offset. The `impact_<surfaceId>` family is a lookup table
   (`SURFACE_IMPACTS`) — extend that for a new material (recipe 09).

2. **Name it by convention:** `<system>_<thing>_<variant>` — `wpn_smg_fire`,
   `enemy_rusher_alert`, `ui_click`, `stinger_victory`. Names are data-visible; renaming
   one later means updating content.

3. **Reference it from content**, not from code, whenever possible: `WeaponDef.audio`,
   `EnemyDef.audio`, `SurfaceDef.audio`. New cue ids on a content row need no code.

4. **Positional or not?** Pass `pos` for world sound (so it pans and attenuates by
   distance) and omit it for anything the player hears "in their head" — UI, stingers,
   mission announcements. A positional UI click is a bug.

5. **Mix it.** Cue volume is relative within the `sfx` bus: `gainScale` per call,
   `sfxVolume` from settings, `masterVolume` at the top. A cue that needs to be heard
   over gunfire should be *distinct* (frequency, duration), not just louder — the player
   controls the fader.

## Verify

```bash
npm run dev
```

Then check the three things only playtests catch:

- **Directional readability:** can you tell which side you are being shot from with the
  music up? (This is why the bus split exists.)
- **Repetition:** a cue fired 30 times in a burst (SMG) must not grate — vary pitch or
  filter per shot *inside* the cue, not by shipping many samples.
- **Priority:** a kill confirm, an incoming-burst telegraph and a wave banner can land in
  the same tick. Nothing important should be masked by something incidental.

`npm test` must stay green: audio is presentation, so a cue change must not move the
golden hash.

## Traps we have hit

- **`Math.random()` in the simulation to vary a cue's pitch.** Pitch variation belongs in
  the audio layer (renderer-side), never in the tick — it would break determinism.
- **Playing sounds outside the audio context's unlocked state.** Browsers block audio
  until a user gesture; `audio.init()` is called on deploy for exactly this reason, and
  a cue created before that is silent, not thrown.
- **Cue ids typo'd in content.** Nothing validates them yet, so an unknown cue falls
  through the switch and is silent. If a sound "does not work", grep the id first.
