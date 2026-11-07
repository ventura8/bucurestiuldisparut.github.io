# M9: import and calibration for any place on Earth (contract, at a65f7bb)

The source: the owner, 2026-11-06. Any location, automatic, minimum input; AI only local (GPU first, CPU fallback). References: Sentinel-2 and OpenStreetMap only, never Mapbox Satellite or a `fostulbucuresti` resource.

**Status:** the pipeline workstream is built and rehearsed on real KH-9 panoramic, KH-7, KH-9 mapping and KH-5 frames (§14; no real Corona yet); the server+admin workstream is built (§15). A value marked *first* has no refusal measured against it yet, except where §14 says so.

## 0. Evidence and corrections

A new probe (`reports/calib/vote3.py`, `honest.py`; NUC, votes on 1 core, dense at `--cpus=4 --memory=16g`) replaces `vote2.py`'s 48 warps: **one warp per corner assignment**, 64-cell tiles at 43 m ground, a similarity RANSAC over the tiles' votes (a tile tolerates scale and rotation error; the consensus measures them).

| Window on frame | Votes agreeing | Hull | Shift dx, dy (m) | Known (m) |
| --- | --- | --- | --- | --- |
| Bucharest, F006 | 21 of 182 | 0.106 | +10320, +17289 | +10080, +16800 |
| Bucharest, F007 | 22 of 182 | 0.228 | +1830, +13869 | +1680..2280, +13300..15000 |
| Bucharest, F040 (winter) | 13 of 182 | 0.218 | +1977, +9375 | sibling F039: +2776, +10906 |
| Bucharest, A001 (1982) | 3; corner homography 4 | 0 | none | none |
| Slobozia, Slatina, Fetești on F006 | 3, 4, 6 | ≤ 0.038 | none | none |
| Pitești on F006 | 33 of 169 | 0.138 | +1413, +13179 | none; proof not run |

Votes took 52 s for four warps on one core, 0.48 GB. Dense from those proposals, no landmark:

| Frame | Inliers / candidates, poly2 | Dense, 4 cores, warm disk | 5-fold on inliers | Checks of §7, two folds |
| --- | --- | --- | --- | --- |
| F007 | 697 / 896 | 25 s | 12.8 m | 10.5, 16.3 m |
| F006 | 414 / 505 | 21 s | 12.5 m | 15.1, 14.2 m |
| F040 | 414 / 578 | 24 s | 13.0 m | 16.4, 17.5 m |

Corrections:

- **F040 is not refused.** From a proposal, tile 128 px, search ±80 px: 414 inliers, where the earlier run had 16 of 363. A checkerboard by eye on one region agrees; no landmark checked it.
- **A001 was the model's fault, and is found** (§14). Its film is half as long as a full frame's: KH-9 swept 60 degrees, not 120, and off the nadir. Under the full centred sweep 3 of 196 tiles agreed, under the corner homography 4, under this one 24 in the first probe. Written before that was known: its rows in the table above and in §6 no longer describe the product.
- **11 to 12 m flatters.** `refine.py` cross-validates its RANSAC inliers, capped at 25 m. Tiles held out before RANSAC: median 10 to 17 m, RMSE 15 to 33 m. So **some real frames will miss the 15 m auto-publish threshold and wait for one click**. The threshold stays.
- **A vote must refuse partly covered places.** Unmasked, every tile peaked at the frame's edge (0.43 against the truth's 0.34): a confident false consensus.
- **`warp` does not clip.** `steps/warp.py` has no `outputBounds`; M8's "every warp clips" holds only for `align`. Hence 1,249 km² rendered.
- **`coverage_pct` (`steps/merge.py`) divides by the city inside its grid**: right for a join's canvas, inflated for a crop.

## 1. The chain

New package `pipeline/src/hcm_pipeline/calibrate/`, called from `steps/locate.py` and `steps/georef.py`:

1. **Model:** `first_guesses` (`georef/corners.py`), the plausible assignments, panoramic for a sensor with `half_angle_deg`, else the corner homography. A frame over longitude 180 is one piece around the city (`around`, `documents._one_piece`); a window ends on the line (`MercatorBox.expanded`), and no pair is written past it (`inside_world`). `CityNotFoundError` stays for a frame reaching the window under no orientation, "reaching" read over the window widened by the sensor's search range **on the ground** (below) or half its size if that is more: a 10 km town the model puts 14 km past the film's edge gets its search, and, refused, its bounded crop and the admin's points.
2. **Prior**, then **votes** (§2).
3. **Prove** each proposal, best first, at most `PROOF_MAX_PROPOSALS = 3` (§4).
4. **`ProposalMatcher`** only if nothing proved (§3); same proof.
5. Proved: §5. Not: §6.

