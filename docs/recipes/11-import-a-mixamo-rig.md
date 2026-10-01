# Recipe 11 — Import a Mixamo animation

**Time:** ~45 minutes · **Risk:** medium (licensing, not tech) ·
**Touches:** `tools/blender/mixamo_retarget.py`, `assets/models/anims/*`,
`assets/licenses/ledger.csv`

Mixamo is free for commercial use, but its *raw assets may not be redistributed*. The
safe reading — and the project's rule — is:

> Use Mixamo for **animation data**. Ship **Blender-authored character meshes** driven by
> retargeted clips. Never ship Mixamo's character mesh or its branded bone names.

`tools/blender/mixamo_retarget.py` mechanises exactly that.

## Steps

1. **Download the clip from Mixamo** with the character set to *None* (animation only)
   and "in place" for anything that will be blended. FBX, without skin, 30 fps.

2. **Retarget it onto the project skeleton:**

   ```bash
   export BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"
   python tools/blender/mixamo_retarget.py --fbx ~/Downloads/mixamo/rifle_idle.fbx --clip rifle_idle
   ```

   Or a whole folder at once:

   ```bash
   python tools/blender/mixamo_retarget.py --dir ~/Downloads/mixamo --prefix hostile_
   ```

   The script renames every bone via `BONE_MAP` (`mixamorig:LeftArm` →
   `IK_iron_upperarm_l`), renames the mesh/material, strips Mixamo identifiers, and
   writes a `Mixamo-Royalty-Free` ledger row recording that this is animation data
   only. One GLB per clip lands in `assets/models/anims/`, so a mission streams only
   the clips it needs.

3. **Check the bone map covers the clip.** A clip using bones absent from `BONE_MAP`
   retargets partially and animates wrong in a way that is easy to miss at small
   scale. The script reports unmapped bones; **do not** ship a clip with unmapped
   bones — extend `BONE_MAP` instead.

4. **Register the clip in `assets/manifest.json`** and reference it from the entity
   that plays it. Today the renderer's procedural humanoids use code-driven poses;
   wiring a clip means the animation layer, not the simulation (AGENTS.md invariant 4
   — presentation only).

5. **Check the in-place rule.** Root-motion clips will drift the visual away from the
   simulation's position, and the simulation owns position. Bake root motion out or
   let the AI's own movement drive the pose.

## Verify

```bash
npm run assets:validate
npm run licenses:audit        # the ledger row must exist and say "animation data only"
npm run build && npm run test:e2e
```

Play it and watch a hostile from the side: foot sliding and a translated root are the
two tells that retargeting went wrong.

## Traps we have hit

- **Redistributing the Mixamo character.** The most serious mistake available in this
  project. If a `Mixamo` mesh or `mixamorig` bone name appears in an exported GLB, that
  is a licensing incident, not a bug.
- **Frame rate mismatch.** Mixamo exports at 30 fps; the game runs at 60 Hz ticks. Clip
  playback is presentation-time, so it needs to be frame-rate independent — never
  advance animation by tick count.
- **Clips that assume the Mixamo proportions.** Retargeting to a different rig length
  can over-extend knees and elbows; if a pose looks broken, the fix is IK/rest-pose
  adjustments on the project skeleton, not editing the clip.
