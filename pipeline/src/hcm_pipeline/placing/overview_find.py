"""Find a series' overview map in the archive and build its mosaic (slices 3-4)."""

from __future__ import annotations

import math
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy

from hcm_pipeline.placing.overview import MosaicReport, mosaic_on_overview
from hcm_pipeline.placing.raster_io import read_working
from hcm_pipeline.placing.streets import UInt8Array, grey_of

RASTER_SUFFIXES: frozenset[str] = frozenset({".jpg", ".jpeg", ".tif", ".tiff", ".png"})
SKIP_NAMES: frozenset[str] = frozenset({"thumbs.db", ".ds_store", "desktop.ini"})
# A file at least this large is accepted without opening it; smaller rasters are probed for a long side ≥ MIN_SIDE.
TRUST_BYTES: int = 50_000
MIN_BYTES: int = 1_024
MIN_SIDE: int = 256
YEAR_RE = re.compile(r"\d{4}")
TOKEN_RE = re.compile(r"[A-Za-z]{4,}")
DEFAULT_READ_PX: int = 2400
UPSCALE_LO: float = 1.5
UPSCALE_HI: float = 8.0


@dataclass(frozen=True)
class CanvasOpts:
    """Grid size, upscale and read size for `overview_canvas`."""

    rows: int | None = None
    cols: int | None = None
    upscale: float | None = None
    read_px: int = DEFAULT_READ_PX


def _tokens(name: str) -> set[str]:
    return set(YEAR_RE.findall(name)) | {token.lower() for token in TOKEN_RE.findall(name)}


def _long_side(path: Path) -> int:
    try:
        working = read_working(path, MIN_SIDE)
    except OSError, RuntimeError, ValueError:
        return 0
    return max(working.width, working.height)


def _size_ok(path: Path) -> bool:
    try:
        size = path.stat().st_size
    except OSError:
        return False
    if size >= TRUST_BYTES:
        return True
    return size >= MIN_BYTES and _long_side(path) >= MIN_SIDE


def _ok_file(path: Path, sheets: set[Path]) -> bool:
    skipped = path.resolve() in sheets or path.name.lower() in SKIP_NAMES
    return (not skipped) and path.suffix.lower() in RASTER_SUFFIXES and path.is_file() and _size_ok(path)


def _pick(candidates: Sequence[Path], folder_tokens: set[str]) -> Path | None:
    if not candidates:
        return None
    ranked = sorted(candidates, key=lambda path: (len(_tokens(path.stem) & folder_tokens), path.stat().st_size), reverse=True)
    return ranked[0]


def _candidates(directory: Path, sheets: set[Path]) -> list[Path]:
    return [path for path in directory.iterdir() if _ok_file(path, sheets)] if directory.is_dir() else []


def _under_root(path: Path, root: Path) -> bool:
    resolved, base = path.resolve(), root.resolve()
    return resolved == base or base in resolved.parents


def _path_tokens(path: Path) -> set[str]:
    return _tokens(path.stem) | _tokens(path.parent.name)


def _series_root(folder: Path, root: Path) -> Path | None:
    """The archive series folder: the ancestor that sits directly under `root`."""
    base, current = root.resolve(), folder.resolve()
    if not _under_root(current, root) or current == base:
        return None
    while current.parent != base:
        current = current.parent
    return current


def _related(candidates: Sequence[Path], tokens: set[str]) -> list[Path]:
    return [path for path in candidates if _path_tokens(path) & tokens]


def _sibling_candidates(series: Path, sheets: set[Path]) -> list[Path]:
    parent = series.parent
    if not parent.is_dir():
        return []
    found: list[Path] = []
    for child in parent.iterdir():
        if child.is_dir() and child.resolve() != series.resolve():
            found.extend(_candidates(child, sheets))
    return found


def _near_overview(folder: Path, root: Path, sheets: set[Path], tokens: set[str]) -> Path | None:
    found = _pick(_candidates(folder.parent, sheets), tokens)
    if found is not None:
        return found
    series = _series_root(folder, root)
    if series is None:
        return None
    return _pick(_related(_sibling_candidates(series, sheets), tokens), tokens)


def _search(folder: Path, root: Path, sheets: set[Path], tokens: set[str]) -> Path | None:
    found = _pick(_candidates(folder, sheets), tokens)
    if found is not None or not _under_root(folder.parent, root):
        return found
    return _near_overview(folder, root, sheets, tokens)


def find_overview(root: Path, sheets: Sequence[Path]) -> Path | None:
    """A loose overview raster beside the series' tiles (or a same-year sibling series), or None."""
    if not sheets:
        return None
    resolved = [sheet.resolve() for sheet in sheets]
    folder = Path(os.path.commonpath([str(path.parent) for path in resolved]))
    if not _under_root(folder, root):
        return None
    return _search(folder, root, set(resolved), _tokens(folder.name) | _tokens(folder.parent.name))


def _read_grey(path: Path, read_px: int) -> UInt8Array:
    return grey_of(read_working(path, read_px).image)


def _upscale_of(tiles: Sequence[UInt8Array], overview: UInt8Array) -> float:
    tile_long = float(numpy.median([max(tile.shape[:2]) for tile in tiles]))
    overview_long = float(max(overview.shape[:2]))
    return float(min(UPSCALE_HI, max(UPSCALE_LO, tile_long / max(overview_long, 1.0))))


def _enough(placed: int, total: int) -> bool:
    return placed >= max(2, (total + 1) // 2)


def _mosaic(
    loaded: Sequence[tuple[str, UInt8Array]],
    overview_grey: UInt8Array,
    settings: CanvasOpts,
) -> tuple[UInt8Array, MosaicReport]:
    side = max(1, math.ceil(math.sqrt(len(loaded))))
    rows = settings.rows if settings.rows is not None else side
    cols = settings.cols if settings.cols is not None else side
    scale = settings.upscale if settings.upscale is not None else _upscale_of([tile for _, tile in loaded], overview_grey)
    return mosaic_on_overview(loaded, overview_grey, rows, cols, scale)


def _load_tiles(tiles: Sequence[tuple[str, Path]], read_px: int) -> list[tuple[str, UInt8Array]]:
    return [(name, _read_grey(path, read_px)) for name, path in tiles]


def overview_canvas(
    tiles: Sequence[tuple[str, Path]],
    overview: Path,
    opts: CanvasOpts | None = None,
) -> tuple[UInt8Array, MosaicReport] | None:
    """Tiles laid on the overview at tile detail, or None when too few match."""
    settings = opts or CanvasOpts()
    if not tiles:
        return None
    if not overview.is_file():
        return None
    loaded = _load_tiles(tiles, settings.read_px)
    canvas, report = _mosaic(loaded, _read_grey(overview, settings.read_px), settings)
    if not _enough(len(report.placed), len(loaded)):
        return None
    return canvas, report
