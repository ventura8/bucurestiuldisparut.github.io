# M15: calibration accuracy, what to build

The owner, 2026-11-08: improve the calibration error. Evidence: [M9 §14](M9-calibration.md#14-rehearsal-on-real-frames-2026-11-06) and `reports/calib/accuracy/` (git-ignored), on 11 Bucharest frames (KH-9 pan from 8 missions, KH-7, KH-9 mapping) plus F006 over Pitești. No product code changed.

**The ruler.** Sentinel-2 cannot judge a 5 m map: its tile noise against film is 10 to 14 m. The judge is the **film ruler**: 52 pairs of frames compared with each other, ground metres, held out twice (3.2 km blocks, 900 m buffer, unseen by both fits; repeated on 8 km blocks). Self-checks: a frame against itself reads 0.007 m; an injected field returns within 1.5 m. Blind spot: an error all frames share, above all an absolute shift. "Per frame" splits a pair's error between its frames (three-cornered hat).

## Error budget, today's product

| Term | Size | Evidence |
| --- | --- | --- |
| **Published layer is not the fitted map** | 8.5 to 13 m RMS, 252 m at a corner | `gdalwarp -order 2` fits its own inverse polynomial |
| **Camera misfit, KH-9 pan** | 5 to 11 m | cubic-shaped along the scan; KH-7 3.2, KH-9 mapping 1.0 |
| Too few points in the fit | 3 to 5 m | camp on ~100 pairs 11.1, on every tile 7.7 |
| Film tile noise | 2 to 5 m a tile | averaged over thousands of tiles |
| Seams | 0.4 to 4.7 m, 12.7 m worst tile | segments are turned; `stitch` only shifts |
| Terrain (Bucharest) | at most 5.6 m | bounded on A001; no DEM |
| Sentinel-2 absolute | about 4.6 m RMS | my arithmetic from under 8 m CE95, not measured |

Double held out, 52 pairs: **15.7 m RMS** fitted, **14.4 m** as GDAL renders it; per frame 3.2 to 12.3 m (median 7.0).

## What is achievable, and the floor

- **Between frames, about 4 to 5 m per frame.** With the camera model the real render reads 2.5 to 6.7 m (median 4.4).
- **The floor:** on every tile all flexible models converge at 6.4 to 6.6 m pair RMS (about 4.6 m per frame); with tile noise extrapolated to zero, 5.4 to 6.25. What remains is film tile noise and misfit no model holds; more freedom (poly4, free warps) gets worse held out.
- **Absolute: about 5 to 8 m, unproven.** Sentinel-2's shared error adds to every frame and the ruler cannot see it; OSM or a second scene would measure it.
- **The Sentinel-2 checkpoint figure stays near 17 to 25 m** even as the map improves (camp 21.5 against 24.2): reference noise and 50 years of city change dominate it.

## Build, in order

1. **Render what we fitted.** *Built (As built, below).* Sample the fitted map on a lattice and warp with `-tps`: 14x14 (196, under `MAX_AUTO_GCPS` 200) reproduces it within 0.02 to 0.79 m; 17x17 (289, under `MAX_GCPS` 300) better. Camp rendered: 6.69 m against 6.61 m in Python. Cost: 109 s against 95 s a full warp, same 6.7 GB peak. Nodes are not measurements: they need an origin `lattice` that the editor, `checkpointRmseM` and leave-one-out skip. Every later gain depends on this.
2. **Panoramic camera model (camp), KH-9 pan only.** *Built (As built, below).* Five physical angles under a soft prior plus poly2, fitted on **every gated tile** after blocked checkpoints are set aside (stored pairs stay as the editor's sample). Double held out 15.72 → **7.70 m** (gain 4.1 to 13.3 m, 95 %); 8 km blocks 26.7 → 11.4; 52 of 52 pairs better; beats poly3 by 0.7 to 4.8 m. Fit 0.2 s. Without the poly2 term it gets stuck, so it never ships without it. KH-7 and KH-9 mapping keep poly2.
3. **Orientation matcher** (structure tensor, double angle) in `measure`. −0.44 ± 0.17 m on every tile, −1.2 to −1.5 m with ~100 pairs; 46 of 52 pairs, every sensor; a real warp agrees (5.32 → 4.89). Its own figure overstates the gain twentyfold. Cost +0.2 to 1.2 s a round, memory 1.2 to 2.0 GB against 0.85 to 1.3. The peak gate is reset on the wrong-place null (1.4 % false tiles).
4. **Adjust a city's frames together** (film ties, weight 9). Poly3 alone → together 9.80 → 6.02 m; the never-fitted same pass 17.1 → 4.7; 52 of 52. Sentinel-2 does not move: this is consistency between layers (swipe compare), not absolute position. Solve 0.55 s, ties 48 s. **It reissues published versions: the owner's decision.**
5. **Rigid stitch** (rotation and shift per segment). Worst seam tile 12.7 → 0.94 m, same pass 4.69 → 3.95, overall only 6.02 → 5.98. 0.6 s a seam; it also fixes seams like KH-9 mapping's, 52 m off outside this crop.

Steps 2 to 4 were read alone; together they are unmeasured. Each lands only if the ruler repeats the gain after a whole job (`prove` → `pairs` → warp) on these frames **and** a second city.

## Do not build

| Variant | Why |
| --- | --- |
| poly4 | 18.2 m held out, 66.8 m same pass |
| poly3 as the answer | loses to camp; KH-7 extrapolation 37.8 against 20.2; runs away over holes |
| Thin plate, smoothed grid | 11.2 and 10.5 against 7.7; the grid on camp broke at 102 m |
| Mutual information | +0.67 m, six times slower |
| Strong tiles only, peak weights | +0.11 to +1.57 m: better own figure, worse truth |
| Land-cover masks, shadow filters | +0.16 to +2.88 m |
| Five-scene median, for the map | +0.31 m; can only help absolute, unmeasured |
| Per-segment S2 steps; align's seam pass across dates | overfit; 1 to 5 of ~25 samples pass |
| Coarse-to-fine | broken code (42 to 100 m), not judged |

## Waiting on the owner

- **Downloads**: a second Sentinel-2 scene (~44 MB, [Copernicus, free with attribution](https://ads.atmosphere.copernicus.eu/licences/ec-sentinel)), an OSM extract ([ODbL](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)), Copernicus DEM ([GLO-30 licence](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf), to be accepted). They measure absolute position and terrain, small here, tens of metres in a hilly city.
- **M9 §13's cut on poly3** rested on the noisy Sentinel-2 reading; camp supersedes it.
- **Auto-publish** reads the saved checkpoint figure (12 to 22 m), which flatters: blocked, the same frames read 19 to 30 m. Move the threshold to the blocked figure.

## What the admin should see

Today: "Measured error 15 m", which mostly says how far today's satellite image is from a 1970s city. Instead:

- **"Lines up with your other photos within 5 m"** (`calibration.agrees`; ro *Se potrivește cu celelalte fotografii la 5 m*): the film ruler, when another frame overlaps. This is the figure that improves.
- **"Compared with today's satellite image: 21 m, including what was built or demolished since"** (`calibration.vsToday`; ro *Față de imaginea satelitară de azi: 21 m, inclusiv ce s-a construit sau demolat între timp*).
- **A shaded outline of the measured part**; outside it, "estimated, not measured here" (*estimat, nemăsurat aici*): unreached corners carry the largest errors.
- No absolute claim until OSM or a second scene measures one.

Keys in `ro` and `en`, inside the 650 KB budget, with a happy and a bad row in `e2e/scenarios.json`.

## As built (2026-11-08): steps 1 and 2

**Built.** Step 1 and step 2; steps 3 to 5 and the admin's new figures are not (below).

- **The layer is the fitted map** (`steps/warp.py` `rendered_points`, used by `warp` and by the join's `join/warping.py`). Every georeferenced scan warps with `-tps`: a thin-plate spline through its own enabled points; an affine or poly2 fit through 17 x 17 nodes sampled on the fit over the scan (`georef/lattice.py`), worked out at the warp from the pairs, so nothing is stored; a map its pairs cannot rebuild through its stored nodes. An upload's own georeference is unchanged.
- **Contract: `georef.lattice`** (`georefSchema`, `documents.py` `GeorefInfo`): `{model: 'panoramic', nodes: [{pixel, geo}]}`, exactly the 289 nodes the pipeline samples. Nodes are not measurements: they sit beside `gcps`, so no editor, residual, checkpoint or leave-one-out reads them. `imagery.saveGcps` writes a fresh georef, so the admin's points drop them (`S-A16-BAD-POINTS-DROP-LATTICE`); a crop or a re-render keeps the same scan and keeps them; a `georef` retry over them keeps the georef as it is (`kept: the panoramic map ...`).
- **The KH-9 pan camera** (`calibrate/camera.py`, `calibrate/pairs.py`): `locate` stores the film's radians a column in `calibration.json` (`radPerPx`, `steps/locate.py` `rad_per_px`: 121 degrees over the exposure, a shorter film at the full film's rate), KH-9 pan only. `calibrated` fits the camera on **every** gated tile of the cells not held for checks; the pairs stay the editor's sample (the same RANSAC as before) and `transform` stays theirs; their residuals, the checks (gated at 100 m against the camera), `checkpointRmseM`, `fitRmseM` and `crossValidatedM` (each fold of the pairs' 3.2 km cells against the camera fitted on the tiles outside it) are the camera's, and the lattice carries it to the warp. A camera holding under 90 % of the tiles the polynomial's RANSAC kept is not used. KH-7, KH-9 mapping, an older `calibration.json`, a re-measured proof and the admin's points keep their polynomial (rendered through the lattice).
- Rows `S-P06-HAPPY-RENDERED-FIT`, `S-P06-BAD-RENDERED-OWN-POINTS`, `S-P06-HAPPY-PANORAMIC-CAMERA`, `S-P06-BAD-PANORAMIC-FALLS-BACK`, `S-A16-BAD-POINTS-DROP-LATTICE`.

**Run.** On the NUC, `pipeline/src` of this branch (`src-accuracy`), `tools/m15b-product.py`, `m15b-warp.py`, `m15b-table.py` (copies with every output in `reports/calib/accuracy/m15b/`, not tracked; outputs on the NUC in `out/m15b/` and `out/acc-transforms/b{3200,8000}/prod*`). Each fold's map is the product's: `calibrated()` on that fold's tiles from the frame's own `calibration.json` with the job's seed, `recorded()`, then GDAL's own transformer of what the warp is handed (`-order N` through the enabled pairs before; `rendered_points()` and `-tps` after), inverted by Newton: what the layer shows at each place. The judge is the film ruler of the evidence above, unchanged: 52 pairs, blocks shared by all frames, nothing within 900 m of a held block in either frame's fit, scored before any RANSAC; 5 seeds x 5 folds; the 95 % interval resamples frames. Today's product reproduced its saved figures (`fitRmseM`, `checkpointRmseM`, `crossValidatedM`) within 0.02 m on 10 frames of 12; KH-9 mapping's checkpoint read 15.2 against 15.8 saved and F006 over Pitești's 15.3 against 15.4, not traced.

| Film ruler, 52 pairs, double held out (median pair) | Today: poly2 of ~100 pairs as GDAL renders it | Step 1 alone | **Steps 1 + 2, built** | The evidence's `camp` |
| --- | --- | --- | --- | --- |
| 3.2 km blocks | 14.64 (13.19) | 16.03 (13.67) | **8.14 (7.94)** | 7.70 |
| pairs better than today; gain, 95 % | | 18 of 52; -3.9 to +1.6 m | **52 of 52; +3.8 to +9.4 m** | |
| 8 km blocks | 25.57 (22.60) | 28.02 (25.36) | **12.65 (12.19)** | 11.39 |
| pairs better than today; gain, 95 % | | 18 of 52; -7.5 to +2.8 m | **52 of 52; +7.8 to +18.0 m** | |
| Same pass F006-F007, 1,525 tiles: held out / every tile | 22.2 / 12.6 | 22.8 / 13.2 | **9.5 / 4.1** | 8.5 / 3.8 |
| Every tile, in sample | 10.88 | 10.85 | 6.92 | 6.55 |
| By pair kind, 3.2 km: pan-pan, KH-9 mapping-pan, KH-7-pan, KH-7-mapping | 14.4, 10.4, 18.8, 14.2 | 15.8, 13.6, 19.3, 8.4 | 8.0, 6.8, 9.7, 8.4 | 7.6, 6.2, 9.3, 7.8 |
| Sentinel-2 tiles held out, 3.2 km, mean RMSE over 12 frames | 22.9 | 24.3 | 21.7 | 21.5 |

Ground metres, RMS over pairs. Each frame, RMS of its own pairs, 3.2 km then 8 km, today to built: F006 15.7 to 9.5, 29.9 to 15.5; F007 14.2 to 7.8, 25.5 to 10.8; F040 20.3 to 9.2, 31.6 to 16.1; A001 14.6 to 9.4, 22.4 to 12.5; F003 12.0 to 6.7, 22.0 to 10.7; F022 12.1 to 8.2, 21.6 to 12.7; A015 12.5 to 7.9, 19.3 to 11.9; A038 15.7 to 7.0, 28.6 to 11.3; F049 12.6 to 6.8, 21.1 to 10.1; KH-7 18.4 to 9.6, 36.3 to 16.0; KH-9 mapping 10.8 to 7.0, 18.3 to 10.5 (7 to 10 pairs each; a pair counts for both its frames).

**The layer against the map it should show** (real `gdalwarp` through the product's `gcp_source` and `warp_method`, a ramp scan whose pixels hold their own column and row at an eighth of the size, z15 over the Bucharest window; every third output pixel): today 0.19 to 12.97 m RMS (A001 13.0, F003 10.9, F022 10.8, A015 10.2, KH-7 8.3, F049 4.9, F040 3.5, A038 2.1; worst pixel 59.7 m); built 0.28 to 0.92 m (worst pixel 11.7 m on KH-7, 6.2 m on F003, at the scan's edge). Over every pair tile the stored lattice lies 0.08 to 0.33 m RMS from the camera itself.

**Cost** (one real warp of the real scan at z17 over the window, 4 CPU, 16 GB, alone on the NUC): F003 84.3 s, 5.46 GB today against 87.5 s, 5.45 GB built; A001 118.2 s, 4.89 GB against 120.3 s, 4.89 GB. `calibrated` 0.06 to 0.11 s today, 0.3 to 1.1 s with the camera, plus five camera fits for the blocked figure. The 109 against 95 s above was a shared machine. Budgets unchanged; the admin's Imagery chunk sits at its 18 KB: the schema moves the shared chunk's hash, which the Imagery chunk imports by name, so the first form of the lattice read 18,001 bytes and the exact count 17,998.

**The saved figures move, and with them auto-publish.** Built, against today (`checkpointRmseM`, the checks held out of both fits): F006 19.5 to 19.1, F007 14.2 to 13.2, F040 19.0 to 15.0, A001 21.3 to 18.7, F003 16.8 to 10.8, F022 22.1 to 18.7, A015 16.9 to 14.7, A038 12.0 to 7.5, F049 13.8 to 9.2, F006 over Pitești 15.3 to 12.8; KH-7 and KH-9 mapping unchanged. Under the default 15 m, three KH-9 pan frames of ten were under it, and seven are now (F040 at 14.99). That is the owner's threshold reading a lower, still held-out figure; the blocked reading of *Waiting on the owner* stands.

**What the run showed, plainly:**

- **Step 1 alone does not show its gain on the ruler**: 14.64 to 16.03 m, 18 pairs of 52 better. On KH-9 pan frames GDAL's own reverse polynomial happens to sit closer to the truth than the poly2 fit it should render, as neither is the camera; on the one pair without a panoramic frame, KH-7 with KH-9 mapping, it is 14.2 to 8.4 m. It stays because step 2 cannot reach the layer without it and the published layer is now the map every figure describes. The cost of that: a KH-9 pan frame whose camera is not used renders about 1.5 m worse than today.
- **The guard was first "at least as many tiles as RANSAC kept"**: 9 of 500 fold fits fell back to the poly2 of ~100 pairs and read 20 to 30 m, and the built figure was 9.79 m. A camera that converged keeps 0.989 to 1.02 times RANSAC's count on all 500; a wrong rate keeps none (synthetic) or under a third. So 90 %. It changed after the ruler was read; the bound comes from those counts, not from the figure.
- **What remains to the evidence's 7.70 m:** the cells held for checks (0.30 m: the product's camera alone, no lattice, reads 8.00) and KH-7 and KH-9 mapping fitted on ~100 pairs rather than every tile (8.00 against 8.14 at 3.2 km, 11.88 against 12.65 at 8 km; KH-7 with mapping 7.8 against 8.4 and 10.3 against 15.2). That last is a candidate: a `polynomial` lattice of every tile.
- **The second city is unproven.** F006 over Pitești has no second frame, so no film ruler; Sentinel-2 held out reads 17.6 to 17.2 m on 3.2 km blocks and 19.6 to 20.8 on 8 km, inside its own noise. Its checkpoint figure falls 15.3 to 12.8.
- **Not run:** a whole job through the runner on a real frame (`LocateStep`, `GeorefStep`, `WarpStep`, `export`). The proof was not run again: `dense.py` and `proof.py` did not change, and the tiles are each frame's own `calibration.json`, written by the product. Those files predate `radPerPx`; the harness took it from `frame.json` through the product's `rad_per_px`, as `locate` now does.
- **Sources:** nothing downloaded. The Sentinel-2 window already on the NUC (Copernicus Sentinel data, free, full and open, with attribution); no Mapbox Satellite, no `fostulbucuresti` resource.

**Not built in this round:** step 3 (orientation matcher: it changes `measure` and the proof's gate, so every frame's proof must run again and the gate be set on a wrong-place null; -0.44 m on every tile); step 4 (frames adjusted together: it reissues published versions, the owner's decision); step 5 (rigid stitch: 6.02 to 5.98 m overall, it changes `stitch` and every film coordinate after it); the admin's figures of *What the admin should see* (the film ruler is not in the product).

## Review of 2026-11-08: the georeferencer and the edges

**The georeferencer showed a map that is not published.** It refitted a version's stored pairs with a polynomial on load, so a KH-9 pan version (its camera fitted on every tile, published through `georef.lattice`) showed other errors, residuals and warnings than its version page, and a preview of the pairs' polynomial. Built: while the pairs and the transform are the version's, the page shows the figures and residuals the version stored and previews the lattice through a thin-plate spline, as the warp renders it (`packages/admin/src/georef/fit-view.ts` `ownFitOf`, `shownFit`); once they change, every figure and the preview are the refit, and a note says Save replaces the version's map with it (`adminContent.georef.refitted`). A version with no figures of its own (corner guesses) shows the refit with no note. Rows `S-A16-HAPPY-VERSION-FIGURES`, `S-A16-BAD-EDIT-REFITS`; state `georef.refitted`; `docs/LESSONS.md` 398.

**A001 at its edges.** The ruler's edge readings fit each frame on the middle 70 % of its tiles along one axis (900 m margin) and read the outer 15 % each side against the other frames' whole maps. On the film ruler A001's rows beyond its tiles read 15.5 m today and 19.2 m as built. Measured, through the product's functions on the folds of `tools/acc-transforms.py` (`tools/m15c-edge.py`, `m15d-try.py` on the NUC; outputs `out/m15c/`, `out/m15d/`):

| Variant (film ruler) | 3.2 km held, pairs | 8 km held, pairs | Edges along the rows, A001 | Edges along the scan, mean of 11 frames |
| --- | --- | --- | --- | --- |
| As built | 8.14 | 12.65 | 19.2 | 10.9 |
| Second-order term carried on its tangent beyond the tiles' box | 8.13 | **21.51** | 18.9 | **29.7** |
| The same along the rows only | 8.14 | not run | 18.9 | 10.9 (rows: F003 7.4 to 22.2, A038 9.3 to 23.1) |
| No v² term | 8.12 | not run | **24.0** | 10.8 |
| **Plainest of two mirrored cameras (built)** | **8.13** | **12.50** | 19.2 | 11.0 |

- **Falling back to a lower order where no tile is loses.** The tangent fallback cuts curvature that is real on most frames (along the scan F006 13.3 to 51.1 m, F003 6.9 to 65.8 m). The frame's own poly2 read on the same strips (stored `prodfit`) is better than the camera only on A001 and F007 along the rows (13.7 against 19.2, 15.0 against 15.9), level on F006 (19.6 against 19.7), and worse on every other frame along the rows and on every frame along the scan (F040 rows 28.9 against 16.8, F003 12.4 against 7.4). Neither was built.
- **What was wrong instead: a coin toss between mirrored cameras.** Each KH-9 pan frame has two cameras mirrored about the nadir that hold the same tiles within a tile or two (A001, on the tiles not held for checks: 700 and 698); one needs a second-order term of 0.3 to 1.2 km, the other 4.3 to 8.7 km, and the product kept whichever held a tile more or came out a hundredth of a metre closer. On every tile it had kept the bent one for A001 (8.7 km), F022 (7.4 km) and F049 (4.3 km). The two agree within 0.1 to 0.7 m RMS at the lattice's nodes over the tiles and part by 5.6 m RMS (23.1 m at worst) beyond them on A001, 4.6 (11.8) on F022, 2.0 (6.1) on F049. Built: both signs of the scan angle are followed, and of the cameras within 1 % of the most tiles the one with the smallest second-order term is kept (`calibrate/camera.py` `plainest`); a camera holding clearly more tiles still wins. Synthetic: the bent mirror (899 tiles against 898) read 4.1 m RMS beyond the tiles, the plainest 1.8 m. Rows `S-P06-HAPPY-CAMERA-PLAINEST-MIRROR`, `S-P06-BAD-CAMERA-PLAINEST-ONLY-AMONG-EQUALS`; `docs/LESSONS.md` 399.
- **On the ruler it is neutral, not a gain.** Against as built: 3.2 km gain −0.02 to +0.06 m (95 %, frames resampled), 33 pairs better and 18 worse; 8 km −0.04 to +0.34 m, 41 better and 10 worse; against today 52 of 52 better at both sizes. **A001's edge is not fixed**: 19.2 m along the rows, as built. The cause is not established: on those strips A001's own poly2 reads 13.7 m as fitted and 15.5 m as GDAL rendered it before M15, the evidence's poly2 of ~100 pairs 17.4 m and the camera variants 18.8 to 24.0 m; A001 is the frame with the strongest relief term (slope near 1 at tan 1.14, `acc-open-refs.md`), which no model here holds.

Each frame, today (before M15) / as built / now: own pairs on 3.2 km blocks; on 8 km blocks; film edges along the rows; along the scan (metres):

| Frame | 3.2 km | 8 km | Edge, rows | Edge, scan |
| --- | --- | --- | --- | --- |
| **A001** | 14.60 / 9.39 / 9.37 | 22.38 / 12.53 / 12.35 | 15.5 / 19.2 / 19.2 | 16.1 / 13.4 / 13.4 |
| **F006** | 15.65 / 9.52 / 9.50 | 29.89 / 15.52 / 15.26 | 19.8 / 19.7 / 19.7 | 21.1 / 13.3 / 11.9 |
| F007 | 14.24 / 7.82 / 7.81 | 25.47 / 10.80 / 10.60 | 17.1 / 15.9 / 16.0 | 27.2 / 12.3 / 12.6 |
| F040 | 20.32 / 9.21 / 9.14 | 31.63 / 16.15 / 16.05 | 30.7 / 16.8 / 16.8 | 33.2 / 16.2 / 16.2 |
| F003 | 12.00 / 6.73 / 6.74 | 22.02 / 10.70 / 10.81 | 11.9 / 7.4 / 7.5 | 12.0 / 6.9 / 6.7 |
| F022 | 12.06 / 8.22 / 8.22 | 21.58 / 12.65 / 12.27 | 12.0 / 11.3 / 11.3 | 14.2 / 10.1 / 10.2 |
| A015 | 12.54 / 7.89 / 7.88 | 19.29 / 11.86 / 11.61 | 10.6 / 8.9 / 8.8 | 15.6 / 10.5 / 11.7 |
| A038 | 15.67 / 6.95 / 6.90 | 28.56 / 11.29 / 11.11 | 13.9 / 9.3 / 9.3 | 21.1 / 8.0 / 8.5 |
| F049 | 12.61 / 6.82 / 6.82 | 21.06 / 10.14 / 9.92 | 13.2 / 7.3 / 7.3 | 19.5 / 9.4 / 9.4 |
| KH-7 | 18.38 / 9.58 / 9.62 | 36.28 / 15.98 / 16.04 | 33.6 / 15.6 / 15.6 | 18.2 / 12.9 / 13.0 |
| KH-9 mapping | 10.82 / 6.97 / 6.95 | 18.30 / 10.46 / 10.30 | 13.7 / 11.8 / 11.8 | 9.4 / 6.9 / 6.9 |

KH-7 and KH-9 mapping keep their polynomial; they move only through their partners. **F006 over Pitești** has no film ruler; Sentinel-2 at its edges (rows, scan) reads 19.8 / 25.6 today, 20.0 / 27.5 as built and 20.0 / 27.7 now, its held-out Sentinel-2 figure 17.6, 17.2, 17.2: its camera is the same one (scan angle −0.611 rad, second-order term 689 m).

**The saved figures move a little** (`checkpointRmseM`, on every tile, as built to now): A001 18.75 to 18.86, F022 18.72 to 18.33, F049 9.24 to 9.37, F006 19.10 to 19.19 (a camera near the nadir, 0.06 to 0.00 rad); the others are unchanged to 0.01 m; `crossValidatedM` moves by 0.15 m at most (F040 13.31 to 13.16). Cost unchanged: three starts followed, as before.

**Not run:** a whole job through the runner on a real frame; the second city has still no film ruler.
