# Recipe 19 — Profile a frame

**Time:** 30–60 minutes · **Risk:** low · **Touches:** `packages/render/*`,
`docs/PERF_BUDGET.md`

The min spec is a 1080p integrated-GPU laptop at 60 fps (`docs/PERF_BUDGET.md`). "It
runs fine on my machine" is not a measurement; this is.

## The budget, in the order it breaks

| Slice | Budget | Usual offender |
| --- | --- | --- |
| JavaScript (sim + app) | ≤ 3 ms/frame | per-frame allocation, event plumbing |
| Draw calls | ≤ 300 | un-merged arena geometry |
| Triangles on screen | ≤ 350k | skyline/rocks outside frustum culling |
| Particles | tier cap | effects that ignore `maxParticles` |
| GPU time | 16.6 ms total | bloom at high pixel ratio |

## 1. Get the numbers the game already reports

In-game, press the FPS toggle (or `__IV__`):

```js
__IV__.info()   // { fps, frameMs, drawCalls, triangles, programs, resolutionScale, particles, enemies, quality }
```

`resolutionScale` below 1 means the adaptive controller is already fighting for you —
a signal that the tier is too expensive for the machine, not that everything is fine.

## 2. Separate simulation from rendering

```bash
npm run bench:sim          # simulation throughput, independent of rendering
```

Headroom target is ≥ 60× realtime (the gate in `apps/harness/src/cli.ts`). If the sim
is fast and the frame is slow, the cost is entirely presentation — skip to step 4.

## 3. Profile the frame

Chrome DevTools → Performance → record 5 seconds of a wave with hostiles firing:

- **Long tasks** in the JS flame chart: look for `consumeEvents`, `syncWorld`, particle
  spawn loops, and any `new THREE.*` inside the loop (allocation churn).
- **GPU timeline / Rendering panel**: draw calls and triangles per pass; check that bloom
  is not running at full device pixel ratio.
- **Memory**: a sawtooth that rises over a session means a leak — pooled systems that
  never release, or materials recreated per quality change.

## 4. Fix in budget order

1. **Cut pixels** (`pixelRatioCap`) — cheapest, biggest win, least visible at 1080p.
2. **Cut draw calls**: merge static arena geometry, instance repeated props, check
   frustum culling on skyline/rocks.
3. **Cut overdraw**: bloom and transparent particles are fill-rate bound; reduce
   `bloomStrength` before disabling it.
4. **Cut work per frame**: pool everything (the project already pools particles, decals,
   tracers, casings and enemy views — do not add a new per-frame allocation), and cull
   distant effects.
5. **Only then** lower simulation cost — gameplay must not pay for presentation.

## 5. Record it

Update `docs/PERF_BUDGET.md` with measured numbers and what changed. A perf change
without a recorded measurement will be reverted by the next person who "improves"
something.

## Verify

```bash
npm run dev                                   # look at __IV__.info() at 1080p
npm run test:e2e                              # frame loop must stay alive with hostiles on screen
npm run budget                                # bundle size is part of the budget too
```

## Traps we have hit

- **Measuring a cold start.** The first seconds include shader compilation and JIT
  warmup. Record after at least 10 seconds of play.
- **Measuring an empty map.** The expensive frame is twenty hostiles, muzzle flashes,
  tracer pools and dust all at once — record during a wave.
- **Chasing draw calls while VRAM is the problem.** KTX2 vs. PNG, shadow map size and
  render targets all matter more on integrated GPUs than call count.
