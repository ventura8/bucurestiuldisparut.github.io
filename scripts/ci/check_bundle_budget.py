#!/usr/bin/env python3
"""Build-stage gate: the shipped bundles stay within their gzip budgets.

Every city page downloads the engine before it can show a map (the city pages load the ES module
build, a third-party embed may load the IIFE from jsDelivr), so their compressed size is a product
property, measured the way a CDN serves it (gzip, level 9). Mapbox GL is not part of it (it is
loaded from api.mapbox.com as the global `mapboxgl`, never bundled), which is exactly what a
sudden jump here would reveal.

The admin is an ES module entry with lazy chunks (DECISIONS-for-review.md §34b): each editor area,
Terra Draw, the colour library and the analytics SDK are fetched when first needed. Its budget has
three parts:

- the entry: `admin.mjs` and every chunk it imports statically, which the browser loads before the
  admin shows anything (`ADMIN_ENTRY_KB`);
- every other chunk, by its name without the content hash, against its own budget
  (`ADMIN_CHUNK_BUDGETS`); a chunk without a budget fails, so a new chunk is a reviewed decision;
- everything together (`ADMIN_TOTAL_KB`), so many small chunks cannot grow unnoticed.

`BUDGETS` holds the budget of each single-file bundle; `--budget FILE=KB` overrides or adds one for
a run. Raising a budget is a reviewed change to these tables, with the reason in the commit, never
a way to get a build green. A missing bundle is an error: the gate runs after `vite-build`.

Usage: check_bundle_budget.py [--root DIR] [--budget FILE=KB ...]. Exit status: 0 OK, 1 over
budget or missing, 2 usage.
"""

import argparse
import gzip
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
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
}

# The admin's build folder and its entry (packages/admin/vite.config.ts).
ADMIN_DIR = "packages/admin/dist"
ADMIN_ENTRY = "admin.mjs"
# The entry and its static imports (the shell, Setup, the Firebase SDK, Lit, the kit, the texts): the budget the IIFE
# had (450 KB), now for what loads before the admin shows (353.9 KB on 2026-10-18).
ADMIN_ENTRY_KB = 450
# Each lazy chunk by name -> gzip budget in KB: the measurement of 2026-10-18 plus about 20 % headroom, rounded up
# (DECISIONS-for-review.md §34b lists the measurement).
ADMIN_CHUNK_BUDGETS: Mapping[str, int] = {
    # The editor areas (packages/admin/src/pages/<area>.ts: the page's elements and the store's module).
    "photos": 25,
    "pois": 25,
    "settings": 20,
    "layers": 10,
    "history": 8,
    "admins": 6,
    "home": 5,
    "jobs": 5,
    "crashes": 5,
    # M3 (docs/research/M3-interfaces.md §10.1, DECISIONS-for-review.md §47): the Imagery area (15.2 KB measured on
    # 2026-10-23), the georeferencer (14.0 KB) and the layer editor's Crop (`layer-geometry`, 1.9 KB), each the measurement
    # plus about 20 %, under the contract's ceilings of 30, 30 and 8 KB.
    "imagery": 18,
    "georef": 17,
    "layer-geometry": 3,
    # What two or more areas share and the entry does not (the codeSplitting group `editor-shared`).
    "editor-shared": 13,
    # The admin map's box and the content it draws (the group `admin-map`): 7.4 KB measured on 2026-10-18, when the
    # settings page's map made the places' and photos' map modules shared (DECISIONS-for-review.md §42a).
    "admin-map": 9,
    # Terra Draw 1.37.0 and its Mapbox GL adapter (the group `terra-draw`), on the first drawing tools.
    "terra-draw": 58,
    # @material/material-color-utilities (`@hcm/ui/dynamic-color`), for the city's theme.
    "dynamic-color": 24,
    # Firebase Analytics, only after consent.
    "analytics-sdk": 8,
}
# The entry and every chunk together.
ADMIN_TOTAL_KB = 620