`SensorSpec.search` (the pipeline's alone, not in `as_contract`) holds ranges in ground metres, converted by `ground_scale` of the window's latitude; cells and tiles too, so 60 degrees and the equator see the same ground:

| Sensor | Model | Margin | Scales |
| --- | --- | --- | --- |
| KH-9-pan | panoramic | 30 km | 1, 0.94 (full sweeps measured 0.915 to 0.956, short films 0.998 to 1.010: §14) |
| KH-4, 4A, 4B | corners | 30 km | 0.85, 1, 1.15 **UNVERIFIED**: no real Corona frame has run (§14) |
| KH-5 | corners | 30 km | 1; one real frame, which nothing proves (§14) |
| KH-7 | corners | 30 km | 1, 1.1, each at shears 0 and ±7.5 degrees; one real frame (§14) |
| KH-9-mapping | corners | 15 km | 1; one real frame (§14) |

## 2. Propose (`calibrate/votes.py`, `prior.py`)

- `VOTE_CELL_GROUND_M = 43`, `VOTE_TILE_CELLS = 64`, `vote3.py`'s gradient filter, `VOTE_SIDE_MAX_PX = 2400` (a wider search image coarsens the cell).
- `VOTE_TILE_BUDGET = 720` matches a frame, shared over the warps, each at least `VOTE_WARP_MIN_TILES = 180` (4 warps: 180 tiles; 12: 180, 2,160 matches). At 60 a warp no real frame reached `VOTE_MIN_AGREE`; the model's own scale goes first, so a strong proposal ends the search before the wider scales cost anything. Counted, not timed: deterministic. The preview's pixel is the frame's long side on the ground over its long side on film (`frame_pixel_m`), so a strip running north-south and scanned as its width is not shrunk ten times too far.
- A place under `VOTE_PLACE_COVERAGE = 0.9` cannot win; `VOTE_MIN_PEAK = 0.12`; a flat tile is not asked.
- Consensus: `cv2.estimateAffinePartial2D`, ±3 cells, seeded by the job id. A proposal needs `VOTE_MIN_AGREE = 8`, `VOTE_MIN_HULL = 0.05`, scale within `VOTE_SCALE_TOLERANCE = 0.12`, rotation within `VOTE_ROTATION_DEG = 3` (from the eight windows above).
- **Aggregation:** proposals of one assignment with centre shifts within `VOTE_MERGE_GROUND_M = 1000` merge, votes added. Weak consistent clusters reach the proof, which decides.
- **Early stop:** `VOTE_STOP_AGREE = 16` goes to the proof at once; only a refusal resumes voting.
- **Same-pass prior:** key mission + camera letter + date (`D3C1203-300415`, `F`, date; `/([A-Z])\d+$/` as in `imagery/join.ts`). `cities/{city}/imageryPasses/{key}` holds the last proved `model`; `imagery.onJobWrite` writes it when `locate` ends proved; `functions/src/worker/allow-list.ts` adds it read-only. The prior warps first, `PRIOR_MARGIN_GROUND_M = 12000` (neighbours measured: 6.5 km F006 to F007, about 1 km F039 to F040). A refusal falls through to the full search.

## 3. The `ProposalMatcher` port (`calibrate/ports.py`)

```python
class ProposalMatcher(Protocol):
    name: str
    def propose(self, request: ProposalRequest) -> Sequence[Proposal]: ...
# ProposalRequest: frame preview, Sentinel-2 window, OSM lines, grid, sensor. Proposal: film-to-EPSG:3857 matrix, support.
```

`NullProposalMatcher` is today's only one, injected as `Services.proposal_matcher`. A later local matcher plugs in on the worker alone, under the network guard, never reaching a remote model. Its output is only a proposal: the gates do not soften.

## 4. Prove (`calibrate/dense.py`, `proof.py`)

- Read the proposal's window plus the search reach at `PROOF_READ_GROUND_M = 5` a pixel: new `Segment.averaged_window` (`frames.py`, `AVERAGED`), a segment at a time.
- Warp onto the reference grid (a whole factor coarser where 10 m Mercator is under about 5 m ground). `PROOF_TILE_GROUND_M = 900`, every 450 m. `PROOF_SEARCH_GROUND_M = 600`, halving, at least 10 cells; 3 iterations, refitting.
- A tile counts with `PROOF_MIN_PEAK = 0.2` and `PROOF_MIN_MARGIN = 0.03` over the best beyond ±8 cells.
- RANSAC poly1 then poly2, `PROOF_RANSAC_M = 25` ground (2.4 and 1.6 times first), job-id seed. Metres use each pair's latitude, never `refine.py`'s fixed cosine.

Accepted when **all** hold; `refusal` names the first that fails:

| Constant | Value | Measured |
| --- | --- | --- |
| `PROOF_MIN_INLIERS` | 60 | 414 to 697; a refused run 16 |
| `PROOF_MIN_SHARE` (of candidates) | 0.5 | 0.72 to 0.82; a refused run 0.04 |
| `PROOF_MIN_SPREAD` (hull / covered window) | 0.4 | *first* |
| `PROOF_MIN_COVERED` (of the window) | 0.05 | *first* |
| `PROOF_MAX_CV_M` (blocked 5-fold, §7) | 30 | *first*; folds 10 to 31 |
| `PROOF_MAX_GROSS` (checks over 100 m) | 0.2 | 0 to 0.13 |
| `PROOF_MIN_CHECKS` (refusal `cross-validation`) | 5 | 64 to 139 on real frames; one tile decided both gates above |
| `PROOF_MAX_RIVAL`, `RIVAL_MIN_SHARE` and `RIVAL_MIN_SIGMAS` (refusal `rival`) | 0.5; 0.1 and 10 | §14: 3.6 to 4.3 sigmas on real frames |

**The last look (`calibrate/rival.py`).** `measure` narrows to about ±150 m, so a tile whose true place lies further has no peak and leaves `tried`: every gate above counts survivors. A lattice of fields proved a map 800 m wrong, and a film with its east 30 % displaced 357 m read 2.2 m at the checkpoints (`docs/LESSONS.md` 374). So once every gate holds, up to `RIVAL_TILES = 400` tiles search `RIVAL_SEARCH_GROUND_M = 1500` around the final map and their score maps are **added**: noise cancels, and where the film as a whole agrees remains. Beyond `RIVAL_NEAR_GROUND_M = 200` of the map's own place, a peak over half its height is a repeat, and one over a tenth and 10 standard deviations of the sum's noise is a part of the film that belongs elsewhere. Under `RIVAL_MIN_TILES = 30` the sum says nothing. It does not see: a displaced part under about 15 % of the window, or further off than the search, or one with no texture. What no tile looks at, the approval's `measuredPct` (§11) leaves to a person.

## 5. On proof (`steps/locate.py`)

- Crop only what the frame reaches of `city_window(ctx)`, through the proved map, on the exposure, `PROOF_CROP_PAD_PX = 64`.
- Corner GCPs from the proved map; pairs in `work/{city}/{job}/calibration.json`, so a retry does not re-measure.
- `delete_delivery` on proof only. `MIN_CORRELATION`, `surface.py`, `searched` and `_search_around` retire: the proof is stricter.
- `calibration.outline` (the exposure's edge through the proved map, clipped to the city's bounds, at most 32 vertices) and `coveredPct`. **The planner reads it:** `functions/src/imagery/join-plan.ts` passes `measuredOutline`; `cellsOf` (`imagery/join.ts`) prefers it over `coverageRing`.
- `steps/warp.py` passes `outputBounds = aligned_box(city_window(ctx))` when `source.kind === 'usgs'`: nothing renders or bills beyond the window.
- `steps/export.py` writes `output.coveragePct`: alpha over the city's bounds, **divided by the whole city's area** (fix `coverage_pct`, join's result unchanged).

## 6. No proof

`bounded_crop` (replaces `weak_crop`) **always fits**:

- `UNPROVEN_MARGIN_M = 20000` ground (replaces `WEAK_CROP_MARGIN_M`: F006 lay 14 km ground off) per reaching orientation, ordered by votes, coverage, then as given.
- A union's side over `MAX_SCAN_PIXELS` is cut to it, the first orientation's box kept whole; `calibration.cutOrientations` counts any lost.
- `within_limits` stays as a guard no input reaches. A001 (225,264 px) becomes 200,000 px and `needs_gcps`.
- The delivery stays (§15: what for). `georef/matcher.py` still runs at its unchanged bar, then the job waits and the corner pairs clear.

## 7. `georef` (`steps/georef.py`, `calibrate/pairs.py`)

**Proved frame:**

- Cells `PAIR_CELL_GROUND_M = 1600`, doubled until `DENSE_MAX_PAIRS = MAX_AUTO_GCPS` (200) fits; inside crop and window. One pair a cell, but no buffer between cells: tiles are 900 m at a 450 m step, so a pair and a check 450 m apart can read half the same pixels. Simulated, this does not flatter a poly2 figure at this leverage (16.73 m against a true 16.97 m; independent errors 17.61 against 16.71).
- Every fifth cell (`AUTO_GCP_CHECKPOINT_SHARE`) is set aside **before this RANSAC**; `measure`'s earlier rounds refit on every tile, held ones too, and centre the last search on that map. Its strongest tile with `CHECK_MIN_PEAK = 0.3`, `CHECK_MIN_MARGIN = 0.06` (reading the match, never the fit) is a real checkpoint (`enabled: false`). Over `CHECK_GROSS_M = 100` it is dropped and counted in `checksDropped`; the rest are not trimmed. `checkpointRmseM` is therefore the survivors' figure: a dropped check may be a false match or a part of the map that is wrong, and nothing can tell them apart, so any dropped check keeps the frame from publishing itself (§11) and its card says so.
- RANSAC on the other cells; each cell's strongest inlier is a pair: `origin: 'auto'`, `score = max(AUTO_GCP_MIN_CONFIDENCE, min(1, 2 x peak))`, no suggestions.
- `affine` or `poly2` by blocked 5-fold; `poly2` needs `MIN_POLY2_PAIRS` and `TRANSFORM_MIN_GAIN_M = 2`. `tps` is never automatic; poly3 is cut (about 1 m, three twins to change). `crossValidatedM` is that blocked figure, steadier than one split; with no fold to hold there is no figure, never `Infinity`, and a fold needs more pairs than its own order's minimum (6 or 7 pairs read infinite, and every reader of the document would have refused it).

**Admin's points seed the same step.** `method: 'gcps'`, at least `MIN_GCPS.affine` enabled, none `auto`, none disabled: their fit starts `dense` on `scan.tif`, search `max(600, min(3 x checkpoint RMSE, 2000))`. Proved: `method: 'auto'`, `how: 'points'`, `seedPoints`, the rough points replaced, and the log says so. Refused: `fit_points` as today. A set holding `auto` pairs is fitted as saved, so a later edit is never overwritten.

**Schemas** (`packages/shared`, twins in `documents.py`):

```ts
// georefSchema; fit.ts and transforms.py derive it: disabled pairs -> 'held-out', else 'leave-one-out'
checkpointKind: z.enum(['held-out', 'leave-one-out']).optional(),
// outputSchema
coveragePct: z.number().min(0).max(100).optional(),
// layerVersionDocSchema
calibration: z.strictObject({
    how: z.enum(['votes', 'pass', 'points', 'matcher', 'local-ai', 'none']), // 'matcher': proved, but the tiles gave no fit
    measuredPct: pct.optional(), // the agreeing tiles' hull over what the frame covers of the window
    model: z.strictObject({ camera: z.enum(['panoramic', 'corners']), rotation: z.number().int(), mirrored: z.boolean(),
        scale: z.number(), rotationDeg: z.number(), dxM: z.number(), dyM: z.number() }).optional(),
    votes: z.strictObject({ agreed: count, tiles: count }).optional(),
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    crossValidatedM: metres.optional(), coveredPct: pct.optional(), outline: ring.max(32).optional(),
    checksDropped: count.optional(), seedPoints: count.optional(), cutOrientations: count.optional(),
    refusal: z.enum(['no-votes', 'few-inliers', 'low-share', 'narrow', 'small', 'cross-validation', 'gross', 'rival']).optional(),
}).optional(),
```

## 8. What is shown

**Job log** (`locate`; the figures are examples):

- `found by tile votes: 22 of 182 tiles agree (as given, scale 0.94, moved 13.9 km)`
- `proved: 697 of 896 tiles agree, cross-validated 12.8 m, covers 62 % of the city; crop 41,200 x 22,100 px, delivery deleted`
- `not proved (few-inliers: 16 of 363): crop 200,000 x 22,240 px, delivery kept, the admin's points are next`

**Admin** (`approval-card.ts`, `version-detail.ts`, `packages/admin/src/imagery/version-view.ts`): a block under `adminContent.imagery.calibration.`; the join offer reads `output.coveragePct` first. Tour states: calibrated, not proved, waiting on coverage.

| Key | en | ro |
| --- | --- | --- |
| `how.votes` | Found automatically | Găsită automat |
| `how.pass` | Found from a neighbouring frame | Găsită după un cadru vecin |
| `how.points` | Refined from your points | Rafinată din punctele tale |
| `tiles` | {agreed} of {tried} areas agree | {agreed} din {tried} zone se potrivesc |
| `error` | Measured error {metres} m | Eroare măsurată {metres} m |
| `covered` | Covers {percent} % of the city | Acoperă {percent} % din oraș |
| `notFound` | Not found: place a few rough points, the rest is automatic | Negăsită: pune câteva puncte aproximative, restul e automat |
| `waits.notProved` (nothing proved it, checked only on its own points, a check dropped, or too little measured: one key for the 630 KB budget) | Not fully checked: compare it with the map | Neverificată complet: compar-o cu harta |
| `waits.coverage` | Covers under 90 % of the city: add a frame or approve | Acoperă sub 90 % din oraș: adaugă un cadru sau aprobă |

## 9. Budgets (4 cores, 16 GB)

| Stage | Budget | Basis |
| --- | --- | --- |
| Votes | 720 matches at most 4 warps, 180 a warp beyond: KH-9-pan and KH-5 8 warps, 1,440; Corona 12, 2,160; KH-7 24, 4,320. One process, 1 GB | 52 s for 720 on one NUC core, 0.48 GB; §14 for 8, 12 and 24 warps |
| One proof | 3 iterations and the last look, 2 GB | 21 to 25 s from a 2.8 GB crop; the averaged read is **unmeasured** |
| `locate`, proved | under 2 minutes | votes, proof, crop. Not held on 12 warps with a weak proposal (§14: 170 s); on 8 and 24 warps held, 16 to 61 s (§14) |
| Worst case | under 5 minutes | votes, 3 proofs; a local matcher's time is its own |
| Bounded crop | 4.4 GB array, 6 GB peak | 200,000 x 22,240 |

Budgets are counts; only the log reports seconds. A real 4-core PC must confirm.

## 10. Tests

`pipeline/tests/unit/test_calibrate_{votes,proof,pairs,prior,ports}.py`, on `tests/synthetic/scenes.py` with an injected shift, scale and rotation:

- Recovery at 44, about 0 and about 60 degrees, asserted in ground metres. A mirrored and a rotated scan recover their assignment.
- An off-strip window: no false positive. Low texture: `no-votes`, no exception. A partial frame: `coveredPct` near the injected share.
- Over-limit crop bounded; a bad tile in a held cell raises the figure; seeded points refine or fall back; the null matcher is never called after a proof.

**Goldens:** `georef-cases.json`, `written-documents.json` (regenerated), `version.awaiting-approval.json`. **Rows changed:** `S-P01-BAD-WEAK-GUESS-TOO-WIDE`, `S-P01-BAD-WEAK-GUESS-TO-POINTS`, `S-P01-HAPPY-PANORAMIC-LOCATE`; `test_surface.py` goes.

**New rows:** `S-P06-HAPPY-VOTES`, `S-P06-BAD-OFF-STRIP`, `S-P06-BAD-LOW-TEXTURE`, `S-P06-HAPPY-PASS-PRIOR`, `S-P06-BAD-PASS-PRIOR-WRONG`, `S-P06-BAD-OVER-LIMIT`, `S-P06-HAPPY-SEEDED-POINTS`, `S-P06-BAD-SEEDED-REFUSED`, `S-P06-HAPPY-WARP-CLIPPED`, `S-P06-BAD-CROP-COVERAGE`, `S-A17-HAPPY-WHOLE-CITY`, `S-A17-BAD-PART-OF-CITY`, `S-A17-BAD-LEAVE-ONE-OUT`, `S-A67-HAPPY-CALIBRATION`, `S-A67-BAD-NOT-FOUND`.

**Rehearsal D4, before any status claim:** the four frames through the built step; the off-strip windows and Pitești through the proof table; a real Corona, KH-7 and KH-9 mapping frame; a city far from Bucharest.

## 11. Auto-publish (`functions/src/imagery/approval.ts`)

The hole: `imagery.saveGcps` stores `checkpointCount` from leave-one-out, so automatic pairs saved all enabled (live F007: 124 pairs, 12.0 m) pass `measuredWithin` while the frame holds part of the city, and `held` guards only a frame a join already named.

```ts
const CITY_MIN_COVERAGE_PCT = 90; // one bar, renames JOIN_MIN_COVERAGE_PCT
function measuredWithin(georef: Georef, threshold: number): boolean {
    return georef.method !== 'embedded' && georef.checkpointKind === 'held-out' /* + today's count and RMSE */;
}
function frameCoversCity(version: Rendered): boolean {
    return version.source?.kind !== 'usgs' || (version.output.coveragePct ?? 0) >= CITY_MIN_COVERAGE_PCT;
}
```

A missing figure never approves. A regeoref or crop keeps `source` (`regeoref.ts`), so stays under the rule. The rendered figure survives a crop and poor points. `S-A17-HAPPY`'s fixture needs disabled pairs; M3 §7.1 gets an amendment.

**As built, stricter (§13.1):** `held-out` says little off the proof's path. The matcher's checks come from pairs its own RANSAC filtered at 3 px (`autogcp.held_out`), and a pair an admin disables after reading its residual is no independent check. So a version publishes itself only when, besides the above:

- `georef.method === 'auto'`: hand points always wait, uploads included (`S-A17-BAD-HAND-POINTS`). So no upload publishes itself any more; M3 §7.1 said a measured one could.
- `calibration.how` is `votes`, `pass`, `points` or `local-ai`, with no `refusal`: the proof holds this fit (`S-A17-BAD-NOT-PROVED`). A proved frame whose tiles gave no fit and went to the matcher reads `matcher`. A re-rendered version has no `calibration`, and waits.
- `checksDropped` is 0 (`S-A17-BAD-CHECKS-DROPPED`).
- `measuredPct >= AUTO_MIN_MEASURED_PCT` (70; real frames 79.4 to 88.2): beyond the tiles' hull a polynomial extrapolates, the folds are interleaved cells and never hold out a contiguous region, and `coveragePct` reads alpha, not tiles (`S-A17-BAD-UNMEASURED-AREA`).

## 12. Workstreams

Server+admin lands the schemas first; both build against §7.

**Pipeline:** `pipeline/src/hcm_pipeline/calibrate/**`; `steps/{locate,georef,warp,export,merge}.py`, `georef/{corners,transforms}.py`, `georef/surface.py` (removed), `frames.py`, `rasters.py`, `documents.py`, `contract.py`, `jobs.py`; `pipeline/tests/**`; `docs/research/M3-interfaces.md`; `.agents/skills/raster-pipeline/` and its mirror.

**Server+admin:** `packages/shared/src/schemas/{georef,imagery}.ts`, `packages/shared/src/georef/fit.ts`, `packages/shared/src/imagery/join.ts`, i18n, `packages/shared/test/**`; `functions/src/imagery/{approval,join-plan,on-job-write}.ts`, `functions/src/imagery/pass-calibration.ts` (new), `functions/src/worker/allow-list.ts`, `functions/test/**`, the rules and `rules-tests` for `imageryPasses` (no client); `packages/ui/src/admin/imagery/**`, `packages/admin/src/imagery/**` and their tests; `e2e/**` with `e2e/scenarios.json` and `e2e/tour/states.ts`; `docs/research/M8-join-interfaces.md`; `.agents/skills/{firebase,e2e-scenarios}/` and mirrors; `docs/ARCHITECTURE.md`.

The integrator owns `AGENTS.md`, `CLAUDE.md`, `docs/LESSONS.md` and this file.

## 13. Owner decisions

1. Leave-one-out never auto-approves: hand points that did not refine take one Approve click (M3 §7.1 allowed it). Recommended. Built wider than that wording (§11): disabled hand points wait too, whatever their kind says. **For the owner to confirm:** hand-pointed uploads no longer publish themselves.
2. An honest figure sits near 15 m, so auto-publish will often wait until D4 shows how often. The threshold stays unless the owner changes it.

**Cut:** the local matcher itself; picking an orientation by hand; re-cropping a stored frame; poly3; a place with no Sentinel-2 scene under 20 % cloud (`referenceUnavailable` stands).

**Not cut: a window across the seam of two orbit tracks.** Tracks lie about 280 km apart at the equator and swaths are 290 km, and adjacent tracks fly on different days, so no single date may cover it; and a tile's box may hold a window whose footprint does not (27 % missing at latitude 5, 9 % at 44.4). `stac.py` reads the footprint, asks for 100 items (50 left out a date's other tiles over longitude 27 at 44.4), and falls back on up to four items of any dates, each the one that adds most of the window. A live sweep of the catalog was not repeated after this change; tested on fixtures only.

## 14. Rehearsal on real frames (2026-11-06)

**Run:** the product's own `find_frame`, `prove_map`, `calibrated`, `reach_of`, `proved_box`, `crop_pixels` (`tools/m9-run.py`, `m9-false.py` on the NUC, `pipeline/src` synced), on `stitch`'s real segments and preview; no landmark, no prior unless named. One frame at a time, `--cpus=4 --memory=16g`, warm disk, segments on the local disk. Seconds are the search with its proof, then the crop's read.

| Frame, window | Result | Votes | Tiles agreed | Figure, 5 folds (checks) | Pairs + checkpoints, transform | `checkpointRmseM`, blocked | Search + crop s | Peak GB | Crop px |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006, Bucharest | proved | 20 of 196 | 402 of 500 | 14.3 m (74) | 69 + 14, poly2 | 19.5, 11.5 m | 20 + 0.4 | 1.44 | 36,895 x 11,605 |
| F007, Bucharest | proved | 22 of 196 | 712 of 946 | 16.3 m (114) | 136 + 21, poly2 | 17.3, 13.5 m | 24 + 1.7 | 1.49 | 40,314 x 22,140 |
| F007, F006's model as prior | proved, `pass` | 21 of 156 | 707 of 946 | 16.5 m (116) | 130 + 25, poly2 | 18.0, 14.2 m | 18 + 1.1 | 1.49 | 40,316 x 22,140 |
| A001 (1982), Bucharest | proved | 13 of 196 | 922 of 1,192 | 17.7 m (139) | 62 + 13, poly2 | 13.0, 15.0 m | 38 + 0.3 | 1.64 | 19,037 x 22,240 |
| F040 (winter), Bucharest | **proved** | 20 of 196 | 406 of 582 | 19.7 m (64) | 91 + 13, poly2 | 24.9, 14.0 m | 22 + 1.3 | 1.43 | 42,612 x 21,984 |
| F006, Pitești | **proved** | 42 of 196 | 1,039 of 1,176 | 14.4 m (117) | 108 + 23, poly2 | 15.5, 12.9 m | 19 + 0.5 | 1.08 | 26,008 x 19,010 |
| F006, Fetești | `no-votes` (**a miss of the votes**: gate R1 proved it, see below) | 0 | | | | | 41 | 0.50 | bounded 200,000 x 22,112 |
| F007, Fetești | `no-votes` (unsettled, see below) | 0 | | | | | 32 | 0.50 | bounded 200,000 x 22,140 |
| F006, Slobozia | `no-votes` (**a miss of the votes**, see below) | 0 | | | | | 27 | 0.39 | bounded 200,000 x 22,112 |
| F006, Slatina; F007, Pitești | `no-votes` (was `cityNotFound` until the reach went to ground metres, see below) | 0 | | | | | 19, 25 | 0.41, 0.54 | bounded 200,000 x 22,112 |

**Corrected by gate R1 (`docs/research/M10-local-ai.md`, 2026-11-07), this table and what is said of it below:**

- **Fetești on F006 is not a clean refusal, and Slobozia is not off the strip.** Both were misses by the votes. Fetești was proved through a matcher's proposal from three shifted starts at 15 and 10 m, all maps within 4.0 m; Slobozia by a scan of 289 proofs, once, by numbers alone (its checkerboard is inconclusive).
- **A model from a far city does not fit `PRIOR_MARGIN_GROUND_M` of 12 km:** the Bucharest model is 18.3 km (ground) off at Fetești and 6.9 km at Pitești, mostly along the film.
- **Across the film that model's error was only 0.1 to 4.2 km (Mercator), so its on-film shares are usable.** A share of 0 % or 0.5 % is a correct refusal, and F007 on Pitești (2.3 %) is treated the same. They come from a model, not a proof. Fetești on F007 stays unsettled: the models put 12.5 to 17.7 % of the window on film, and nothing proved it.

**Re-run after the review of 2026-11-07** (`tools/m9-run2.py`, `m10.sh`, this tree's `pipeline/src`, one frame at a time, `--cpus=4 --memory=6g`): every frame above gives the same votes, tiles, figures and crops; the search with its proof takes 25, 31, 28, 44 and 21 s where it took 20, 24, 22, 38 and 19 s, so the last look costs about 5 s.

| Frame, window | `rival` share | Sigmas of noise | `measuredPct` | `checksDropped` |
| --- | --- | --- | --- | --- |
| F006, Bucharest | 0.174 | 4.3 | 79.4 | 0 |
| F007, Bucharest | 0.092 | 3.6 | 88.2 | 0 |
| F040, Bucharest | 0.150 | 4.2 | 82.3 | 0 |
| A001, Bucharest | 0.091 | 4.1 | 87.1 | 0 |
| F006, Pitești | 0.050 | 3.6 | 85.5 | 0 |

So `RIVAL_MIN_SIGMAS` (10) and `AUTO_MIN_MEASURED_PCT` (70) leave these five as they were, and no real frame has a measured refusal on `rival` or on `measuredPct`: those two rest on synthetic worlds (a lattice under the true map 0.49 and three periods off 1.03, at about 5.7 sigmas; a part displaced over 30 % of the window 37 to 40 sigmas, over 20 % 23, over 15 % 10.0 at a share of 0.045, not refused, over 10 % 5). **Slatina and F007 on Pitești now search and wait for points**, because a frame the model puts up to 30 km away gets its search: no false result, but a frame truly off the city costs about 30 s and a bounded crop where it used to fail at once, and asks for points instead of naming another frame.

**Twelve warps on real frames.** The KH-9 frames forced to three scales (0.85, 1, 1.15), as a Corona or a KH-7 frame searches, 180 tiles a warp: see the table below. At 60 a warp, the earlier share of the budget, no warp of F006, F040 or A001 reached `VOTE_MIN_AGREE`. These are KH-9 frames standing in: no Corona or KH-7 frame has run.

| Frame, Bucharest | Votes | Tiles agreed | Figure, 5 folds | `checkpointRmseM`, blocked | Search s |
| --- | --- | --- | --- | --- | --- |
| F006 | 12 of 196 | 395 of 492 | 14.0 m | 14.6, 11.5 m | 170 |
| F007 | 21 of 196 | 706 of 939 | 16.7 m | 14.3, 13.9 m | 38 |
| F040 | 14 of 196 | 409 of 583 | 19.5 m | 15.3, 15.3 m | 138 |
| A001 | 17 of 196 | 928 of 1,187 | 17.7 m | 10.9, 14.8 m | 45 |

All four proved. **F006 and F040 miss the 2-minute budget of §9:** a weak proposal runs all twelve warps before its proof, 2,160 matches. They shared the NUC with a test suite, so the seconds are a poor measure, but the count is the count. A strong proposal, 16 votes or more, stops early, as F007 and A001 did. It stays under the worst case's 5 minutes here.

**Independent checks.** F006 and F007 against the earlier maps started from hand landmarks (`out/f006`, `f007`): median 2.0 and 2.3 m, largest 3.9 and 7.4 m over the tiles. A001, F040 and F006 on Pitești have no such truth: a checkerboard against Sentinel-2, by eye on one square of 1,200 cells each, shows roads and rivers running on across the squares. That is the only check they had; no landmark.

**Wrong proposals straight into the proof** (`m9-false.py`, each frame's first guess under all four orientations, kilometres off, so the votes cannot help): at most **18** tiles agree (of at most 61), every one refused `few-inliers` against the gate's 60, on F006, F007, F040, A001 and F006 on Fetești; Slobozia's first guesses, off its window, refuse `small` at once (the frame does hold Slobozia: corrected above). The true places hold 402 to 1,039. A001's first guess under its true orientation lies close enough to prove by itself. So `PROOF_MIN_INLIERS` and `PROOF_MIN_SHARE` have refusals measured against them now; **`PROOF_MIN_SPREAD`, `PROOF_MIN_COVERED`, `PROOF_MAX_CV_M` and `PROOF_MAX_GROSS` were reached by no real wrong proposal: still first values**, tried on synthetic tiles alone.

**Against the brief, plainly:**

- **F040 does not refuse.** The brief asked for a clean refusal; the frame is found, proved and aligned by eye, so a refusal would be the bug. Clean refusals are shown on Slatina and F007 on Pitești (by the model's shares, corrected above), and on a film over another place and a uniform film (synthetic); Fetești and Slobozia, listed here at first, were misses. Whether F040 is good enough is another matter: its checkpoint figure, 24.9 m, is the worst here.
- **Pitești on F006 is true, not false.** 1,039 tiles at 14.4 m and the checkerboard agree: Pitești is on that strip. The votes refuse Fetești on F006 and F007, and on F006 that is a miss (corrected above). No false result in these runs.
- **Most frames will wait for one click.** `checkpointRmseM` is under the 15 m threshold on A001 alone (13.0 m); F006 19.5, F007 17.3, F040 24.9, Pitești 15.5. It is a figure of 13 to 25 checks; the steadier blocked figure is 11.5 to 15.0 m. The threshold stands (§13.2).
- **Timings are a good case.** Under 50 s for `locate` where the budget is 2 minutes, but on a warm disk with local segments, under a 4-CPU quota on a 16-core NUC, not a 4-core PC. Staging the segments from a bucket is not in them.

**Built differently from the sections above:**

- `SensorSpec.full_aspect` (20.2, four real frames: 19.6 to 20.5) and `PanoramicCamera.sweep_deg`: a film under 90 % of it swept less, its angle from its aspect, and `tan(wide) = (ratio - cos(sweep)) / sin(sweep)` from its ends' widths on the ground puts the nadir (A001: -7.8 to 52.9 degrees; -8 to 52 worked out by hand first gave the same place). **One frame only:** no other short frame has run.
- The preview is no longer blurred before the votes (A001: 15 agree with one cell of blur, 17 without; 13 at scale 0.94).
- A window too small for 64-cell tiles at 43 m gets finer cells (down to 30 m) and smaller tiles (down to 24 cells): a real small town has not run. A synthetic 6 by 4.8 km window reached 35 tiles, under `PROOF_MIN_INLIERS`: so small a window goes to the matcher.
- The search image stops where the film's exposure ends; counted matches are unchanged, each is cheaper.
- `calibration.how` is `local-ai` for any matcher's proposal, proved over at least 30 km since M10 (`docs/research/M10-local-ai.md`); `matcher` is what `georef` writes when its matcher fitted a frame whose tiles gave no fit.
- `model` is measured from the votes' similarity, not the proved map: a place to look, 12 km of margin around it. On F007 under F006's prior it moved 6.4 km and proved at once.

**Not run:** a whole job on a real frame through `LocateStep`, `GeorefStep`, `warp` and `export`, so the 1,249 km² correction and `coveragePct` are tested on synthetic rasters alone; a real Corona frame (its `SearchRange` stays **UNVERIFIED**; KH-7, KH-9 mapping and KH-5 ran later, below) and a city far from Bucharest, which D4 still owes; Playwright: `S-P01-HAPPY-ADMIN`'s 3.5 by 2.8 km city is too small to prove, so it walks the matcher's path and, since §11 as built, takes one click.

### Three other cameras, and the KH-9 frames again (2026-11-07)

**Run:** `tools/m15-all.sh`, `m15-run.py` on the NUC, this tree's `pipeline/src`: the product's `first_guesses`, `reaching`, `find_frame`, `calibrated`, `proved_box`, `crop_pixels`, with `frame_pixel_m` and the job id's seed; KH-5 through `Scene.corner_quad`, no corners. Three frames at a time, each `--cpus=4 --memory=6g`, so the seconds are rough. The window is Bucharest's, the reference `s2-bucharest.tif`. No landmark, no prior.

| Frame | Metadata said | Result | Votes | Tiles agreed | 5 folds (checks) | Pairs + checks, transform | `checkpointRmseM`, blocked | Rival, sigmas | `measuredPct`, `coveredPct` | Search + crop s | Peak GB | Crop px | Checkerboard, read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DZB00403000026H017001, KH-7, 1966 | 46 km of a strip 51 km long, 22 km off | **proved** | 15 of 196, rotation 270, scale 1.1, shear 7.5 | 538 of 689 | 12.8 m (90) | 109 + 18, poly2 | 15.2, 12.7 m | 0.126, 4.7 | 84.8, 49.0 | 61 + 2.9 | 1.33 | 21,379 x 30,563 | Băneasa's runway, the forest's edge and the streets run on across the squares |
| DZB1214-500086L005001, KH-9 mapping, 1978 | right, within 0.1 km | **proved** | 19 of 196, rotation 90, scale 1 | 1,053 of 1,233 | 12.0 m (151) | 75 + 16, poly2 | 15.8, 11.3 m | 0.068, 3.7 | 90.9, 100 | 22 + 0.5 | 2.06 | 9,333 x 9,560 | Herăstrău's shore, the railway and the streets run on; its reseau crosses show |
| DS09065A089MC039, labelled KH-4A, 1964, corners null | its footprint, 20 km off at the city | **refused**, `no-votes` | 0 | | | | | | | 70 | 1.17 | bounded 14,076 x 14,094 | nothing to read |

| KH-9 pan, Bucharest | Votes, scale that won | Tiles agreed | 5 folds (checks) | `checkpointRmseM`, blocked | Rival, sigmas | `measuredPct` | Search s | Same as before? | Checkerboard, read |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F006 | 20, 0.94 (12 at 1) | 402 of 500 | 14.3 m (74) | 19.5, 11.5 m | 0.174, 4.3 | 79.4 | 49 | as `m14c`; about 25 s more than one scale | a runway and the shore run on; a film edge's black sliver |
| F007 | 21, 1 | 708 of 942 | 16.7 m (116) | 14.2, 13.7 m | 0.090, 3.5 | 87.2 | 22 | as `m14c` | Carol Park's axis, the railway |
| F040 | 20, 0.94 (14 at 1) | 412 of 582 | 19.5 m (63) | 19.0, 13.9 m | 0.152, 4.2 | 82.5 | 45 | as `m14c`; about 20 s more than one scale | streets, the railway; low contrast in the fields, a weaker look |
| A001 | 16, 1 | 919 of 1,180 | 17.9 m (139) | 21.3, 14.0 m | 0.088, 4.0 | 87.5 | 26 | was 13 at 0.94, 922 of 1,192; see below | under cloud in places, streets run on between |
| F003 | 24, 1 | 1,119 of 1,374 | 18.6 m (165) | 16.8, 14.7 m | 0.066, 3.8 | 84.1 | 19 | as `live-s1` | lakes, the railway |
| F022 | 52, 1 | 1,126 of 1,359 | 16.1 m (165) | 22.1, 13.4 m | 0.061, 3.5 | 87.4 | 18 | as `live-s1` | lakes, the railway |
| A015 (1983) | 17, 1 | 1,126 of 1,418 | 15.9 m (169) | 16.9, 14.0 m | 0.067, 3.8 | 87.2 | 25 | **`no-votes` before: rescued** | lakes and streets run on |
| A038 | 48, 1 | 1,164 of 1,326 | 14.8 m (173) | 12.0, 14.0 m | 0.060, 3.7 | 87.9 | 25 | as `live-s1` | lakes, stadium; slivers of film edge |
| F049 | 27, 1 | 922 of 1,119 | 14.6 m (136) | 13.8, 12.8 m | 0.084, 3.9 | 86.9 | 20 | as `live-s1` | lakes, Carol Park |

Every checkpoint figure above was recomputed from `pairs.json` alone (`m15-verify.py`) and equals the saved one. Gradient correlation inside each checkerboard's region against the same region 300 m off: 0.206 / 0.127 (KH-7), 0.136 / 0.028 (mapping), and 0.083 to 0.239 against 0.007 to 0.142 on KH-9 pan: higher in place on all eleven. The eye read one square of 1,200 cells on each; **no landmark checked any of them.**

**A001's checkpoint figure** moved from 13.0 to 21.3 m, its 12 checks being other cells under the job id's seed: the same code under the earlier harness' seed reads 10.9 m, blocked 14.8. A figure of a dozen checks moves that far with the seed alone, which is what the blocked figure is for.

**Windows the votes do not prove, same code** (the frames do hold Fetești and Slobozia, corrected above): F006 on Fetești, Slobozia, Slatina and F007 on Fetești, Pitești: `no-votes`, 33 to 51 s, bounded crop. F006 on Pitești stays proved (1,041 of 1,171, 14.4 m). KH-7 on Fetești and Pitești and mapping on Fetești, Slobozia, Slatina: `cityNotFound`. Mapping on Pitești, whose western edge the footprint barely reaches: `no-votes`, a bounded crop of 26,975 x 32,850; whether the frame holds it was not read.

**Wrong proposals straight into the proof** (`m15-false.py`, every warp's first guess, kilometres off): KH-7, 24 warps: none accepted, at most 17 tiles against the gate's 60. Mapping, 4 warps: the true orientation proves itself (1,053 of 1,235, a median of 9.0 m from the proved tiles), the other three at most 13. KH-5, 8 warps: at most 10. All `few-inliers`.

**What the frames showed, and what changed:**

- **KH-9 pan: scales 1 and 0.94** (Part 1). The model's scale first: four warps at 1, then four at 0.94, 1,440 matches at most where there were 720. Seven of nine frames agree strongly at 1, so they stop early and it costs nothing; F006 and F040 are weak at 1, so they run all eight, 20 to 25 s more. A015 goes from `no-votes` to proved. No frame lost its proof.
- **KH-7 is a parallelogram.** The proof's map against the metadata: the long side lies right (10.5 degrees from north, 11 said), but the short side runs at -0.9 degrees where the corners say -7 to -12, 22 km ground off along the strip, pixels 13 and 8 % larger than the corners give. No vote: the corner homography at scales 0.95 to 1.25 under a 30 km margin, a square-pixel similarity at those and at 0.8 to 1.75 under 70 km. Under the true affine 23 of 196 agree at margins from 2 to 30 km. A tile of 64 cells cannot bear 10 degrees of shear. So `SearchRange.shears_deg`, `Hypothesis.shear_deg` and `votes.sheared_about`: the short side turned, the long side kept, about the window's centre, the same on the ground under every orientation; a margin of 30 km and scales 1, 1.1. Agreeing warps: 5 and 10 degrees, not 0 or 15; so 7.5, both ways, as a pass the other way may lean the other way (**not seen: one frame**). The cause was not established.
- **`MAX_ANISOTROPY` 3 to 2.5.** A 1:2.25 strip's quarter turn reads 3.9 against 1.3, which 3 let through: 8 orientations and 48 warps. Now 4 and 24.
- **KH-9 mapping needed nothing.** 15 km and scale 1 hold; the votes read 0.969 and 0.1 km.
- **DS09065A089MC039 is no KH-4A: it is a KH-5 Argon.** Mission 9065A is on USGS's ARGON list, MC its mapping camera; the code's table knew only KH-4x for `corona2` and fell through to KH-4A. USGS gives 460 feet, about 140 m (KH-4A's 2.75 m is what the admin read). Its 16,330 px at 7 µm is 114 mm; an older USGS listing says 5 by 5 inch film, so the format here is measured, not read. New sensor `KH-5` (140 m, z8 to z12, 1.0 at 30 km), and `scene-record.ts` reads the camera from the id when the metadata does not: `DS0*9nnnAnnnMCnnn` KH-5, `DS11nn` KH-4B, `DS10nn` KH-4A, `DS9nnn` KH-4, `DZB...H` KH-7, `DZB...L` KH-9 mapping. The metadata still outranks it. **The id rules are read from these frames and the fixtures, not USGS's documentation, and the stored scene stays KH-4A until a search updates it.** KH-6 Lanyard ids still read KH-4A.
- **Corners null works.** The footprint's extremes give the right quad and rotation 180 is the true orientation, about 20 km off; `frame_pixel_m` reads 58.5 Mercator metres.
- **It truly cannot be proved, under these gates.** From a start placed by hand on Lake Greaca (±4 km, 81 starts, one orientation, this probe only): at most 14 of 20 tiles, `few-inliers` against 60; six warps' votes around it: none. A tile of 900 m is about 6 resolution elements at 140 m, and the 30 m gate is under its pixel. No gate moved. The frame waits for the admin's points, whose scan is nearly the whole frame. Such a frame adds nothing to a city's map: it should not be bought or imported, and it now says what it is.
- **KH-7's seam is not understood.** At film x about 36,000 the two segments' content does not run on: a bright band, a dark band before it, and curved field edges after it. Bucharest stops at x about 21,400 on this frame, so nothing here crossed it; **a city beyond it is untested and the stitch was not changed.** The KH-9 mapping frame's seam does run on.

**Against the brief, plainly:**

- **One frame a camera.** KH-7's shear, scale and margin and mapping's range rest on one frame each, one city. The KH-4x ranges are still **UNVERIFIED**: the "Corona" frame was not one.
- **KH-7 covers 49 % of the city, mapping 100 % at 7.5 m.** Neither publishes itself unless every rule of §11 holds: KH-7 under 90 %; mapping's checkpoint 15.8 m misses 15 m by 0.8.
- **A same-pass prior loses the shear:** `MeasuredModel` is a similarity, so a KH-7 neighbour's prior will likely refuse and fall through to the full search, costing time, not truth. Not run.
- **Harness, not a job:** `LocateStep`, `georef`'s `matcher`, `warp`, `export` were not run on these frames, F039 was not rerun (its corners were not at hand), and the seconds shared the NUC three at a time. One harness slip: `f007-pit` collided on a container name and was rerun alone.

## 15. Server and admin, as built (2026-11-06)

Everything of §7, §8, §11 and §12 landed; where it differs:

| Spec | As built | Why |
| --- | --- | --- |
| `CITY_MIN_COVERAGE_PCT` in `approval.ts` | In `schemas/imagery-settings.ts`, and read by the join's offer too | One bar for the policy and the page. |
| The pass's key | `passKeyOf` in `schemas/imagery-calibration.ts`, spelt as `calibrate/prior.py`'s `pass_key` (both tests name `D3C1203-300415-F-1975-08-20`) | A pipeline read and a server write must agree. |
| `allow-list.ts` adds the pass | `documentTarget` answers `pass` for the scene's mission and camera with any `YYYY-MM-DD`; a read through `worker.step`, never a write | The date lies on the scene, which the list does not read. |
| Keys of §8 | `covered` is the existing `join.coverageMeasured`, word for word; no `title`: `how` is the block's heading; `matcher` and `local-ai` read `how.votes` (the same proof, found automatically) | The budgets stay, with 630 KB in all and 18 KB for Imagery full; ten text keys nothing read went for the same reason (`adminContent.map.label`, nine of `adminContent.photos.*`). |
| The block in `imagery` | `calibration-card.ts` is part of the `join-card` chunk, rendered by its `versionJoin` and `joinReport`; any open version fetches it, so on the card the waits come above the error | The Imagery chunk reached 18.5 KB; budgets are not raised. |
| Rows of §10 | Also `S-A66-HAPPY-MEASURED-OUTLINE`, `S-A67-HAPPY-PASS-RECORDED`, `S-A67-BAD-PASS-NOT-PROVED` | §2 and §5 are behaviours too. |
| A seam of a join (M8) | A refused correction on a seam at or under `SEAM_ALREADY_CLOSED_M` (2 m) reads `applied: true`, nothing moved | Real frames joined at 0.34 m on the e2e world and waited for a click, as nothing could improve them. |
| A delivery on a frame nothing proved | Stays, as §6 says, also once the matcher succeeded: `S-A62-HAPPY-WORKER-RUN` asserts it. Until the bucket's 7 days, or on a worker's disk until a pass that claims nothing, once it is 7 days old (`LocalObjectStore._stale_folders`): a stopped or always busy worker keeps it longer. **This job never reads it again:** `extract` is its only reader and `runner.py`'s `LOCATE_INPUTS` keep it from running once `locate` is finished, and re-cropping a stored frame is cut (§13). All it buys is that another import of the same scene within those days, this city's or another's, skips the download (`FetchStep._delivered`) | **Open for the owner:** delete it at the end of `locate` too? About 8.7 GB held for up to 7 days, against a free re-import of a frame nothing proved. |
| A crop of a USGS frame | Under 90 % of the city it waits for one click, as §11 says (`S-A16-HAPPY-CROP`) | The rendered figure survives a crop. |
| The admin's budget | 629.0 KB of 630: `packages/admin/vite.config.ts` drops annotation comments from the chunks (1 KB), since nothing bundles them again; the card's one `waits.notProved` replaces `selfChecked` | Not raised. |
| `coverage_pct` | Stops at 100 | Whole pixels over a fractional span read 100.04 %, which the schemas refuse (`docs/LESSONS.md` 370). |

A frame nothing proved shows `notFound` only while it needs points; once it has them it shows the fit's figures. A re-rendered version carries no `calibration` (`regeoref.ts` does not copy it), so its page has no block, and its `source` keeps it under the coverage rule.
