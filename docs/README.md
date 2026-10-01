# IRON VANGUARD — documentation index

A deterministic browser campaign shooter, built from a single-file prototype
(`legacy/callofduty.r128.html`) into a project that can be measured, tested and
extended. Start with the row that matches what you are about to do.

| If you are… | Read |
| --- | --- |
| about to change anything | [`AGENTS.md`](../AGENTS.md) — the five invariants and the commands |
| new to the codebase | [`ARCHITECTURE.md`](ARCHITECTURE.md) — boundaries, the tick, why determinism leads |
| running an agent on this repo | [`VIBE_WORKFLOW.md`](VIBE_WORKFLOW.md) — the loop, working agreements, anti-patterns |
| doing a specific task | [`recipes/`](recipes/README.md) — 20 short procedures |
| wondering where the project is going | [`ROADMAP.md`](ROADMAP.md) + [`TASKS.md`](TASKS.md) |
| deciding what "done" means | [`QUALITY_BAR.md`](QUALITY_BAR.md) |
| tuning numbers | [`BALANCE.md`](BALANCE.md), then `npm run sweep` |
| touching rendering or perf | [`PERF_BUDGET.md`](PERF_BUDGET.md), [`ART_BIBLE.md`](ART_BIBLE.md) |
| building or sourcing art | [`ART_BIBLE.md`](ART_BIBLE.md), [`LICENSING.md`](LICENSING.md), [`recipes/10`](recipes/10-author-a-blender-prop.md) |
| designing a level | [`LEVEL_DESIGN.md`](LEVEL_DESIGN.md) |
| wiring up MCP servers | [`MCP_SETUP.md`](MCP_SETUP.md) |
| asking "why is it like this?" | [`decisions/`](decisions/) — 12 ADRs |
| trying to match the old prototype | [`legacy/PARITY_NOTES.md`](../legacy/PARITY_NOTES.md), [`legacy/MECHANICS_SPEC.md`](../legacy/MECHANICS_SPEC.md) |
| checking the render by eye | [`CAPTURE_REQUEST.md`](CAPTURE_REQUEST.md), [`QUALITY_BAR.md`](QUALITY_BAR.md) |

## The project in one paragraph

The simulation (`@iron/sim`, with maths in `@iron/core`) is a pure, deterministic
function of commands plus a seed. Content (`@iron/content`) is validated data, not code.
Presentation (`@iron/render`, `@iron/audio`, `@iron/ui`) only reads simulation state and
the events it emits. Tooling (`@iron/tools`, `apps/harness`, `apps/devtools`,
`apps/editor`) drives the same simulation headlessly, so balance and performance claims
have commands behind them. Everything ships twice: as a normal product build and as one
self-contained `callofduty.html`.

## Architecture decisions

| # | Decision |
| --- | --- |
| [0001](decisions/0001-package-boundaries.md) | Package boundaries and a one-way dependency graph |
| [0002](decisions/0002-deterministic-simulation.md) | Deterministic simulation, presentation as a reader |
| [0003](decisions/0003-content-as-data.md) | Content as validated data |
| [0004](decisions/0004-strict-typescript-no-framework.md) | Strict TypeScript, no framework in the simulation |
| [0005](decisions/0005-procedural-first-art.md) | Procedural-first art with an asset overlay |
| [0006](decisions/0006-parity-as-a-target.md) | Parity as a target, not a religion |
| [0007](decisions/0007-two-builds-one-source.md) | Two builds from one source |
| [0008](decisions/0008-scripted-player-as-tooling.md) | The scripted player is first-class tooling |
| [0009](decisions/0009-debug-api-contract.md) | `window.__IV__` is the automation surface |
| [0010](decisions/0010-synthesised-audio-baseline.md) | Synthesised audio baseline |
| [0011](decisions/0011-realism-without-borrowed-assets.md) | Realism without borrowed assets |
| [0012](decisions/0012-rendering-foundation.md) | The rendering foundation is measured, not asserted |
| [0013](decisions/0013-lighting-rig.md) | The night is cool, the lamps are warm, and both are measured |

## The commands that matter

```bash
npm run dev            # play it
npm test               # unit + integration + golden
npm run test:e2e       # Playwright against the real build
npm run sim            # headless mission, scripted player
npm run sweep          # balance across seeds
npm run replay         # verify the golden trace
npm run bench:sim      # simulation throughput gate
npm run build:single   # produce callofduty.html
npm run verify         # everything CI runs, in one command
```

## Writing documents

- **A decision that is expensive to reverse** → an ADR (`decisions/`), one page, with
  the alternatives you rejected and why.
- **A procedure you will repeat** → a recipe (`recipes/`), task-shaped, ending in a
  command that proves it worked.
- **A number** → the file that owns it (`BALANCE.md`, `PERF_BUDGET.md`), with the
  measurement that produced it.
- **A deviation from the prototype** → `legacy/PARITY_NOTES.md`, numbered.

Docs are held to the same standard as code: if a doc and the code disagree, the code
wins and the doc is fixed in the same change.