# A chunk's file name: its name, a dash and the content hash (Rolldown's `[name]-[hash].js`).
CHUNK_NAME = re.compile(r"^(?P<name>.+)-[\w-]{8}\.js$")
# A static import or re-export of a sibling chunk (`import{…}from"./x.js"`, `import"./x.js"`); `import("…")` is lazy.
STATIC_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*["']\./(?P<file>[\w.-]+\.m?js)["']""")


def gzip_size(data: bytes) -> int:
    """Bytes after gzip at the CDN's level; `mtime=0` keeps the figure reproducible."""
    return len(gzip.compress(data, compresslevel=GZIP_LEVEL, mtime=0))


def budget_arg(text: str) -> tuple[str, int]:
    """An argparse type: `FILE=KB` with a positive whole number of KB."""
    name, separator, value = text.rpartition("=")
    if not separator or not name or not value.isdigit() or int(value) == 0:
        raise argparse.ArgumentTypeError(f"expected FILE=KB with a positive whole number of KB, got {text!r}")
    return name, int(value)


def report_line(name: str, size: int, budget: int) -> str:
    return f"{name}: {size / KB:.1f} KB gzip (budget {budget} KB)"


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
        line = report_line(name, size, budget)
        lines.append(line)
        if size > budget * KB:
            problems.append(line)
    return problems, lines


def chunk_name(file: str) -> str:
    """`photos-Ab3_x9Yz.js` -> `photos`; a file without a hash keeps its own name."""
    match = CHUNK_NAME.match(file)
    return match.group("name") if match else file


def entry_files(folder: Path, entry: str) -> list[str]:
    """The entry and every chunk it imports statically, transitively, in the order found."""
    found = [entry]
    for file in found:
        path = folder / file
        text = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
        found.extend(match["file"] for match in STATIC_IMPORT.finditer(text) if match["file"] not in found)
    return found


@dataclass(frozen=True)
class AdminBudgets:
    entry_kb: int
    chunks: Mapping[str, int]
    total_kb: int


ADMIN_BUDGETS = AdminBudgets(ADMIN_ENTRY_KB, ADMIN_CHUNK_BUDGETS, ADMIN_TOTAL_KB)


def within(line: str, size: int, budget: int) -> list[str]:
    """[line] when `size` is over `budget` KB, else []."""
    return [line] if size > budget * KB else []


def chunk_report(file: str, size: int, budgets: Mapping[str, int]) -> tuple[list[str], str]:
    """(problems, the report line) of one lazy chunk."""
    name = chunk_name(file)
    budget = budgets.get(name)
    if budget is None:
        line = f"{ADMIN_DIR}/{file}: {size / KB:.1f} KB gzip, a chunk without a budget (add `{name}` to ADMIN_CHUNK_BUDGETS)"
        return [line], line
    line = report_line(f"{ADMIN_DIR}/{file}", size, budget)
    return within(line, size, budget), line


def admin_sizes(folder: Path) -> dict[str, int]:
    """The gzip size of every script of the admin's build, by file name."""
    return {path.name: gzip_size(path.read_bytes()) for path in sorted([*folder.glob("*.js"), *folder.glob("*.mjs")])}


def entry_report(entry: Sequence[str], sizes: Mapping[str, int], budget: int) -> tuple[list[str], list[str]]:
    """(problems, [the report line]) of the entry and the chunks it imports statically."""
    size = sum(sizes[file] for file in entry)
    line = report_line(f"{ADMIN_DIR}/{ADMIN_ENTRY} with {len(entry) - 1} static chunk(s)", size, budget)
    return within(line, size, budget), [line]


def check_admin(root: Path, budgets: AdminBudgets = ADMIN_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of the admin's entry, each lazy chunk and the whole."""
    folder = root / ADMIN_DIR
    if not (folder / ADMIN_ENTRY).is_file():
        return [f"{ADMIN_DIR}/{ADMIN_ENTRY}: missing (run the build stage first)"], []
    sizes = admin_sizes(folder)
    entry = [file for file in entry_files(folder, ADMIN_ENTRY) if file in sizes]
    problems, lines = entry_report(entry, sizes, budgets.entry_kb)
    for file in sorted(set(sizes) - set(entry)):
        chunk_problems, line = chunk_report(file, sizes[file], budgets.chunks)
        problems += chunk_problems
        lines.append(line)
    total = sum(sizes.values())
    lines.append(report_line(f"{ADMIN_DIR} in all", total, budgets.total_kb))
    return problems + within(lines[-1], total, budgets.total_kb), lines


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the gzip size of the shipped bundles against their budgets.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--budget", action="append", type=budget_arg, default=[], metavar="FILE=KB", help="override or add a budget")
    args = parser.parse_args(argv)
    problems, lines = check(args.root, {**BUDGETS, **dict(args.budget)})
    admin_problems, admin_lines = check_admin(args.root)
    problems += admin_problems
    lines += admin_lines
    if problems:
        LOG.error("[bundle-budget] FAILED:\n%s", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[bundle-budget] OK:\n%s", "\n".join(f"  {line}" for line in lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
