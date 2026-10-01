"""
Import Mixamo FBX and retarget it onto the project skeleton.

    python tools/blender/mixamo_retarget.py --fbx ~/Downloads/mixamo/rifle_idle.fbx --clip rifle_idle
    python tools/blender/mixamo_retarget.py --dir ~/Downloads/mixamo --prefix hostile_

Mixamo is free for commercial use but its raw assets may **not** be
redistributed (docs/LICENSING.md). So this script does three things the naive
"drag the FBX into the project" workflow does not:

  1. renames every bone onto the project skeleton (`IK_iron_*`), so animations can
     be blended and retargeted without caring where they came from;
  2. renames the mesh/material to project conventions and strips Mixamo's own
     naming, so no Mixamo-branded identifier ships in the artifact;
  3. writes a `Mixamo-Royalty-Free` ledger row and records that the clip is
     *animation data only* — the character mesh that ships must be a Blender-
     authored model, not the Mixamo download.

Clips land in `assets/models/anims/<asset>.glb`, one GLB per clip so the game can
stream exactly the animations a mission needs.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib_iron  # noqa: E402

# Mixamo bone name -> project skeleton name. Only the bones the rig actually uses.
BONE_MAP = {
    "mixamorig:Hips": "IK_iron_hips",
    "mixamorig:Spine": "IK_iron_spine_01",
    "mixamorig:Spine1": "IK_iron_spine_02",
    "mixamorig:Spine2": "IK_iron_spine_03",
    "mixamorig:Neck": "IK_iron_neck",
    "mixamorig:Head": "IK_iron_head",
    "mixamorig:LeftShoulder": "IK_iron_clavicle_l",
    "mixamorig:LeftArm": "IK_iron_upperarm_l",
    "mixamorig:LeftForeArm": "IK_iron_lowerarm_l",
    "mixamorig:LeftHand": "IK_iron_hand_l",
    "mixamorig:RightShoulder": "IK_iron_clavicle_r",
    "mixamorig:RightArm": "IK_iron_upperarm_r",
    "mixamorig:RightForeArm": "IK_iron_lowerarm_r",
    "mixamorig:RightHand": "IK_iron_hand_r",
    "mixamorig:LeftUpLeg": "IK_iron_thigh_l",
    "mixamorig:LeftLeg": "IK_iron_calf_l",
    "mixamorig:LeftFoot": "IK_iron_foot_l",
    "mixamorig:LeftToeBase": "IK_iron_toe_l",
    "mixamorig:RightUpLeg": "IK_iron_thigh_r",
    "mixamorig:RightLeg": "IK_iron_calf_r",
    "mixamorig:RightFoot": "IK_iron_foot_r",
    "mixamorig:RightToeBase": "IK_iron_toe_r",
}

SIDECAR = {
    "source": "Mixamo (mixamo.com)",
    "author": "Adobe Mixamo",
    "license": "Mixamo-Royalty-Free",
    "retrieved": "2026-09-20",
    "notes": "animation data only; rig renamed to IK_iron_*; character mesh must be Blender-authored",
}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Import and retarget Mixamo clips.")
    parser.add_argument("--fbx", help="a single Mixamo FBX")
    parser.add_argument("--dir", help="a folder of Mixamo FBX files")
    parser.add_argument("--clip", help="clip name for --fbx (defaults to the file stem)")
    parser.add_argument("--prefix", default="", help="prefix for every imported clip")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if _inside_blender():
        return _import_open_file(prefix=args.prefix)

    fbx_files = _collect(args)
    if not fbx_files:
        print("nothing to do: pass --fbx <file> or --dir <folder>", file=sys.stderr)
        return 1

    for fbx in fbx_files:
        clip = f"{args.prefix}{args.clip or fbx.stem}"
        print(f"{fbx.name} → assets/models/anims/{clip}.glb")
        print(f"  bones renamed: {len(BONE_MAP)} · licence: {SIDECAR['license']}")
        if args.dry_run:
            continue
        code = lib_iron.run_blender(
            Path(__file__).resolve(),
            ["--fbx", str(fbx), "--clip", clip, "--inside-blender"],
        )
        if code != 0:
            return code
    return 0


def _collect(args: argparse.Namespace) -> list[Path]:
    if args.fbx:
        candidate = Path(args.fbx).expanduser()
        return [candidate] if candidate.exists() else []
    if args.dir:
        directory = Path(args.dir).expanduser()
        return sorted(directory.glob("*.fbx")) if directory.is_dir() else []
    return []


def _inside_blender() -> bool:
    try:
        import bpy  # noqa: F401
    except ImportError:
        return False
    return True


def _import_open_file(prefix: str = "") -> int:
    import bpy  # type: ignore

    # Blender is launched with the FBX path in argv after `--`.
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    fbx = Path(argv[argv.index("--fbx") + 1])
    clip = argv[argv.index("--clip") + 1] if "--clip" in argv else f"{prefix}{fbx.stem}"

    bpy.ops.import_scene.fbx(filepath=str(fbx), automatic_bone_orientation=True)

    renamed = 0
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE":
            obj.name = f"IK_iron_rig_{clip}"
            for bone in obj.data.bones:
                if bone.name in BONE_MAP:
                    bone.name = BONE_MAP[bone.name]
                    renamed += 1
        elif obj.type == "MESH":
            # The shipped character is Blender-authored; keep the clip's motion and
            # drop the imported mesh so no Mixamo geometry can reach assets/.
            bpy.data.objects.remove(obj, do_unlink=True)

    for action in bpy.data.actions:
        action.name = f"IK_iron_anim_{clip}"

    out_dir = lib_iron.ASSETS_OUT / "models" / "anims"
    out_dir.mkdir(parents=True, exist_ok=True)
    file = out_dir / f"{clip}.glb"
    bpy.ops.export_scene.gltf(
        filepath=str(file),
        export_format="GLB",
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_yup=True,
        use_selection=False,
    )
    print(f"  renamed {renamed} bones → {file.relative_to(lib_iron.ROOT)}")

    relative = f"models/anims/{file.name}"
    lib_iron.upsert_ledger_row(relative, SIDECAR)
    lib_iron.register_manifest_asset(
        clip,
        {
            "kind": "animation",
            "file": relative,
            "license": SIDECAR["license"],
            "source": SIDECAR["source"],
            "bones": renamed,
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
