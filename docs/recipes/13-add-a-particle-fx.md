# Recipe 13 — Add a particle effect

**Time:** ~40 minutes · **Risk:** low · **Touches:** `packages/render/src/renderer.ts`,
`packages/render/src/fx/*`, `packages/sim/src/*` (only if a new event is needed)

Effects are presentation, and the boundary is strict: **the simulation emits events, the
renderer interprets them.** A particle that changes gameplay (smoke blocking vision,
dust hiding an enemy) is not a particle — that is a simulation feature and belongs in
`packages/sim` with a real type, not in the FX layer.

## Steps

1. **Decide whether the event exists.** Most effects already have a producer:   `shot`, `impact`, `enemyShot`, `explosion`, `enemyDamaged`, `enemyKilled`.
   If the simulation already emits something at the right moment, just handle it. Only
   add an event type when the *gameplay* fact is genuinely new
   (`packages/sim/src/types.ts` → the `WorldEvent` union, plus the emit site).

2. **Spawn through the pooled system.** `ParticleSystem.spawn({...})` takes position,
   velocity, color, size, life, grow, gravity, drag, opacity, additive, flicker,
   rotation. Never `new THREE.Sprite` in the frame loop — the prototype did that with
   480 live particles and paid for it in GC churn (PARITY_NOTES #6).

3. **Respect the pool budget.** `maxParticles` comes from the quality tier
   (`render/quality.ts`). An effect that wants 40 particles per hit will evict other
   effects at `low`. Budget for the *same* effect happening ten times in one second.

4. **Use the surface, not the mesh.** Impact effects read `getSurface(event.surface)`
   for colour and decal parameters, so a new material behaves correctly everywhere
   without touching effect code (recipe 09).

5. **Pick additive vs normal deliberately.** Additive for muzzle flash, sparks and
   fire; normal for dust, blood and debris. Additive blood looks like neon.

6. **Add the effect to the event switch** in `consumeEvents`
   (`packages/render/src/renderer.ts`), then check it at `low` and `high` quality.

## Verify

```bash
npm run dev                  # see it: density, colour, timing
npm run test:e2e             # the renderer must not throw on any event type
npm run bench:sim            # if you added a sim event, prove the tick is unaffected
npm run budget               # FX code is code: it ships
```

Effects are unhashed by design, so the golden replay is unaffected — that is exactly
why none of them may influence gameplay. If you find yourself wanting one that does,
write it as simulation state and hash it.

## Traps we have hit

- **Allocating per particle.** Creates GC spikes during firefights, which is precisely
  when the frame rate matters.
- **Effects that outlive their reason.** A smoke column from a barrel that was destroyed
  two waves ago is usually a missing pool release rather than a design choice.
- **`Math.random()` in the renderer is fine; in the simulation it is fatal** (AGENTS.md
  invariant 1). Effects are allowed to be visually nondeterministic; gameplay is not.
