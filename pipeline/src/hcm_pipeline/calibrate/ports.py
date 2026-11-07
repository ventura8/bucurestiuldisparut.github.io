"""The port a local matcher plugs into (docs/research/M9-calibration.md §3).

Only a proposal comes out of it: the proof decides as it does for the votes, and its gates do not soften. A later local matcher
runs on the worker alone, under the network guard, never reaching a remote model; `NullProposalMatcher` is today's only one.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from hcm_pipeline.geo import FloatArray, Grid
from hcm_pipeline.images import UInt8Array


@dataclass(frozen=True)
class ProposalRequest:
    """What a matcher may look at: the frame's preview, the Sentinel-2 window and OpenStreetMap's lines on its grid, the camera."""

    preview: UInt8Array
    preview_factor: float
    reference: UInt8Array
    osm_lines: UInt8Array | None
    grid: Grid
    sensor: str


@dataclass(frozen=True)
class Proposal:
    """Where a matcher puts the frame: film pixels to EPSG:3857 metres, and how many of its own tests support that."""

    matrix: FloatArray
    support: int


class ProposalMatcher(Protocol):
    name: str

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]: ...


class NullProposalMatcher:
    """No local matcher: a frame the votes do not find waits for the admin's points."""

    name = "none"

    def propose(self, request: ProposalRequest) -> Sequence[Proposal]:
        del request
        return ()
