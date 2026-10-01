# MCP setup

Model Context Protocol servers extend an agent's reach beyond the repository. The
four families below are the ones this project's workflow is designed around: the
pipeline scripts, the asset ledger and the debug API all exist to be *driven* by a
tool rather than by a human with a mouse.

Nothing here is required to build or run the game. It is what makes "change the art
style and re-export the kits" or "profile the frame and tell me what regressed" a
single instruction instead of an afternoon.

## 1. Blender — authoring and export

| Server | What it gives |
| --- | --- |
| Blender's official MCP server (`blender.org/lab/mcp-server`) | direct control of Blender's Python API from an agent |
| `ahujasid/mcp-for-blender` (community) | scene inspection, object manipulation, screenshots |

Pair it with `tools/blender/*.py`, which are already headless-friendly:

```bash
python tools/blender/conform.py --all
python tools/blender/kit_batch.py --all --dry-run
python tools/blender/kit_batch.py --only plaza_kits
```

An agent with Blender access can model, check conformance, export LODs and update
the licence ledger without a human opening the editor — and the scripts fail loudly
when the art bible is broken, so the result is verifiable rather than a screenshot.

## 2. Chrome DevTools — profiling the real frame

| Server | What it gives |
| --- | --- |
| Chrome DevTools MCP (CDP) | performance traces, console/network inspection, live JS evaluation |
| Playwright MCP (official) | scripted browser interaction, screenshots, accessibility trees |

The game already exposes everything a profiler needs:

```js
__IV__.renderer()      // fps, frameMs, drawCalls, triangles, programs, resolutionScale, particles
__IV__.state()         // tick, wave, objective, player, enemies, barrels, spawn queue
__IV__.fastForward(30) // 30 simulated seconds with the scripted player, no rendering
__IV__.hash()          // deterministic state hash — before/after comparison for a change
__IV__.setQuality('cinematic')
```

A useful trace procedure: `setQuality('high')` → `fastForward(20)` to create load →
record a trace while hostiles, tracers, decals and dust are live → compare
`drawCalls`/`frameMs` against the budget table in `docs/PERF_BUDGET.md`.

## 3. Asset sourcing — 3D content with verifiable licences

| Server | Source | Licence |
| --- | --- | --- |
| Poly Haven downloader MCP | HDRIs, PBR textures, models | CC0 |
| Sketchfab MCP servers | millions of models, licence per model | mixed — check each |
| Meshy MCP / Tripo | text-to-3D generation | generated, check terms |

Workflow: fetch → place in `assets_src/` → write the sidecar → `npm run
assets:pipeline` → `npm run licenses:audit`. The audit is the point: a sourcing tool
that produces a beautiful asset with unclear rights is a liability, and the ledger
row is what forces that question to the surface *now*.

Sketchfab deserves a specific warning: its licence field is per-model and ranges from
CC0 to "no redistribution". Treat anything that is not explicitly CC0/CC-BY as
requiring a human decision, recorded in an ADR.

## 4. Repository — the workflow itself

GitHub MCP (or the CLI) for issues, PRs and CI status. Useful pattern: after a
balance change, open a PR whose description contains the output of
`npm run sweep -- --seeds=12` before and after, so the reviewer reads a distribution
instead of a diff of constants.

## Configuration sketch

Most MCP clients take a JSON block like this (`<...>` = your paths):

```json
{
  "mcpServers": {
    "blender": { "command": "uvx", "args": ["blender-mcp"] },
    "chrome-devtools": { "command": "npx", "args": ["-y", "chrome-devtools-mcp@latest"] },
    "playwright": { "command": "npx", "args": ["-y", "@playwright/mcp@latest"] },
    "polyhaven": { "command": "uvx", "args": ["polyhaven-mcp"] }
  }
}
```

Check each server's own README for the current invocation — this ecosystem moves
weekly, and a stale command in a doc is worse than no command.

## What not to automate

- **Deciding whether an asset's licence is acceptable.** Fetch it, propose it, and
  stop for a human answer.
- **Committing or pushing.** Agents prepare changes; a person ships them.
- **Regenerating the golden hash.** Re-recording `tests/golden/*.hash` is how you
  declare a gameplay change intentional. That is a decision, and the reasoning
  belongs in the commit message.
