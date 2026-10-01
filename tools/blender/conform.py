"""
Art-bible conformance check for source .blend files.

Run from a normal shell (the script re-invokes Blender itself):

    python tools/blender/conform.py --all
    python tools/blender/conform.py --only props_barrels

Inside Blender it checks every mesh object against the rules in
docs/ART_BIBLE.md and prints a report. Rules exist because these are the mistakes
that cost a day each:

  * a crate authored 3 units tall that reads as a 3-metre crate in game
  * an origin in the middle of a prop, so placement is off by half its height
  * `Material.001`, which the surface->FX lookup cannot map to an impact effect
  * a 40k-triangle barrel, because nobody was watching the budget
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lib_iron  # noqa: E402  (path juggling has to come first)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Check source art against the art bible.")
    parser.add_argument("--all", action="store_true", help="check every source file")
    parser.add_argument("--only", help="source file stem, e.g. props_barrels")
    parser.add_argument("--class", dest="asset_class", default="prop_small", choices=sorted(lib_iron.LOD_BUDGETS))
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    if _inside_blender():
        return _check_open_file(args.asset_class, args.quiet)

    targets = _select_sources(args)
    if not targets:
        # Not an error: the project ships a procedural baseline and art lands
        # later, so CI must stay green on a checkout with no source art yet.
        print(
            f"no source .blend files in {lib_iron.ASSETS_SRC.relative_to(lib_iron.ROOT)} — "
            "nothing to conform (the procedural baseline in @iron/render is in use)."
        )
        return 0

    worst = 0
    for source in targets:
        code = lib_iron.run_blender(
            Path(__file__).resolve(),
            [str(source), "--class", args.asset_class] + (["--quiet"] if args.quiet else []),
        )
        worst = max(worst, code)
    return worst


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


def _check_open_file(asset_class: str, quiet: bool) -> int:
    """Runs inside Blender against whatever file was opened."""
    import bpy  # type: ignore

    budget = lib_iron.LOD_BUDGETS[asset_class]
    failures = 0

    for obj in lib_iron.iter_meshes():
        report = lib_iron.ConformReport(asset=obj.name)
        report.triangles = sum(len(poly.vertices) - 2 for poly in obj.data.polygons)

        # 1. Scale sanity.
        height = obj.dimensions.z
        low, high = lib_iron.HEIGHT_SANITY
        if height < low or height > high:
            report.errors.append(f"height {height:.2f} m is outside {low}–{high} m")

        # 2. Origin at the ground contact point: min Z should sit at 0 for props.
        if obj.name.endswith("_PROP") or asset_class.startswith("prop"):
            min_z = min((obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices)
            if abs(min_z) > 0.02:
                report.errors.append(f"origin is {min_z:+.3f} m off the ground (expected 0)")

        # 3. Applied transforms: un-applied scale silently rescales lightmaps and LODs.
        if any(abs(value - 1.0) > 1e-4 for value in obj.scale):
            report.errors.append(f"unapplied scale {tuple(round(v, 3) for v in obj.scale)}")
        if obj.rotation_euler[:] != (0.0, 0.0, 0.0):
            report.warnings.append("unapplied rotation")

        # 4. Material naming: SURFACE_<surface-id>, so impacts know what they hit.
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                report.errors.append("empty material slot")
                continue
            report.materials.append(material.name)
            if not material.name.startswith("SURFACE_"):
                report.errors.append(f"material '{material.name}' must be named SURFACE_<surface-id>")
            elif material.name.lower().endswith((".001", ".002")):
                report.errors.append(f"duplicated material '{material.name}' — deduplicate your slots")

        # 5. Triangle budget for LOD0.
        if report.triangles > budget[0]:
            report.errors.append(f"{report.triangles} triangles exceeds the LOD0 budget {budget[0]}")
        elif report.triangles > budget[0] * 0.8:
            report.warnings.append(f"{report.triangles} triangles is close to the LOD0 budget")

        # 6. UV presence: without UVs there is no lightmap and no texture at all.
        if not obj.data.uv_layers:
            report.errors.append("no UV map")

        if not report.ok:
            failures += 1
        if not quiet:
            print(report.summary())

    if failures == 0 and not quiet:
        print(f"conformance OK ({len(list(lib_iron.iter_meshes()))} meshes)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
