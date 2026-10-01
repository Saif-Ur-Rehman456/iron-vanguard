# Recipe 15 — Add a quality setting

**Time:** ~1 hour · **Risk:** medium (it decides whether the game runs for people) ·
**Touches:** `packages/render/src/quality.ts`, `apps/game/src/settings.ts`,
`packages/render/src/renderer.ts`, `docs/PERF_BUDGET.md`

Quality is a *budget*, not a preference list. Every tier exists to hold 60 fps at 1080p
on the min-spec machine described in `docs/PERF_BUDGET.md`; the adaptive controller
trades resolution before it drops frames.

## Steps

1. **Add the knob to `QualitySettings`** (`render/quality.ts`): a number, a boolean or a
   small enum. Give it a sane default and document what it costs.

2. **Set it in every preset.** `low`, `medium`, `high`, `cinematic` must all answer the
   new field — TypeScript enforces this, which is the point.

3. **Honour it in `GameRenderer`.** Anything expensive (shadow map size, bloom, particle
   capacity, decal count, dust, fog volume, pixel-ratio cap) is read from
   `this.quality` at construction or in `setQuality()`. If a knob changes a live
   resource, `setQuality()` must dispose/rebuild it rather than leaving it stale —
   that is the usual bug here.

4. **Decide where it sits in the trade order.** The controller's priority is:
   resolution → particle/decal counts → shadows → post effects. A new knob must declare
   itself somewhere in that order, or the adaptive resolution will compensate for it and
   hide the effect.

5. **Expose it in the UI** (`apps/game/src/settings.ts` + `packages/ui/src/screens.ts`),
   including persistence. A setting the player cannot find is not shipped.

6. **Test the extremes.** `?seed=7&autostart=1` then apply `low` and `cinematic` through
   the debug API (`__IV__.setQuality('low')`) and confirm nothing is missing or
   double-drawn.

## Verify

```bash
npm run dev                     # toggle live; look for missing resources
npm run bench:sim               # simulation must be unaffected by render settings
npm run build && npm run budget
npm run test:e2e                # quality-tier test asserts each tier boots and renders
```

Update `docs/PERF_BUDGET.md` with what the new knob buys (or costs) in milliseconds.
A knob nobody measured is a knob that will be mis-set for years.

## Traps we have hit

- **Forgetting `pixelRatioCap`.** On a 4K display, ignoring it means rendering 4× the
  pixels of a 1080p target — the single most common cause of "it runs badly on my
  machine".
- **Rebuilding on every frame.** `setQuality()` runs on change, not in the loop; leaking
  a texture per call shows up as memory growth over a long session.
- **A setting that changes gameplay.** Motion scale and FOV scale are presentation
  preferences and must never alter simulation state — if toggling one changes the golden
  hash, the change is broken.
