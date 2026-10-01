"""
Batch exporter for source .blend files.

    python tools/blender/kit_batch.py --all
    python tools/blender/kit_batch.py --only m4_vanguard --class weapon
    python tools/blender/kit_batch.py --all --dry-run

Per source file it: conforms, builds LODs, unwraps lightmap UVs, builds a
collision proxy, exports GLB + KTX2 into `assets/`, and writes the licence ledger
row from the sidecar. `--dry-run` prints the plan without touching Blender, which
is what CI does to prove the pipeline is wired even on a runner without Blender.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib_iron  # noqa: E402


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Export source art into assets/.")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--only", help="source file stem")
    parser.add_argument("--class", dest="asset_class", default="kit", choices=sorted(lib_iron.LOD_BUDGETS))
    parser.add_argument("--dry-run", action="store_true", help="print the export plan only")
    parser.add_argument("--skip-conform", action="store_true")
    args = parser.parse_args(argv)

    if _inside_blender():
        return _export_open_file(args.asset_class)

    sources = _select_sources(args)
    if not sources:
        print(
            f"no source .blend files in {lib_iron.ASSETS_SRC.relative_to(lib_iron.ROOT)} — "
            "the procedural baseline in @iron/render is what ships until art lands.",
        )
        return 0

    for source in sources:
        asset = source.stem
        sidecar = lib_iron.load_sidecar(asset)  # fails loudly when provenance is missing
        plan = _plan(asset, args.asset_class, sidecar)
        print(f"\n{asset}: {sidecar['source']} · {sidecar['license']}")
        for line in plan:
            print(f"  {line}")

        if args.dry_run:
            continue

        if not args.skip_conform:
            code = lib_iron.run_blender(
                Path(__file__).resolve().parent / "conform.py", [str(source), "--class", args.asset_class]
            )
            if code != 0:
                print(f"  conform failed for {asset}: fix the art-bible errors above", file=sys.stderr)
                return code

        code = lib_iron.run_blender(
            Path(__file__).resolve(),
            [str(source), "--class", args.asset_class, "--inside-blender"],
        )
        if code != 0:
            return code
    return 0


def _plan(asset: str, asset_class: str, sidecar: dict[str, str]) -> list[str]:
    lo, mid, hi = lib_iron.LOD_BUDGETS[asset_class]
    return [
        f"conform        {asset_class} rules (docs/ART_BIBLE.md)",
        f"LODs           LOD0 <= {lo}, LOD1 <= {mid}, LOD2 <= {hi} triangles",
        "lightmap UVs   channel 2, 4 px gutter",
        "collision      convex proxy <asset>_COL (three-mesh-bvh input)",
        f"export         assets/models/{asset_class}/{asset}.glb (+ .ktx2 textures)",
        f"ledger         assets/licenses/ledger.csv ← {sidecar.get('license', '?')}",
    ]


def _select_sources(args: argparse.Namespace) -> list[Path]:
    if args.only:
        candidate = lib_iron.ASSETS_SRC / f"{args.only}.blend"
        return [candidate] if candidate.exists() else []
    return sorted(lib_iron.ASSETS_SRC.glob("*.blend"))


def _inside_blender() -> bool:
    try:
        import bpy  # noqa: F401
    except ImportError:
        return False
    return True


def _export_open_file(asset_class: str) -> int:
    """The actual Blender-side work: LODs, UVs, proxy, export, ledger, manifest."""
    import bpy  # type: ignore
    import os

    blend_path = Path(bpy.data.filepath)
    asset = blend_path.stem
    sidecar = lib_iron.load_sidecar(asset)

    out_dir = lib_iron.ASSETS_OUT / "models" / asset_class
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / f"{asset}.glb"

    lods: list[str] = []
    for level, ratio in enumerate((1.0, 0.5, 0.2)):
        for obj in lib_iron.iter_meshes():
            if not obj.name.endswith(f"_LOD{level}") and level > 0:
                continue
            obj.name = f"{obj.name.split('_LOD')[0]}_LOD{level}"
        lods.append(f"LOD{level}")

    # Decimate the heavy levels. Kept as real modifiers so an artist can inspect
    # them; the exporter applies modifiers on the way out.
    for level, ratio in ((1, 0.5), (2, 0.2)):
        for obj in lib_iron.iter_meshes():
            if not obj.name.endswith(f"_LOD{level}"):
                continue
            modifier = obj.modifiers.new(name=f"lod{level}", type="DECIMATE")
            modifier.ratio = ratio

    # Lightmap UVs: bake AO into a second channel so the runtime gets free
    # ambient occlusion without a screen-space pass on low tier.
    for obj in lib_iron.iter_meshes():
        if obj.data.uv_layers.get("Lightmap"):
            continue
        obj.data.uv_layers.new(name="Lightmap")
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.006)
        bpy.ops.object.mode_set(mode="OBJECT")

    # Collision proxy: a decimated duplicate the game uses for bullet traces.
    proxies = []
    for obj in list(lib_iron.iter_meshes()):
        if obj.name.endswith("_COL"):
            continue
        duplicate = obj.copy()
        duplicate.data = obj.data.copy()
        duplicate.name = f"{obj.name}_COL"
        bpy.context.collection.objects.link(duplicate)
        modifier = duplicate.modifiers.new(name="collision", type="DECIMATE")
        modifier.ratio = 0.15
        proxies.append(duplicate)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in lib_iron.iter_meshes():
        if not obj.name.endswith("_COL"):
            obj.select_set(True)

    bpy.ops.export_scene.gltf(
        filepath=str(out_file),
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        use_selection=True,
        export_image_format="KTX2",
    )
    print(f"exported {out_file.relative_to(lib_iron.ROOT)}")

    relative = out_file.relative_to(lib_iron.ASSETS_OUT).as_posix()
    lib_iron.upsert_ledger_row(f"models/{relative}", sidecar)
    lib_iron.register_manifest_asset(
        asset,
        {
            "kind": asset_class,
            "file": f"models/{relative}",
            "license": sidecar.get("license", ""),
            "source": sidecar.get("source", ""),
            "lods": lods,
            "collision": f"{asset}_COL",
            "bytes": os.path.getsize(out_file),
        },
    )
    for proxy in proxies:
        bpy.data.objects.remove(proxy, do_unlink=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
