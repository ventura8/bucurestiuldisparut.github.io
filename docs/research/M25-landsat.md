# M25: Landsat as a source

Written 2026-11-09 from the owner's request: "i want us for now, to import the landsat. add it to our sources, and automate import, as we have for usgs". The owner's facts of 2026-11-09: Landsat 1984–2000 first (later years as context), public domain, credited "Landsat imagery courtesy of NASA Goddard Space Flight Center and U.S. Geological Survey", through the same USGS M2M API and token the project already uses. SPOT, which the owner named next, is not part of this milestone. Nothing was deployed and no real USGS address was called.

Read it alongside `M3-interfaces.md` §3 (the harvest and its ranking), §4 (the import job) and §5 (the pipeline), `M7-local-worker.md` (where a job runs), `M12-own-tiles.md` (PMTiles) and `M18-improvements.md` §3 (what the daily cap counts). The scenario rows are `S-A130-*` (admin, functions) and `S-P30-*` (pipeline) in `e2e/scenarios.json`.

## 0. Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Which product | Collection 2 **Level-1** (`landsat_tm_c2_l1`: Landsat 4 and 5 TM, 30 m, 1982–2013; `landsat_etm_c2_l1`: Landsat 7 ETM+, 15 m panchromatic) | Level-2 surface reflectance has no panchromatic band; a per-scene stretch makes Level-1's colour good enough for a historical layer. |
| A new job type? | No: a Landsat scene is a `usgs-import` whose dataset is Landsat | The job types, their steps, the dispatcher, the daily cap (`COUNTED`), the scene's release after an ended import and the worker's allow-list stay as they are. The pipeline routes by dataset (`landsat/route.py`). |
| Which steps | `fetch`, `extract` (the bands), `reference`, `warp` (composes), `export`, `pyramid`, `register`; `stitch`, `locate` and `georef` are **skipped** | The product is already on the ground (UTM). The Jobs page shows the three as *Skipped*. |
| ETM+ after 2003-05-31 | Not harvested | The scan line corrector failed that day: every later ETM+ scene has wedge-shaped gaps (`ETM_SLC_OFF_DATE`). |
| Joins | A Landsat scene never joins a date plan | One scene (185 km) holds a whole city. |
| Rights | None to confirm | Public domain; the credit is NASA's and USGS's (`LANDSAT_ATTRIBUTION`). |

## 1. The harvest (`functions/src/imagery/harvest-landsat.ts`)

