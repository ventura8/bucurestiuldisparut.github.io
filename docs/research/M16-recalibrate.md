# M16: Recalibrate a published layer (contract)

The owner, 2026-11-08: "build in the ability to calibrate even more a satellite image after publishing (manual, automatic, semi-auto)". No cloud project, Mapbox or Chrome is touched by this work; nothing runs in production yet.

## 0. What exists, and what this adds

Before this milestone a published layer could already be changed in one way: the georeferencer's **Save** on a published version, or on one waiting for approval, makes a new `regeoref` version from the same scan (`functions/src/imagery/regeoref.ts`, `save-gcps.ts`), which waits for Approve (it has no `calibration`, M9 §11). Nothing measured whether it was better, nothing refined a fit automatically once it existed, and the proof's dense matching (`calibrate/`, M9 §4) ran only inside an import.

This milestone adds, on **every published layer and on a version waiting for approval**:

| Route | Who starts it | What it does | Renders |
| --- | --- | --- | --- |
| **Automatic** (`route: 'auto'`) | **Refine automatically** on the version's page | Reruns the proof and the dense matching on the stored scan, started from the current fit | Only if the held-out figure improves on the current fit's, measured on the same checks (§2); otherwise the job ends with the reason and nothing changes |
| **Semi-automatic** (`route: 'points'`) | **Snap my points** in the georeferencer, after placing 1 to 12 rough points where the image looks off | The rough points bend the start; the dense matching snaps them and spreads tiles around them | Whenever the proof holds; the figures before and after are on the page, and the proposed pairs can be accepted (Approve) or rejected one by one in the georeferencer (§3) |
| **Manual** (`route: 'manual'`) | The georeferencer's **Save**, as today | Every pair editable | Always; figures before and after when the version holds checkpoints the fit never saw (§2) |

Every route makes a **new version** of the same layer, from the same scan. It is drawn at full detail on the version's page (M12's own tiles, `docs/research/M12-own-tiles.md`), with **Show the current one** swapping the same map to the layer's current image at full detail, and the two figures side by side. It replaces the current one only through Approve. **A published layer is never replaced by a worse one without the owner choosing it** (§4).

## 1. The model

`layerVersionDocSchema.recalibration` (`packages/shared/src/schemas/imagery-recalibration.ts`; twin `RecalibrationInfo` in `pipeline/src/hcm_pipeline/documents.py`):

```ts
recalibration: z.strictObject({
    route: z.enum(['auto', 'points', 'manual']),
    // The version waiting for approval that this one replaces once it is rendered (auto, points); see §5.
    replaces: idSchema.optional(),
    // The admin's rough points (points): a pixel of the scan and where it lies, 1 to RECALIBRATE_MAX_POINTS (12).
    points: z.array(z.strictObject({ pixel: pixelSchema, geo: latLngSchema })).min(1).max(12).optional(),
    // Written by the pipeline: the current fit and the new one on the same checks (§2), the proof's tiles, the pairs near the points.
    before: figure.optional(), after: figure.optional(),   // figure: { rmseM: metres, checks: count }
    tiles: z.strictObject({ agreed: count, tried: count }).optional(),
    proposed: count.optional(),
}).optional()
```

The server writes `route`, `replaces` and `points`; the pipeline adds `before`, `after`, `tiles` and `proposed` (`WORKER_VERSION_FIELDS` gains `recalibration`). `basedOn` (already on every `regeoref` version) names the current version. Job parameters do not change: a recalibration is a `regeoref` job whose version carries `recalibration`.

`recalibrationVerdict(recalibration)` in `@hcm/shared` is the one reading of the figures, used by the approval and the page: `better` when both figures exist and `after.rmseM <= before.rmseM - RECALIBRATE_MIN_GAIN_M` (1 m: a checkpoint figure of a dozen checks moves that far with the seed alone, M9 §14), `worse` when both exist and it is not better, `unmeasured` otherwise. The pipeline's twin (`calibrate/recalibrate.py`, `better`) holds the same constant.

## 2. The ruler

The product's ruler is the held-out checkpoint figure: `georef.checkpointRmseM` with `checkpointKind: 'held-out'` (M9 §7, §11), in ground metres (`transforms.residuals_m`). Comparing the current version's own figure with the new one's would compare two different sets of checks: A001's moved from 13.0 to 21.3 m with the seed alone (M9 §14). So **both figures are measured on the new version's checkpoints**:

