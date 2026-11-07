"""The chain of `locate`: model, prior, votes, proof, then a local matcher (docs/research/M9-calibration.md §1).

Budgets are counts: `VOTE_TILE_BUDGET` matches shared over the warps, `VOTE_WARP_MIN_TILES` at least for each, `PROOF_MAX_PROPOSALS`
proofs. A strong proposal goes to the proof at once, and only its refusal resumes the votes; the weak ones, merged by place, go when
the votes are done. Nothing here looks at a clock or a landmark; the log reports seconds and the job's steps stay the only record of
them.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Final

from hcm_pipeline.calibrate.dense import PROOF_SEARCH_GROUND_M, DenseGrid, FilmReader, dense_grid, nothing_measured, read_film
from hcm_pipeline.calibrate.poly import MatrixMap, PlaceMap
from hcm_pipeline.calibrate.ports import NullProposalMatcher, ProposalMatcher, ProposalRequest
from hcm_pipeline.calibrate.prior import MeasuredModel, measured_model, prior_margin_m
from hcm_pipeline.calibrate.proof import Proof, no_film
from hcm_pipeline.calibrate.rival import proved
from hcm_pipeline.calibrate.votes import Hypothesis, VoteGrid, VoteProposal, merged, tiles_per_warp, vote_grid, warp_votes
from hcm_pipeline.contract import SearchRange
from hcm_pipeline.geo import FloatArray, Grid, MercatorBox, ground_scale
from hcm_pipeline.georef.corners import Assignment, Frame
from hcm_pipeline.georef.panoramic import PanoramicCamera
from hcm_pipeline.images import UInt8Array

PROOF_MAX_PROPOSALS: Final = 3


@dataclass(frozen=True)
class FrameSearch:
    """What the chain looks at: the frame's preview and reader, its orientations, the reference and the camera."""

    frame: Frame
    orientations: tuple[Assignment, ...]
    reference: UInt8Array
    grid: Grid
    reader: FilmReader
    limits: tuple[int, int, int]
    search: SearchRange
    camera: PanoramicCamera | None
    sensor: str
    seed: int
    prior: MeasuredModel | None = None
    osm_lines: UInt8Array | None = None
    matcher: ProposalMatcher = field(default_factory=NullProposalMatcher)

    @property
    def window(self) -> MercatorBox:
        return self.grid.box()

    @property
    def ground(self) -> float:
        return ground_scale(self.window.bounds().middle_lat)


@dataclass(frozen=True)
class Found:
    """How the chain ended: the proof it accepted (None: none), how, the proposal behind it, and what it can say of a refusal."""

    proof: Proof | None
    how: str
    model: MeasuredModel | None
    votes: tuple[int, int]
    refused: Proof | None
    tried: tuple[VoteProposal, ...]


def hypotheses(search: FrameSearch) -> list[Hypothesis]:
    """The pass's prior first (its own margin), then each orientation at each of the sensor's scales, the model's own scale first: a
    strong proposal there ends the search before the wider scales cost anything."""
    margin = search.search.margin_ground_m / search.ground
    scales = sorted(search.search.scales, key=lambda scale: abs(scale - 1))
    plain = [Hypothesis(each, scale, margin) for scale in scales for each in search.orientations]
    prior = search.prior
    return [*_from_prior(prior, search), *plain] if prior is not None else plain


def _from_prior(prior: MeasuredModel, search: FrameSearch) -> list[Hypothesis]:
    window = search.window
    margin = prior_margin_m(window)
    fitting = [each for each in search.orientations if prior.fits(each, search.camera)]
    return [Hypothesis(Assignment(each.rotation, each.mirrored, prior.matrix_on(each, window)), 1.0, margin, True) for each in fitting]


@dataclass
class _Run:
    """The chain's state: how many proofs it may still run, what it refused."""

    search: FrameSearch
    reference: DenseGrid
    tick: Callable[[], None]
    say: Callable[[str], None]
    left: int = PROOF_MAX_PROPOSALS
    accepted: Proof | None = None
    refused: Proof | None = None

    def heard(self, proof: Proof) -> None:
        """A verdict kept: an accepted proof, else the refusal with the most tiles, for the log."""
        if proof.accepted:
            self.accepted = proof
        elif self.refused is None or proof.inliers > self.refused.inliers:
            self.refused = proof


def _proved(run: _Run, matrix: FloatArray) -> Proof | None:
    """The proof of a proposal when it is accepted."""
    run.left -= 1
    proof = prove_map(run.search, run.reference, MatrixMap(matrix), run.tick)
    run.say(_proof_line(proof))
    run.heard(proof)
    return proof if proof.accepted else None


