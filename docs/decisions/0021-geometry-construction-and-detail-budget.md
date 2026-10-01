# ADR-0021 — Geometry is construction, and detail follows importance

Status: accepted (eighth review, PHASE 04)

## Context

The eighth report is eighteen items about *shapes*, and its framing is the useful part:

> *"Tumhari current game mein kaafi objects technically present hain, lekin unki shapes aur
> physical construction abhi simple hain. Isi wajah se lighting aur materials improve karne ke
> baad bhi kuch objects low-quality nazar aa sakte hain."*

That is a correct diagnosis of a specific failure mode: the material pass can make a surface
believable, and no material can make a *box* read as architecture. Its items divide into four
groups, and only one of them is "add more triangles":

1. **Objects with no construction.** Buildings are boxes with window plates on them; a car is one
   extruded profile; a barrier is one extrusion repeated exactly; the ground is a plane with props
   standing on it (items 1, 4, 5, 7, 8, 11, 12).
2. **Edges and parts that cannot hold light.** Mathematically sharp edges, and — this is the part
   nobody had measured — small parts rounded into lozenges by a bevel rule that was a third of
   the part (items 2, 6).
3. **Detail spent uniformly** instead of by importance: every object given the same treatment, or
   every object kept low (items 9, 14).
4. **Procedural repetition**: identical orientation and shape everywhere, and fine detail that
   should have been geometry faked into a texture (items 10, 13).

And behind all of it, the paragraph at the end of the report: *"pichle phase mein tum na bohat se
galtiyan ke hain jis se game ka graphics nihayat hi kharab ho gae hain."* Reviewing the previous
pass for exactly that found four defects, three of which were introduced by it — a grime band that
was a belt floating around every building, a car's contact patch and rocker band twice the car's
width, and the bevel rule above. They are AGENTS.md entries 35–38, and fixing them is the first
half of this pass.

## Decision

### 1. A bevel is a rule, not a number (`geometry.bevelFor`)

The corner radius of a hard edge is a *small share of the part it belongs to*: a machined part at
60 mm keeps a 7 mm round, a cast concrete panel at 2 m keeps 3 cm, a 4 mm plate is nearly sharp.
The shipped rule was `min(radius, smallest / 3)`, which is a self-intersection guard used as an
aesthetic one — so a 60 mm detail box got a 20 mm radius. Now:

```
r = clamp(min(requested, smallest * BEVEL_SHARE /* 0.12 */), floor 0.5 mm)
r = min(r, smallest / 3)          // the guard, applied last
```

The order matters and the first version of the fix got it wrong: with the floor folded into the
`min`, a 4 mm plate got a 1.5 mm radius — half the "one third" limit it was supposed to respect,
and the test caught it as `0.004 m: expected 0.0015 to be less than or equal to 0.0013333`. A rule
that can violate its own limit near zero is not a rule.

### 2. Detail follows what an asset is *for* (`level/detail.ts`)

`DETAIL: Record<AssetTier, DetailBudget>` — `hero` / `mid` / `far`, each with a bevel, a segment
count, whether secondary forms are built at all, and a one-line *why* so a mis-assignment is
visible in review. It is data for the same reason a surface class is (ADR-0020): it is a property
of the asset's role, and every place that builds that asset has to agree on it.

What it decides is deliberately narrow, and one thing it may **not** decide is the look: a quality
tier cannot read `DETAIL` (ADR-0014/0017), because a player on `low` is looking at the same world.
`tierBevel` applies the same share rule inside a tier, so a hero asset's 2 cm round cannot melt a
20 mm screw.

Consumed today by: the car's hardware (`DETAIL.hero.secondary`), building facades
(`DETAIL.mid`), and the barrier/road detail (mid). The test asserts the ordering
(hero ≥ mid ≥ far in detail, far with no secondary forms) rather than the assignments.

### 3. An opening is construction, not a decal (`arena.windowConstruction`)

A building shell is one solid box, so a real hole is not available and a pane set *behind* the wall
plane is inside the building. The shipped attempt at depth got it exactly backwards: a concrete
"reveal" stood proud of the wall and the glass was placed **9 cm in front of it**, so the glass
covered its own frame and every window was a dark plate 15 cm off the facade.

The construction is now a lintel and a sill proud of the wall, with the pane's front face 1–2 cm
off the wall — `14–18 cm behind the outer edge of its own frame`. That distance *is* the reveal:
what the eye reads as a hole is the shadow between the glass and the thing overhanging it. The
invariants are asserted as data (`pane front < frame front` by ≥ 0.1 m, lintel bottom edge = pane
top edge, sill top edge = pane bottom edge, frame wider than the opening, frame seated in the wall
rather than floating off it).

### 4. A building is its attached forms (`arena.buildFacadeDetail`)

An entrance with jambs, a lintel and a *canopy on braced struts*; a service box and a louvred
grille; a balcony with a slab, a rail and brackets (on some blocks, on one storey); pilasters on
the tall blocks. Deterministic from the arena RNG, guarded by `DETAIL.mid.secondary`, and placed at
different heights and positions per building — so two buildings of the same facade variant are two
buildings.

The principle, stated once because it is the answer to items 1, 7, 8 and 12: **an attached form
casts its own shadow, and that shadow is what reads as architecture from 20 m, where no texture
can.** The same argument added the monument's setting (a paved apron, a ring of bollards, two
benches), because a landmark is not the object in the middle — it is the setting the object was
designed to stand in.

### 5. A street is not cast in one piece (items 3, 4, 10)

Kerbs are ten segments per side with a centimetre of line variation, one in six broken with its
foot showing; a gutter line of grime runs along each; barriers take their profile from the RNG and
one in three has a spalled corner; sand accumulates around the sandbag stacks as low drifts. None
of it is a new texture and none of it changes a collision volume.

### 6. Geometry or texture (item 13)

The rule the review asked for, adopted as the pass's line: **anything that changes a silhouette or
casts a shadow is geometry; anything read only as surface variation is the normal/roughness map or
a decal.** A window reveal, a canopy, a mirror, an arch lip and a broken kerb are geometry. Grain,
stains, wear and burn marks are not (ADR-0020).

## Consequences

- **Cost, stated:** the arena gains roughly 200 small batched forms per plaza (facade detail ~20
  per building, ~46 kerb segments and gutters, ~40 car parts per wreck, 11 monument forms, three
  sand drifts per stack). They land in the existing static batch, so draw calls do not move; what
  moves is triangles, which the in-app devtools overlay asserts against its budget. The bevel rule
  *reduces* geometry on small parts (a 12% share instead of a third), so the two roughly cancel on
  the props the player can reach.
- **The look is unchanged by a tier**, and `npm run replay` still reports the same 162 samples: all
  of this is presentation.
- **New rules that fail the build:** a bevel that exceeds a third of a part at any size, a tier
  whose detail is not ordered, a far tier with secondary forms, a window whose glass is not behind
  its frame, a window whose frame covers its own opening, and a pane placed inside the building.
- **Known gaps, kept visible:** the weapon's own close-up hardware (item 6) is unchanged — it is
  per-archetype with real bevels and iron sights since ADR-0019, and this pass did not add screws
  and magazine ribs to it; the ground is still a plane away from the sandbag stacks (item 11's
  terrain variation is present where props disturb the ground and absent across open paving); and
  the skyline does not yet use the `far` tier's simplification (item 16 from ADR-0020).
