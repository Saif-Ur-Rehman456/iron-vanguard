# IRON VANGUARD

A deterministic browser campaign shooter — three.js front end over a fixed-step,
seed-deterministic simulation. The same mission replays identically in Node, in
the browser and in CI (golden-replay tests hash the world state every tick).

**Play it:** https://iron-vanguard-marhman02-5363.vercel.app

## Repository layout

```
packages/core      maths, vec3, rng, hashing, fixed-step clock, pools   (no deps)
packages/content   the game's data: weapons, enemies, waves, maps, …    (zod)
packages/sim       collision, ballistics, damage, AI, spawner, mission  (deterministic)
packages/render    three.js scene, materials, FX, camera rig, viewmodel
packages/audio     WebAudio bus, synthesis, 3D panning
packages/ui        HUD (canvas + DOM) and screens (menu/pause/results)
packages/tools     scripted player (bot), balance sweeps, validators
apps/game          the product: composition root + input + debug API
apps/harness       CLI: run/replay/sweep/hash/bench/diagnose
apps/devtools      browser dashboard: content, balance, determinism, perf
apps/editor        top-down level editor for MapDef data
```

## Development

```bash
npm run dev        # play it (vite, port 5173)
npm test           # unit + integration + golden replay tests
npm run verify     # everything CI runs: typecheck, lint, content, tests,
                   # bench, licences, both builds, budget
npm run smoke -- https://<deployed-url>   # boot-check a deployed build
```

Node ≥ 22.12 (see `.nvmrc`). npm workspaces — no global installs needed.

## CI/CD

Two gates run on every push and pull request, plus a nightly:

| Pipeline | What it proves |
| --- | --- |
| **GitHub Actions — CI** | typecheck, lint, content validation, unit + golden-replay tests, simulation throughput budget, licence audit, both production builds, bundle-size budget, Playwright end-to-end in a real browser, asset-pipeline guards |
| **GitHub Actions — Nightly** | balance sweeps across all four difficulties with completion-rate floors, golden replay on Linux/Windows/macOS |
| **Vercel Git integration** | every push to `main` deploys production; every PR gets its own preview URL |

CI must be green before a change is considered done; the deployment is
automatic — merge to `main` and Vercel builds `apps/game/dist` and ships it.

## Licensing

See `docs/LICENSING.md` and `assets/licenses/ledger.csv` — every binary asset
carries a licence row; generated/procedural stand-ins are always allowed.
