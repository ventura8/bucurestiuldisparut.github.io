"""One PMTiles v3 archive read by ranges (docs/research/M12-own-tiles.md): the reader of what `tiles.pack` writes, standard library only.

A published layer's own tiles are one public object (`tiles/{city}/{layer}/{version}.pmtiles`). A placer that matches a map against an
older or newer map of the city (`placing.ladder`) reads only the tiles it needs: the header and root directory in one 16 KiB request,
a leaf directory when the root points to one (each read once), then each tile by its range. `fetch(offset, length)` is the one
boundary: an HTTP `Range` request on the worker and in the cloud, a file in the tests.
"""

import bisect
import gzip
import itertools
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final

from hcm_pipeline.tiles.pack import COMPRESSION_GZIP, HEADER, HEADER_BYTES, VARINT_CONTINUES, VARINT_LOW_BITS, VARINT_SHIFT, Entry, tile_id

Fetch = Callable[[int, int], bytes]
FIRST_READ: Final = 16384
MAGIC: Final = b"PMTiles"
VERSION: Final = 3
# Leaf directories nest at most this deep (the specification allows more; `tiles.pack` writes one level).
MAX_DEPTH: Final = 3
# A directory's columns after its count: the id deltas, the runs, the lengths, the offsets.
COLUMNS: Final = 4


class ArchiveError(ValueError):
    """Not a PMTiles v3 archive this reader can read."""


@dataclass
class Archive:
    """An open archive: where its parts lie, its zooms, its root directory and the leaves read so far."""

    fetch: Fetch
    root: list[Entry]
    leaves_at: int
    tiles_at: int
    minzoom: int
    maxzoom: int
    gzipped: bool
    leaves: dict[tuple[int, int], list[Entry]] = field(default_factory=dict)


def _varints(data: bytes) -> list[int]:
    values, value, shift = [], 0, 0
    for byte in data:
        value |= (byte & VARINT_LOW_BITS) << shift
        shift += VARINT_SHIFT
        if not byte & VARINT_CONTINUES:
            values.append(value)
            value, shift = 0, 0
    return values


def _offsets(raw: list[int], lengths: list[int]) -> list[int]:
    """Each entry's offset: its own (stored plus one), or right after the entry before it (stored 0)."""
    found: list[int] = []
    for index, stored in enumerate(raw):
        follows = stored == 0 and index > 0
        found.append(found[-1] + lengths[index - 1] if follows else stored - 1)
    return found


def decoded(data: bytes, gzipped: bool = True) -> list[Entry]:
    """A directory's entries (`tiles.pack.serialized` read back)."""
    values = _varints(gzip.decompress(data) if gzipped else data) or [0]
    count = values[0]
    deltas, runs, lengths, raw = (values[1 + part * count : 1 + (part + 1) * count] for part in range(COLUMNS))
    rows = zip(itertools.accumulate(deltas), _offsets(raw, lengths), lengths, runs, strict=True)
    return [Entry(*row) for row in rows]


def open_archive(fetch: Fetch) -> Archive:
    """The archive's header and root directory, from its first 16 KiB; `ArchiveError` for anything else."""
    first = fetch(0, FIRST_READ)
    if len(first) < HEADER_BYTES or first[:7] != MAGIC or first[7] != VERSION:
        raise ArchiveError("not a PMTiles v3 archive")
    header = HEADER.unpack(first[:HEADER_BYTES])
    root_at, root_bytes, leaves_at, tiles_at = header[2], header[3], header[6], header[8]
    gzipped = header[14] == COMPRESSION_GZIP
    root = decoded(first[root_at : root_at + root_bytes] if root_at + root_bytes <= len(first) else fetch(root_at, root_bytes), gzipped)
    return Archive(fetch, root, leaves_at, tiles_at, header[17], header[18], gzipped)


def _last_at_or_before(entries: list[Entry], wanted: int) -> Entry | None:
    """The last entry whose id is at most `wanted` (the entries are in id order)."""
    index = bisect.bisect_right([entry.id for entry in entries], wanted) - 1
    return entries[index] if index >= 0 else None


def _covering(entries: list[Entry], wanted: int) -> Entry | None:
    """The entry whose run covers `wanted` (a leaf, run 0, covers everything up to the next entry)."""
    entry = _last_at_or_before(entries, wanted)
    if entry is None or (entry.run and wanted >= entry.id + entry.run):
        return None
    return entry


def _leaf(archive: Archive, entry: Entry) -> list[Entry]:
    key = (entry.offset, entry.length)
    if key not in archive.leaves:
        archive.leaves[key] = decoded(archive.fetch(archive.leaves_at + entry.offset, entry.length), archive.gzipped)
    return archive.leaves[key]


def find(archive: Archive, wanted: int) -> Entry | None:
    """The tile entry of id `wanted`, through the leaves; None for a tile the archive does not hold (a blank one)."""
    entries = archive.root
    for _ in range(MAX_DEPTH):
        entry = _covering(entries, wanted)
        if entry is None or entry.run:
            return entry
        entries = _leaf(archive, entry)
    return None


def tile(archive: Archive, zoom: int, x: int, y: int) -> bytes | None:
    """One tile's bytes, or None when the archive does not hold it."""
    entry = find(archive, tile_id(zoom, x, y))
    return None if entry is None else archive.fetch(archive.tiles_at + entry.offset, entry.length)
