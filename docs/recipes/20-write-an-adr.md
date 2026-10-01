# Recipe 20 — Write an ADR

**Time:** 20 minutes · **Risk:** none · **Touches:** `docs/decisions/NNNN-slug.md`,
plus whatever the decision implicates (`docs/ARCHITECTURE.md`, `AGENTS.md`)

An ADR records a decision *that is expensive to reverse* and the reasoning that produced
it. `docs/decisions/` is the project's memory: it is where "why is it like this?" gets
answered without archaeology through git history.

## When an ADR is warranted

Write one when the change:

- adds or moves a package boundary, or a new package;
- changes the tick (a new system, a reordering — `AGENTS.md` invariant 2);
- introduces a dependency, a build step or a tool the whole team inherits;
- sets a rule the code cannot enforce (a convention, a policy, a licensing stance);
- rejects an approach a reasonable person would otherwise re-propose in three months.

**Not** warranted for: tuning numbers (→ `docs/BALANCE.md`), a new content row
(→ a recipe), a bug fix, or anything reversible in a small diff.

## Format

Numbers are zero-padded and sequential; never renumber. Keep it short — one page.

```markdown
# ADR-NNNN — <decision as a sentence, not a topic>

**Status:** accepted · **Date:** YYYY-MM-DD

## Context
The forces at play: what problem, what constraints, what was tried.
Numbers where they exist.

## Decision
What we will do, stated so it can be verified against the code.

## Consequences
What becomes easier, what becomes harder, what we now owe.
Include the cost. An ADR with no downside is marketing.

## Alternatives rejected
Each with the reason it lost. This is the section that saves future time.
```

## Steps

1. **Pick the next number** and name the file `NNNN-slug.md` (`0007-two-builds-one-source.md`
   is a good shape: a decision, not a subject).

2. **State the decision in the title** as a claim someone could disagree with
   ("deterministic simulation", not "simulation").

3. **Write honestly.** If the choice was made under time pressure, say so; a future reader
   needs to know whether the reason still holds.

4. **Link it.** Reference the ADR from `docs/ARCHITECTURE.md` and, if the decision becomes
   a rule for contributors, from `AGENTS.md`.

5. **Mark superseded ADRs**, do not delete them: change the status line and add a link to
   the replacement. A reversed decision is the most instructive document in the folder.

## Verify

There is no test for this. The check is a review question: *could a new contributor,
reading only the ADR, predict what the code does and why?* If not, the ADR is not done.

## Existing decisions

`0001` package boundaries · `0002` deterministic simulation · `0003` content as data ·
`0004` strict TypeScript, no framework · `0005` procedural-first art ·
`0006` parity as a target · `0007` two builds, one source · `0008` the scripted player as
tooling · `0009` the `__IV__` debug contract · `0010` synthesised audio baseline.