- `after` is the new fit's `checkpointRmseM` over its disabled pairs (`checks` of them);
- `before` is the current version's transform (refitted from its stored pairs: `fit(base.transform, base.gcps)`) over **the same pairs**.

The checks are dense tiles read from the match, never from either fit (M9 §7: `CHECK_MIN_PEAK`, `CHECK_MIN_MARGIN`), and none of them was in the current fit's pairs, so the comparison is fair to both. A manual version gets figures only when it holds at least `RECALIBRATE_MIN_CHECKS` (3) disabled pairs; leave-one-out compares nothing (M9 §13.1), so it reads `unmeasured`.

## 3. The pipeline (`pipeline/src/hcm_pipeline/calibrate/recalibrate.py`)

`GeorefStep` (`steps/georef.py`) hands a version with `recalibration.route` `auto` or `points` to `recalibrate.refine` before anything else, and every `regeoref` fit with a `recalibration` to `recalibrate.compared` after it. The seam is two calls; the rest stays in the new module.

- **The references.** A `regeoref` job has no `reference` step: `refine` reads the city window's Sentinel-2 and OpenStreetMap from their caches (`steps/common.sentinel2`, `osm_features`; fetched once more only when the cache is gone), the same window an import used.
- **The start.** `auto`: the current fit. `points`: the current pairs farther than `POINT_REACH_GROUND_M` (1,500 m) from every rough point, plus the rough points, fitted with the current transform (affine when fewer than six pairs are left).
- **The search.** `max(PROOF_SEARCH_GROUND_M, min(3 x the current checkpoint figure, 2000))` for `auto`, as M9's seeded points; for `points`, at least twice the largest distance between where the current fit puts a rough point and where the admin put it, within 2,000 m.
- **The proof.** `measured_on_scan` and `calibrated` unchanged (M9 §4, §7): every gate holds, the last look included; checkpoints set aside before RANSAC.
- **Endings.** The proof refused: the job ends **declined** with `apiError.imagery.refineRefused` (both routes). `auto` not `better`: declined with `apiError.imagery.notImproved {before, after}`. Declined is a new outcome (`jobs.Declined`): the job and its version end `cancelled` with that error, so the dispatcher releases the layer (`releaseCancelled`) and nothing else changes. `worker.step` accepts a run's `cancelled` without `cancelRequested` only with one of these two codes, on a `regeoref` job.
- **`proposed`**: the new pairs within `POINT_REACH_GROUND_M` of a rough point.
- **Log**: `refined: 812 of 1,004 tiles agree; 14.1 m against the current 17.6 m on the same 21 checks` / `declined: 16.9 m against the current 17.2 m on the same 21 checks, not 1 m better`.

## 4. The approval

- **The policy** (`functions/src/imagery/approval.ts`): a version with `recalibration` never publishes itself. The owner asked to see it beside the current one first.
- **Approve** (`imagery.approve`, request `{cityId, versionId, acceptWorse?: true}`): a version whose verdict is not `better` (worse, or unmeasured) is refused with `apiError.imagery.notBetter` unless `acceptWorse` is true. The page asks first ("The new fit is not shown to be better. Replace the current one anyway?"), so the owner chooses it in words. Reject works as for any version.
- **Publish** is unchanged: the new version supersedes the current one (M12 §5), whose public archive stays for its grace.

## 5. Concurrency and the version waiting for approval

- A published current version: the new version holds the layer's `pendingVersion` from the start (as `regeoref` does); a second recalibration is `apiError.layers.busy` until it ends.
- A current version **waiting for approval**: the georeferencer's Save replaces it at once, as today. Refine and Snap do **not**: they may decline, and a declined refine must leave the waiting version where it was. So the new version records `replaces: <current>`, the current keeps `pendingVersion`, and when the new one reaches `awaiting_approval` the policy's transaction cancels the current version and its job and moves `pendingVersion` to the new one (`recalibrate-replace.ts`). A current version approved or rejected meanwhile is left as it is. A second Refine or Snap on the same waiting version while one runs is `apiError.layers.busy`.

## 6. Joined layers (M8)

A join has no scan and no `georef` (M8 cut: it cannot be georeferenced). **Refine automatically** on a join (published or waiting) recalibrates each frame and joins them again:

