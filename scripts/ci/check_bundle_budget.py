#!/usr/bin/env python3
"""Build-stage gate: the shipped bundles stay within their gzip budgets.

Every city page downloads the engine before it can show a map (the city pages load the ES module
build, a third-party embed may load the IIFE from jsDelivr), so their compressed size is a product
property, measured the way a CDN serves it (gzip, level 9). Mapbox GL is not part of it (it is
loaded from api.mapbox.com as the global `mapboxgl`, never bundled), which is exactly what a
sudden jump here would reveal.

`BUDGETS` holds the budget of each bundle; `--budget FILE=KB` overrides or adds one for a run.
Raising a budget is a reviewed change to this table, with the reason in the commit, never a way
to get a build green. A missing bundle is an error: the gate runs after `vite-build`.

Usage: check_bundle_budget.py [--root DIR] [--budget FILE=KB ...]. Exit status: 0 OK, 1 over
budget or missing, 2 usage.
"""

import argparse
import gzip
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

from cilog import get_logger
from cirepo import ROOT

LOG = get_logger("bundle-budget")

KB = 1000
GZIP_LEVEL = 9
# Bundle (repository-relative) -> gzip budget in KB: about 12 % above the M1 build (2026-10-12), so
# growth is a reviewed decision. Mapbox GL is external to both engine builds.
BUDGETS: Mapping[str, int] = {
    # Viewer engine, ES module: what the city pages load (Lit, the M3 kit, zod, the viewer), minified since
    # DECISIONS-for-review.md §17a (92.7 KB on 2026-10-12, 101.0 KB before). The Firebase SDK is its lazy
    # `firebase-sdk-<hash>.js` chunk, fetched only after consent.
    "packages/engine/dist/engine.mjs": 100,
    # Viewer engine, IIFE: the same plus the inlined Firebase SDK (no code splitting in IIFE builds,
    # DECISIONS-for-review.md §13a; 112.0 KB in M1).
    "packages/engine/dist/engine.iife.js": 125,
    # Admin: the engine's kit plus the Firebase SDK and the Setup Assistant.
    "packages/admin/dist/admin.iife.js": 450,
}


def gzip_size(data: bytes) -> int:
    """Bytes after gzip at the CDN's level; `mtime=0` keeps the figure reproducible."""
    return len(gzip.compress(data, compresslevel=GZIP_LEVEL, mtime=0))


def budget_arg(text: str) -> tuple[str, int]:
    """An argparse type: `FILE=KB` with a positive whole number of KB."""
    name, separator, value = text.rpartition("=")
    if not separator or not name or not value.isdigit() or int(value) == 0:
        raise argparse.ArgumentTypeError(f"expected FILE=KB with a positive whole number of KB, got {text!r}")
    return name, int(value)


def check(root: Path, budgets: Mapping[str, int]) -> tuple[list[str], list[str]]:
    """(problems, one report line per bundle)."""
    problems: list[str] = []
    lines: list[str] = []
    for name, budget in sorted(budgets.items()):
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: missing (run the build stage first)")
            continue
        size = gzip_size(path.read_bytes())
        line = f"{name}: {size / KB:.1f} KB gzip (budget {budget} KB)"
        lines.append(line)
        if size > budget * KB:
            problems.append(line)
    return problems, lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the gzip size of the shipped bundles against their budgets.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--budget", action="append", type=budget_arg, default=[], metavar="FILE=KB", help="override or add a budget")
    args = parser.parse_args(argv)
    problems, lines = check(args.root, {**BUDGETS, **dict(args.budget)})
    if problems:
        LOG.error("[bundle-budget] FAILED:\n%s", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[bundle-budget] OK:\n%s", "\n".join(f"  {line}" for line in lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
