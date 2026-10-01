"""
Shared helpers for the IRON VANGUARD Blender pipeline.

Imported by the other scripts in this folder. Runs inside Blender's bundled
Python, so it may import `bpy` but must not import anything else exotic.
"""

from __future__ import annotations

import csv
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# --------------------------------------------------------------------------- #
# Paths
# --------------------------------------------------------------------------- #

ROOT = Path(__file__).resolve().parents[2]
ASSETS_SRC = ROOT / "assets_src" / "blender"
ASSETS_OUT = ROOT / "assets"
LEDGER = ASSETS_OUT / "licenses" / "ledger.csv"
MANIFEST = ASSETS_OUT / "manifest.json"

LEDGER_HEADER = ["file", "source", "author", "license", "retrieved", "notes"]

# --------------------------------------------------------------------------- #
# Art bible budgets — mirrored in docs/ART_BIBLE.md
# --------------------------------------------------------------------------- #

# Triangle budget per LOD, per asset class. Mirrors docs/PERF_BUDGET.md.
LOD_BUDGETS: dict[str, list[int]] = {
    "weapon": [12_000, 5_000, 1_500],
    "character": [18_000, 8_000, 2_500],
    "prop_small": [2_000, 800, 300],
    "prop_large": [8_000, 3_000, 900],
    "kit": [4_000, 1_500, 500],
}

# Metres. Everything is 1 unit = 1 metre; a 5 m wall must be 5 units tall.
HEIGHT_SANITY = (0.2, 30.0)


@dataclass
class ConformReport:
    """Result of checking one object against the art bible."""

    asset: str
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    triangles: int = 0
    materials: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors

    def summary(self) -> str:
        state = "OK" if self.ok else "FAIL"
        parts = [f"[{state}] {self.asset} ({self.triangles} tris)"]
        parts += [f"  error: {message}" for message in self.errors]
        parts += [f"  warn:  {message}" for message in self.warnings]
        return "\n".join(parts)


# --------------------------------------------------------------------------- #
# Blender helpers
# --------------------------------------------------------------------------- #


def require_blender() -> "object":
    """Import bpy or exit with a helpful message."""
    try:
        import bpy  # type: ignore
    except ImportError:  # pragma: no cover - only hit outside Blender
        print(
            "This script must run inside Blender:\n"
            '  blender --background --python tools/blender/kit_batch.py -- --all\n'
            "or set BLENDER_BIN and let kit_batch.py drive it.",
            file=sys.stderr,
        )
        raise SystemExit(2)
    return bpy


def run_blender(script: Path, args: list[str]) -> int:
    """
    Re-invoke a pipeline script under Blender's own Python.

    The tools are written so they can *also* be driven from a plain `python`
    invocation (what `npm run assets:pipeline` does), which is friendlier for
    agents and CI: this is the shim that makes that work.
    """
    blender = os.environ.get("BLENDER_BIN") or os.environ.get("BLENDER")
    if not blender:
        print(
            "BLENDER_BIN is not set, so the asset pipeline cannot run.\n"
            "Set it to the Blender executable, e.g.\n"
            '  export BLENDER_BIN="/c/Program Files/Blender Foundation/Blender 4.2/blender.exe"\n'
            "Then re-run: npm run assets:pipeline",
            file=sys.stderr,
        )
        return 2
    command = [blender, "--background", "--factory-startup", "--python", str(script), "--", *args]
    print("$", " ".join(f'"{part}"' if " " in part else part for part in command))
    return subprocess.call(command)


def triangle_count(obj: object) -> int:
    """Triangle count of the base mesh. Good enough for a budget check."""
    return sum(len(polygon.vertices) - 2 for polygon in obj.data.polygons)  # type: ignore[attr-defined]


def iter_meshes():
    import bpy  # type: ignore

    for obj in bpy.data.objects:
        if obj.type == "MESH":
            yield obj


# --------------------------------------------------------------------------- #
# Licence ledger
# --------------------------------------------------------------------------- #


def read_ledger() -> list[dict[str, str]]:
    if not LEDGER.exists():
        return []
    with LEDGER.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def write_ledger(rows: list[dict[str, str]]) -> None:
    LEDGER.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_HEADER)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in LEDGER_HEADER})


def upsert_ledger_row(relative_file: str, sidecar: dict[str, str]) -> None:
    """Add or update one asset's provenance. Called for every exported file."""
    rows = [row for row in read_ledger() if row.get("file") != relative_file]
    rows.append(
        {
            "file": relative_file,
            "source": sidecar.get("source", ""),
            "author": sidecar.get("author", ""),
            "license": sidecar.get("license", ""),
            "retrieved": sidecar.get("retrieved", ""),
            "notes": sidecar.get("notes", ""),
        }
    )
    rows.sort(key=lambda row: row["file"])
    write_ledger(rows)


def load_sidecar(asset_name: str) -> dict[str, str]:
    """
    Read `assets_src/blender/<asset>.license.json`.

    A missing sidecar is a hard error: an asset with unknown provenance must not
    reach `assets/`.
    """
    path = ASSETS_SRC / f"{asset_name}.license.json"
    if not path.exists():
        raise SystemExit(
            f"missing licence sidecar: {path.relative_to(ROOT)}\n"
            "Every source asset needs one. See docs/LICENSING.md for the fields."
        )
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


# --------------------------------------------------------------------------- #
# Manifest
# --------------------------------------------------------------------------- #


def load_manifest() -> dict:
    if MANIFEST.exists():
        with MANIFEST.open(encoding="utf-8") as handle:
            return json.load(handle)
    return {"version": 1, "assets": {}}


def save_manifest(manifest: dict) -> None:
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    manifest["assets"] = dict(sorted(manifest.get("assets", {}).items()))
    with MANIFEST.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")


def register_manifest_asset(asset_id: str, entry: dict) -> None:
    manifest = load_manifest()
    manifest.setdefault("assets", {})[asset_id] = entry
    save_manifest(manifest)
