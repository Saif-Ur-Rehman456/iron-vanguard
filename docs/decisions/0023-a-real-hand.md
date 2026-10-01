# ADR-0023 — A real hand, and the instrument that can measure one

Status: accepted. Supersedes nothing; extends ADR-0014 (the weapon rig) to the part of the
view model that holds it.

## Context

The standing review is a loop: open the game, play it, screenshot it, find everything
wrong, fix it, verify, repeat. Its first concrete complaint is the one this ADR answers:

> *our own 3D model's hand and arm are still not realistic — their shapes are not real.*

That is a claim about a shape, so the first job was to make it a claim about a number. Two
instruments were built for it, both in `.captures/` (gitignored, and not part of the shipped
build):

- **`mask.py`** — difference two frames of the *same* pose, one with the view model hidden,
  and the resulting mask is exactly the pixels the view model covers. It then reports a
  gradient-orientation histogram over that mask: `axis` is the share of edge energy within
  ±12° of horizontal or vertical, `curve` the smooth-outline tail, `fill` the mask's share of
  its own bounding box, and `lobes` the number of connected components. A cube face is
  `axis ≈ 1.0`; a sphere is `≈ 0.44`; a box-built hand measures higher than either because
  most of its edges are perpendicular *and* it fills its box.
- **`shape.py`** — the same histogram over a named region of one frame, for the world.

Measured, the old hand was: one `roundedBox` for the palm, **four identical boxes** for the
fingers (two per finger — same length, same thickness, no taper, no curl), one box for the
thumb, and a `chamferedCylinder` for the wrist. The enemy's "hand" was a single
`roundedBox(0.09, 0.1, 0.13)`. The isolated view model measured `axis = 0.44`, `fill = 0.67`.

The lesson is the same one ADR-0021 records about `bevelFor`: none of this is fixable by
adding detail. A hand does not read as a hand because it has more boxes in it.

## Decision

**One hand, built from anatomy, in one module, shared by the player and the enemies.**
`packages/render/src/characters/hand.ts` holds:

1. **A table of real proportions** (`HAND`): palm 99 × 76 × 26 mm, hand breadth 89 mm
   counted as the anthropometry tables mean it, four fingers of three phalanges with the
   textbook lengths (middle 90 mm > ring 83 > index 81 > little 68), a 9% taper per phalanx,
   a thenar mass, and a glove pad of 4 mm added by the builder rather than hidden in the table.

2. **A forward-kinematic chain per finger**, `chain(base, start, lengths, joints)`, with
   `joints[i]` bending the joint *before* phalanx `i`.

3. **A solved grip, not a tuned one.** A bar held in a fist is tangent to the proximal and
   the middle phalanx at once, so its axis is where those two lines cross once each is offset
   inward by the bar's radius plus half a finger (`fitAxis`). Given that axis, how far each
   finger closes is whatever puts *that* fingertip on the bar's surface (a 40-step binary
   search per finger, inside a 6-pass fixed point with the axis fit). The four fingers close
   by four different amounts, which is the whole point: a 68 mm little finger reaches the
   surface with less wrap than a 90 mm middle finger.

4. **A thumb solved by two-bone IK** (`solveTwoBone`) onto the point on the bar's surface
   diametrically opposite the middle of the fingertips. Opposition is the one thing that
   separates a grip from a basket, and hand-tuned flexion ratios could not express it.

5. **`handShape()` is pure arithmetic** — no three, no GPU, no scene — and `handProblems()`
   states the contract on it: hand size, palm taper, a flattened wrist, three phalanges per
   digit, four different finger lengths in the right order, a taper in every finger, every
   fingertip *on* the surface of what is held rather than beside it or through it, the thumb
   at least a quarter turn around the bar from a fingertip, and the closing amounts inside
   the range a hand can reach.

**The hand's own space is `x` = along the grip with the thumb side positive, `y` = out
through the knuckles, `z` = **toward the palm**, and a caller mounts it with three explicit
directions** (`mountHand`, checked by `mountProblems`). The z direction is a handedness
decision, not a labelling one: `(thumb, knuckles, back-of-hand)` is a *left*-handed triple for
a right hand, so every caller would have had to mount a right hand with a mirroring matrix —
and a mirroring matrix produces a left hand.

**The measurement instrument is part of the renderer's debug surface.** `viewModel(false,
false)` hides the weapon and leaves the hands and arms; that is what makes a hand measurable
at all, because the weapon is one large axis-aligned mass and a crop around the hand at a hip
carry comes back 98% filled with no silhouette in it.

## Consequences

- A hand is now a single object in one place. The enemy's is next: `enemyView.ts` still builds
  its own box, and the module exists so that the two cannot drift.
- Every fingertip's position is a solved number, so "the hand is not holding the weapon" is a
  test failure with a distance in millimetres rather than a review note.
- `weaponDebug().joints` reports true world positions for all eight joints. Four of them
  (`elbowLeft/Right`, `wristLeft/Right`) were previously detached from the graph, so the
  readout published camera-local coordinates under a world-space key and projecting any of
  them returned the camera's own position.
- The view-model light means hiding the view model changes the world's illumination within
  2 m, so a difference mask carries a low-amplitude wash everywhere. The mask's *lobe* and
  orientation statistics are unaffected; its raw area is not a clean measure of coverage.
- Honest gaps, recorded rather than papered over: the shape contract is geometric and is
  checked without a renderer, so it cannot see a *material* problem; and no human has looked
  at a frame of this pass yet — `docs/CAPTURE_REQUEST.md` phase 11 is the checklist for that.