`USGS_DATASETS` is `[...DECLASS_DATASETS, ...LANDSAT_DATASETS]`, so the same harvest (`imagery.search`, the tick's monthly one) searches Landsat beside Declass 1, 2 and 3, with the same session and the same failure rules (a dataset that fails is named in `failedDatasets`). A Landsat search adds M2M's `seasonalFilter` (May to September, `LANDSAT_MONTHS`) and `cloudCoverFilter` (at most `LANDSAT_SEARCH_MAX_CLOUD` = 40 %, unknown cover left out); ETM+'s window ends on 2003-05-30. The camera comes from the entity id (`LT4…` Landsat 4 TM, `LT5…` Landsat 5 TM, `LE7…` Landsat 7 ETM+); `SENSOR_SPECS` gives `L4-TM` and `L5-TM` 30 m and z8–z13, `L7-ETM` 15 m and z8–z14. The browse image is LandsatLook's (`landsatlook.usgs.gov/gen-browse?…&product_id=…`), copied server-side like any browse image.

**The ranking** (`RANKING_VERSION` 4): a Landsat scene's cloud part counts its season. June to August count fully; May and September halve the part and say so first (`season` {month}). A Landsat scene over `LANDSAT_AUTO_MAX_CLOUD` (20 %) puts its cloud reason first, so a cloudy scene says why it ranks low. Cloud over the city itself is measured later, on the scene's own quality band (§3).

## 2. Find (the admin)

The filters gain one **Landsat** chip that chooses or clears both Landsat datasets together; each dataset keeps its own name on a scene's page (*Landsat 4–5 TM*, *Landsat 7 ETM+*). A Landsat scene is always already processed by USGS, so its card offers **Import (free)**, which is `imagery.import` as for a declassified frame. Setup's USGS card names the Landsat datasets in the access request text it prepares.

## 3. The pipeline (`pipeline/src/hcm_pipeline/landsat/`)

- **`extract`** (`bands.py`): the product bundle (a tar, plain or compressed) is streamed; the bands the colour needs become `work/{city}/{job}/bands/{band}.tif`: B3, B2, B1 and `QA_PIXEL` for TM, and B8 besides for ETM+. A bundle without one of them fails with `apiError.imagery.missingBand` {band} ("The Landsat delivery lacks band B3, so no colour image can be made. Try another scene of that year."); an unreadable bundle fails with `archiveCorrupt` and is deleted.
- **`warp`** (`compose.py`, `colour.py`, `offset.py`): every band is reprojected by GDAL onto the city window's tile grid at the camera's zoom (colour cubic, quality nearest). The quality band masks fill and marks dilated cloud, cloud and cloud shadow; an ETM+ scene is pan-sharpened by the Brovey ratio; each band is stretched between its 2nd and 98th percentiles of the clear pixels only (haze and clouds never set the white point), to 1..255 with an alpha. The result is the RGBA `warped.tif` the shared tail reads, then the USGS delivery is deleted (as `locate` deletes a declassified one, M7 §5).
- **The check instead of georeferencing**: the image's rigid shift from the window's Sentinel-2 (the cache `reference` made), by OpenCV phase correlation of the two high-passed images over the clear pixels both hold, in the camera's own pixels (`offsetPx`) and ground metres; and the share of the city's own pixels the quality band calls cloud (`cityCloudPct`). Both go into the version's `landsat` report (`landsatReportSchema`). Too few common pixels or no clear peak measure nothing (`checked: false`).
- `export`, `pyramid` (PMTiles at z8–z13 or z14) and `register` run unchanged.

## 4. The tick's own imports (`functions/src/imagery/landsat-auto.ts`)

The city's settings gain `landsatAuto` (on by default), `landsatFrom` and `landsatTo` (1984 and 2000 by default, `DEFAULT_LANDSAT_YEARS`), edited in Settings → Imagery → **Landsat**. The tick's `landsat` part, for a city with the switch on and USGS downloads approved, imports the best harvested Landsat scene of each wanted year that has none yet, **oldest year first, one a tick** (`LANDSAT_AUTO_PER_TICK`). A candidate is free, holds the city (`CITY_MIN_COVERAGE_PCT`), has a recorded cloud cover of at most 20 % and was never rejected or imported; the year's best is the highest rank (season included), then the clearer. Each import is an ordinary `usgs-import` by `system:imagery`: the budget guard and **the daily cap refuse it as any other** (it waits for a later tick), and it counts against the day like any import.

## 5. Approval

A Landsat version has no georeference; the policy reads its `landsat` report instead: it publishes on its own when the city auto-publishes, the shift was measured and is at most one pixel (`LANDSAT_MAX_OFFSET_PX`), at most 10 % of the city is cloud (`LANDSAT_MAX_CITY_CLOUD_PCT`) and the render covers the city (the M9 rule). Otherwise it waits for Approve, and the approval card says its shift, the city's cloud and "Waits for your approval: over one pixel off, or clouds over the city." The approval records the shift as its measured error. The layer is `satellite`, its sensor *Landsat 5 TM* (or *4 TM*, *7 ETM+*), its credit `LANDSAT_ATTRIBUTION`.

## 6. What a deploy needs

- **Update the map** for the new pipeline image (Settings → Update, or the installer's update) and the functions: the pipeline must know the `landsat` path before the first Landsat import runs.
- **USGS access**: the same ERS account, M2M access and application token (already in Secret Manager as `usgs-username` and `usgs-app-token`). Landsat Collection 2 Level-1 is a public dataset that M2M's download role covers; no separate request is expected (**UNVERIFIED** until the first real Landsat search and download, §7). If the first `download-options` of a Landsat scene answers it unavailable, the owner adds `landsat_tm_c2_l1` and `landsat_etm_c2_l1` to the M2M access request's datasets in the ERS profile (Access Request, the same form as for the declassified datasets); Setup's card already writes them into the justification.

## 7. UNVERIFIED (the first real search over Bucharest proves them)

- The M2M `scene-search` answer for Landsat: the top-level `cloudCover` is the scene's (the harvest uses it; `Land Cloud Cover` is in the metadata), and the browse address's shape (`gen-browse?size=rrb&type=refl&product_id=…`).
- The product bundle is the largest available product of `download-options` (`download_option` takes the largest), a tar whose band files end in `_B{n}.TIF` and `_QA_PIXEL.TIF`.
- A real scene's shift from Sentinel-2: Collection 2 Level-1 TP products are registered to within about 12 m; one pixel (30 m) is the bar.

## 8. Tests

- Pipeline (`S-P30-*`): `pipeline/tests/synthetic/landsat.py` builds a Level-1 bundle of the synthetic world in UTM 35N; `tests/integration/test_landsat_job.py` runs the whole import against the loopback fakes (TM within a pixel at z13, ETM+ pan-sharpened at z14, a missing band, Sentinel-2 moved 90 m with a cloud box over the city); `tests/unit/test_landsat.py` covers the routing, the band names, the masks, the stretch, Brovey and the phase correlation.
- Functions and shared (`S-A130-*`): the search filters, the camera, the tick's picks and refusals (switch off, guard red, search-only USGS, no wanted year), the approval's three refusals, the credit, the season and cloud in the rank, the rules for the new settings.
- Admin e2e (`e2e/admin/specs/imagery/landsat.spec.ts`): the fake USGS lists three Landsat 5 TM scenes once a spec asks (`usgs.landsatScenes`); the stand-in pipeline plays the Landsat path (skipped steps, the report from the script's `landsat`). Tour states `imagery.results-landsat` and `imagery.version-landsat-held`.