def prove_map(search: FrameSearch, reference: DenseGrid, start: PlaceMap, tick: Callable[[], None]) -> Proof:
    """The film read under `start` and measured against the reference, and the verdict."""
    reach = PROOF_SEARCH_GROUND_M / search.ground
    film = read_film(start, search.window, search.reader, search.limits, reach)
    if film is None:
        return no_film(nothing_measured())
    return proved(start, reference, film, search.seed, tick)


def _proof_line(proof: Proof) -> str:
    verdict = "proved" if proof.accepted else f"not proved ({proof.refusal})"
    figure = "" if proof.checked.count == 0 else f", checked {proof.checked.cv_m:.1f} m at {proof.checked.count} places"
    return f"{verdict}: {proof.inliers} of {proof.tried} tiles agree{figure}"


def _vote_line(proposal: VoteProposal, ground: float) -> str:
    moved = (proposal.shift[0] ** 2 + proposal.shift[1] ** 2) ** 0.5 * ground / 1000
    place = proposal.hypothesis.assignment
    mirror = ", mirrored" if place.mirrored else ""
    turned = f"rotation {place.rotation * 90}{mirror}, scale {proposal.scale:.3f}, moved {moved:.1f} km"
    return f"tile votes: {proposal.agreed} of {proposal.tiles} agree ({turned})"


def _vote_all(search: FrameSearch, run: _Run, grid: VoteGrid, tried: list[VoteProposal]) -> VoteProposal | None:
    """Every warp in turn; a strong proposal that proves ends them."""
    warps = hypotheses(search)
    tiles = tiles_per_warp(len(warps))
    for hypothesis in warps:
        proposal = warp_votes(search.frame, hypothesis, grid, tiles, run.tick)
        if proposal is not None and _heard(search, run, proposal, tried):
            return proposal
    return None


def _heard(search: FrameSearch, run: _Run, proposal: VoteProposal, tried: list[VoteProposal]) -> bool:
    """A warp's proposal logged and kept; True when it was strong enough to prove at once, and proved."""
    run.say(_vote_line(proposal, search.ground))
    tried.append(proposal)
    return proposal.strong and run.left > 0 and _proved(run, proposal.matrix) is not None


def _weak_ones(search: FrameSearch, run: _Run, tried: Sequence[VoteProposal]) -> VoteProposal | None:
    """The merged clusters no early proof took, best first, as long as proofs are left."""
    clusters = merged([each for each in tried if not each.strong], search.ground)
    for proposal in clusters[: max(run.left, 0)]:
        if _proved(run, proposal.matrix) is not None:
            return proposal
    return None


def _ended(search: FrameSearch, run: _Run, winner: VoteProposal, tried: list[VoteProposal]) -> Found:
    model = measured_model(_origin(search, winner), winner.matrix, search.window, search.camera)
    how = "pass" if winner.hypothesis.from_pass else "votes"
    return Found(run.accepted, how, model, (winner.agreed, winner.tiles), None, tuple(tried))


def _origin(search: FrameSearch, proposal: VoteProposal) -> Assignment:
    """The orientation's own first guess, which a measured model is relative to."""
    place = proposal.hypothesis.assignment
    return next(each for each in search.orientations if (each.rotation, each.mirrored) == (place.rotation, place.mirrored))


def _from_matcher(search: FrameSearch, run: _Run, tried: list[VoteProposal]) -> Found | None:
    """A local matcher's proposals, the same proof deciding; only after nothing else proved."""
    request = ProposalRequest(search.frame.pixels, search.frame.factor, search.reference, search.osm_lines, search.grid, search.sensor)
    for proposal in search.matcher.propose(request):
        proof = prove_map(search, run.reference, MatrixMap(proposal.matrix), run.tick)
        run.say(_proof_line(proof))
        if proof.accepted:
            return Found(proof, "local-ai", None, (proposal.support, proposal.support), None, tuple(tried))
        run.heard(proof)
    return None


def find_frame(search: FrameSearch, tick: Callable[[], None], say: Callable[[str], None]) -> Found:
    """The frame found and proved, else the refusal to log; a refusal is a result, not an exception."""
    margin = search.search.margin_ground_m / search.ground
    run = _Run(search, dense_grid(search.reference, search.grid), tick, say)
    grid, tried = vote_grid(search.reference, search.grid, margin * search.ground), list[VoteProposal]()
    winner = _vote_all(search, run, grid, tried) or _weak_ones(search, run, tried)
    if winner is not None:
        return _ended(search, run, winner, tried)
    return _from_matcher(search, run, tried) or _not_found(run, tried)


def _not_found(run: _Run, tried: list[VoteProposal]) -> Found:
    best = max(tried, key=lambda each: each.agreed, default=None)
    votes = (0, 0) if best is None else (best.agreed, best.tiles)
    return Found(None, "none", None, votes, run.refused, tuple(tried))
