# Vibe workflow

How to work on this project when the person driving is directing an agent rather
than typing the code. The goal is that a good idea can go from sentence to verified
build in one session, without the agent re-deriving the architecture every time.

## The loop

```
describe intent → agent reads AGENTS.md + the relevant recipe →
small change → npm run verify → play it → commit
```

The expensive failure mode in agent-driven development is not bad code, it is
**misunderstanding the codebase repeatedly**. Everything below exists to prevent it.

## What the project gives the agent

| Artifact | Why it exists |
| --- | --- |
| `AGENTS.md` | the contract: five invariants + the commands that matter |
| `docs/ARCHITECTURE.md` | boundaries and the tick order, in one page |
| `docs/recipes/*` | task-shaped instructions, so an agent edits the right layer |
| `legacy/MECHANICS_SPEC.md` | the game's rules, extracted from the prototype |
| `legacy/PARITY_NOTES.md` | which numbers are load-bearing, and every deviation |
| `docs/decisions/*` | why the surprising choices are the way they are |
| `npm run verify` | one command that says "yes" or names what broke |
| `apps/harness` | measurement without a browser (`sim`, `sweep`, `replay`, `bench`) |
| `apps/devtools` | the same measurements, in a browser, for a human |
| `window.__IV__` | tests drive real gameplay instead of pixel-hunting |
| `diagnose.ts` | "why is this wave not clearing?" in one command |

## Session shapes

**"Make X feel better."** The agent finds the value's home (usually
`packages/content`), changes it, runs `npm run sweep` before and after, and reports
the distribution rather than the average. If the golden hash moves, that is expected
for a tuning change — it must be re-recorded and the reason stated.

**"Add a new weapon / enemy / objective."** Follow the recipe in `docs/recipes/`. A
weapon is data plus (optionally) a view-model profile. If the agent finds itself
writing an `if (weaponId === ...)` anywhere in `@iron/sim`, the seam is wrong — that
is a bug report against the architecture, not a task to finish.

**"Something is broken."** Reproduce it headlessly first
(`npm run sim -- --seed=N`, or `diagnose.ts` for AI). A bug that reproduces in the
harness gets fixed in seconds; the same bug chased through the browser costs an
afternoon.

**"Make it look better."** Rendering changes go under `packages/render`, must not
touch the simulation, and must not break the tier table in `docs/PERF_BUDGET.md`.

## Working agreements

- **One concern per change.** A tuning change and a refactor in the same commit
  makes the golden diff unreadable.
- **Test the failure, not just the feature.** The six bugs in `AGENTS.md` were found
  by tests written to assert a *promise* (headshot multiplier, "break line of sight",
  chain explosions) rather than a code path.
- **Prefer data over branches.** New behaviour should usually be a new field or a
  new row, not a new `if`.
- **Say what you did not verify.** "Tests pass, I did not play it" is a useful,
  honest sentence. "It works" without either is not.
- **Ask when the answer changes the architecture.** A question costs a message; a
  wrong seam costs a rewrite. If a request implies a new package, a new tick-order
  entry or a change to the command → world contract, stop and ask.

## Anti-patterns (seen and rejected)

| Anti-pattern | Why it is rejected |
| --- | --- |
| Framework creep into `@iron/sim` | the simulation must stay a pure function of commands + seed |
| "Just one global for now" | the prototype died of 40 mutable globals |
| Mocking the simulation in tests | then the tests prove nothing about the game |
| Pixel-diff snapshots as the main e2e strategy | brittle, and they cannot tell you *why* |
| Tuning by vibe | sweeps are cheap; guessing is not |
| Copying asset files into the repo without a licence | legal risk with a long tail |
