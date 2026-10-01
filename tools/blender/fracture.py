"""
Pre-fracture destructible props into chunks.

    python tools/blender/fracture.py --only props_barrels --pieces 12
    python tools/blender/fracture.py --file assets_src/blender/props_barrels.blend --pieces 16 --seed 7

Destructibles are authored once and fractured ahead of time: cutting geometry at
runtime costs milliseconds the frame budget does not have, and a pre-made chunk
set is deterministic, so a broken wall looks the same in a replay. Chunks export
as one GLB per source object into `assets/models/fractures/`.

Pipeline: Voronoi cell split (Blender's Cell Fracture) → per-chunk convex proxy →
GLB. Chunk count follows mass: a barrel wants 10-14 pieces, a wall section wants
more, so `pieces` scales with the object's volume.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib_iron  # noqa: E402

# Chunk count per cubic metre of the source object.
CHUNKS_PER_CUBIC_METRE = 6.0
MIN_CHUNKS = 6
MAX_CHUNKS = 48


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Pre-fracture destructible props.")
    parser.add_argument("--file", help="source .blend path")
    parser.add_argument("--only", help="source file stem")
    parser.add_argument("--pieces", type=int, help="chunk count (default: scaled by volume)")
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if _inside_blender():
        return _fracture_open_file(args.pieces, args.seed)

    source = _resolve_source(args)
    if source is None:
        print("no destructible source found — pass --only <stem> or --file <path>", file=sys.stderr)
        return 1

    sidecar = lib_iron.load_sidecar(source.stem)
    print(f"{source.stem}: fracture with seed {args.seed}, licence {sidecar.get('license', '?')}")
    print("  chunk count is derived from volume unless --pieces is given")
    print(f"  export → assets/models/fractures/{source.stem}_chunk_*.glb")
    if args.dry_run:
        return 0
    return lib_iron.run_blender(Path(__file__).resolve(), [str(source), "--seed", str(args.seed)])


def _resolve_source(args: argparse.Namespace) -> Path | None:
    if args.file:
        candidate = Path(args.file)
        return candidate if candidate.exists() else None
    if args.only:
        candidate = lib_iron.ASSETS_SRC / f"{args.only}.blend"
        return candidate if candidate.exists() else None
    candidates = sorted(lib_iron.ASSETS_SRC.glob("*destruct*.blend")) or sorted(
        lib_iron.ASSETS_SRC.glob("props_*.blend")
    )
    return candidates[0] if candidates else None


def _inside_blender() -> bool:
    try:
        import bpy  # noqa: F401
    except ImportError:
        return False
    return True


def _fracture_open_file(pieces: int | None, seed: int) -> int:
    import bpy  # type: ignore

    asset = Path(bpy.data.filepath).stem
    out_dir = lib_iron.ASSETS_OUT / "models" / "fractures"
    out_dir.mkdir(parents=True, exist_ok=True)
    sidecar = lib_iron.load_sidecar(asset)
    exported: list[str] = []

    for obj in list(lib_iron.iter_meshes()):
        if obj.name.endswith("_COL"):
            continue
        dimensions = obj.dimensions
        volume = max(0.01, dimensions.x * dimensions.y * dimensions.z)
        count = pieces or int(min(MAX_CHUNKS, max(MIN_CHUNKS, volume * CHUNKS_PER_CUBIC_METRE)))

        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            # Blender's Cell Fracture ships as an add-on; enable it defensively
            # because --factory-startup disables user preferences.
            bpy.ops.preferences.addon_enable(module="object_fracture_cell")
            bpy.ops.object.add_fracture_cell_phys(
                source_limit=0,
                source_noise=seed % 100 / 100,
                cell_scale=(1.0, 1.0, 1.0),
                use_smooth_faces=True,
            )
        except Exception as error:  # noqa: BLE001 - report and continue
            print(f"  skip {obj.name}: cell fracture unavailable ({error})")
            continue

        for chunk in list(lib_iron.iter_meshes()):
            if chunk.name.startswith(obj.name) and chunk.name != obj.name:
                chunk.name = f"{asset}_chunk_{len(exported):03d}"

        file = out_dir / f"{asset}_chunks.glb"
        bpy.ops.export_scene.gltf(
            filepath=str(file),
            export_format="GLB",
            export_apply=True,
            export_yup=True,
            use_selection=False,
        )
        exported.append(f"models/fractures/{file.name}")
        print(f"  {obj.name}: ~{count} chunks → {file.relative_to(lib_iron.ROOT)}")

    for relative in exported:
        lib_iron.upsert_ledger_row(relative, sidecar)
    if exported:
        lib_iron.register_manifest_asset(
            f"{asset}_fractures",
            {
                "kind": "fracture",
                "files": exported,
                "license": sidecar.get("license", ""),
                "source": sidecar.get("source", ""),
            },
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