1. Each frame (`state: 'joined'`, or published) gets an `auto` refine of its own (`recalibration.rejoin: <join>`); a frame's refine never declines inside a re-join: not better, it renders its current fit again (`keep`), so the new join has every frame.
2. A new `layer-join` job over those versions is born waiting for its frames (`waitReason: 'parts'`, as `imagery.join` makes it), on the join's layer, with `recalibration {route: 'auto', before}` where `before` is the current join's `checkpointRmseM` and checks.
3. The join's `checkpointRmseM` is its `after`; the approval reads the verdict as above. The frames stay `partOf` the new join; the old join's frames stay as they were until it is superseded.

**As built (§9):** step 1's frame refines and step 2's waiting join are **not built**; `imagery.recalibrate` on a join answers `apiError.imagery.joinRecalibrate` ("Recalibrate each frame, then join them again"), and the page offers Refine on each frame's own page, where it already works. Reason: M8's `writeJoin` takes scenes, not versions, and a re-join from versions is a second entry into M8's plan that the join track owns.

## 7. The page

The version's page gets a **Recalibrate** block (`packages/ui/src/admin/imagery/recalibrate/recalibrate-card.ts`, a lazy chunk of its own, `recalibrate-card`): on a published version or one waiting for approval, with a scan and pairs, **Refine automatically** and **Place rough points** (the georeferencer, where **Snap my points** sends the points added since it opened); on a recalibrated version, the figures (`Before: 17.6 m · After: 14.1 m, on the same 21 checks`, or `Not measured on the same checks`) and **Show the current one** / **Show the new one**, which swaps the page's one map between the two archives at full detail (the current one's public archive, or its private one through `imagery.previewUrl` while it waits); on a current version, the last refine that declined, in words. Words in `adminContent.imagery.recalibrate.*`, ro and en.

## 8. Rows

`S-A80-HAPPY-REFINE`, `S-A80-BAD-NOT-IMPROVED`, `S-A80-BAD-BUSY`, `S-A81-HAPPY-POINTS`, `S-A81-BAD-REFUSED`, `S-A82-HAPPY-APPROVE-BETTER`, `S-A82-BAD-WORSE-NEEDS-CHOICE`, `S-A83-HAPPY-REPLACES-WAITING`, `S-A83-BAD-DECLINE-KEEPS-WAITING`, `S-A84-BAD-JOIN`, `S-P07-HAPPY-REFINE`, `S-P07-BAD-NOT-IMPROVED`, `S-P07-HAPPY-POINTS`, `S-P07-BAD-REFUSED`, `S-P07-HAPPY-MANUAL-FIGURES`.

## 9. To reconcile with track/accuracy

That branch changes the transform (a camera model, a rendered lattice) and the georeferencer's figures. What this track depends on, kept small on purpose:

- **`steps/georef.py`**: two calls (`refine` first in `GeorefStep.run` for a version with a route; `compared` in `_fitted` of a `regeoref`). If `GeorefStep` moves, the two calls move with it.
- **The current transform** is refitted from the current version's stored pairs (`georef.transforms.fit`). If the camera model or the lattice becomes what renders, `recalibrate.current_map` must build the model the current version rendered with, or `before` measures a map nobody sees.
- **The ruler**: `transforms.residuals_m` and `rmse` over the new version's disabled pairs, `checkpointRmseM` and `checkpointKind`. If the accuracy branch changes the figure the product reports (another error measure, or checks of another kind), `before` and `after` must follow it in one place (`recalibrate.figure_on`), and `RECALIBRATE_MIN_GAIN_M` must be re-read against its noise.
- **The semi-automatic route's reach** depends on the transform: a `poly2` over hundreds of pairs cannot bend near five points, so the snapped tiles there are RANSAC outliers unless the whole map moves. Its effect is local only with a local transform (the lattice). Until then Snap mostly helps where the current fit is off as a whole.
- **`calibrate.pairs.calibrated`, `calibrate.dense`, `proof`**: called unchanged.
- **`functions/src/imagery/approval.ts`**: one more condition (`recalibration === undefined`) and the replace call in `policyIn`.

## 10. Not verified

Real frames: no recalibration ran on a real scan here, so `RECALIBRATE_MIN_GAIN_M`, the search widths and `POINT_REACH_GROUND_M` are first values; the figures' noise between two refines of the same scan is unmeasured. The re-join of §6. A real worker or Cloud Run run of a `regeoref` reading the reference caches.
