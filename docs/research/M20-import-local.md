# M20: Import local files (design)

Written 2026-11-09 from the owner's request: "we want to help the admin import local files … let's optimize and import and calibrate automatically all the formats in this archive". The test case is `harti.zip` (5,703 files, inventoried outside the repository). The owner's decisions of 2026-11-09 are in §13; what the core track built is in §14 (*As built*). Nothing was uploaded and nothing was deployed.

Read it alongside:

- `M3-interfaces.md` §2.4 (job states and limits) and §8 (uploads)
- `M7-local-worker.md` (the worker, its ports and the dispatcher)
- `M8-join-interfaces.md` (the join compositor)
- `M9-calibration.md` and `M15-calibration-accuracy.md` (proof, checkpoints, blocked figure)
- `M10-local-ai.md` (the matcher port, GPU first)
- `M12-own-tiles.md` (PMTiles, the approval view)
- `M16-recalibrate.md` and `M18-improvements.md` §3 (what counts against the daily cap)

The scenario rows are `S-A120-*` (functions) and `S-P20-*` (pipeline) in `e2e/scenarios.json`.

## 0. What exists today (checked in code)

| Fact | Where | Consequence |
| --- | --- | --- |
| `LAYER_KINDS = ['satellite', 'aerial', 'map']` | `packages/shared/src/schemas/manifest.ts:49` | Map layers are already valid in the manifest. The viewer treats every kind the same: the Layers panel has one *Historical layers* group (M18 §6), and nothing reads `kind` except the compare labels. |
| `layer.attribution` (500 chars) feeds the map source's attribution | `packages/engine/src/core/map-specs.ts:77` | Credits per layer already reach the legal line and the compare bar. There is no licence or author field. |
| `JOBS_PER_DAY = 10`. Counted types are `usgs-import`, `geotiff-import` and `layer-join`. Re-runs are free. | `packages/shared/src/api/imagery.ts:32`, `functions/src/imagery/limits.ts` | The cap counts new layers, not compute. It is per project, with a per-city share. `refuseRasterJobs(count)` creates a set all-or-nothing. |
| `GEOREF_TRANSFORMS = ['affine', 'poly2', 'tps']` | `schemas/georef.ts:17` | TPS already exists for fits and for the M8 correction transport. |
| `DEFAULT_RMSE_THRESHOLD_M = 15`, range 1–200. `CITY_MIN_COVERAGE_PCT = 90`, `AUTO_MIN_MEASURED_PCT = 70`. | `schemas/imagery-settings.ts` | Both coverage rules are relative to the city. A map of the centre can never pass the 90 % rule. |
| `JOIN_MAX_PARTS = 8`. A join part is a USGS version (`entityId`, `dataset`, `sensor`). | M8 §2 | A 4,545-sheet series cannot be an M8 join. The design reuses M8's compositor, not its job or its part schema. |
| The pipeline works in grey + alpha (`Warped`). Export is JPEG q85 COG, tiles are WebP. | `steps/export.py`, `tiles/pack.py` | Coloured maps and 1-bit line art each need their own path (§6). |
| M7 uploads `scan.tif` (the crop) through signed URLs. Raw files stay local. | M7 §1.3 | An archive series must not upload its sheets. Only tiles, previews and the sheet index go up (§2.4). |

## 1. Decisions

1. **The archive is processed by the local worker, not the cloud.** The browser never uploads it. The admin picks a folder or a zip on the worker's own local page (`localhost:8765/import`). That page streams the files over loopback into `/work/import/<archiveId>/`, or reads a zip in place there. Originals never leave the computer, and archive jobs are pinned with `runOn: 'local'` and `localOnly: true`, so `imagery.runOn` refuses to move them to the cloud (`apiError.imagery.localOnly`).
2. **Unit of work: one series becomes one job and one layer per edition year.** A *series* is a set of files that make one map: a sheet series, an atlas, overlapping scan pieces, or a single map. Sheets are not versions. They are the parts of one version, with origin `archive`. Their per-sheet record lives in a local sidecar, `work/{city}/{job}/sheets.json`, and a summary of it goes into the version.
3. **Scanning is free, importing counts against the cap.**
   - The scan (inventory and report), re-runs, Locate again, points and recalibration never count. This is M18's rule.
   - Each series job counts once against `JOBS_PER_DAY`, in the same way as a `geotiff-import`.
   - Why local jobs count:
     - The cap guards **new layers**, and what follows a new layer is cloud cost wherever its pixels were computed: storage and egress in the public bucket, the manifest's growth, approvals, and Mapbox if the city chose it.
     - If a job that did not count could ever reach Cloud Run, the guard would be defeated. Counting keeps the invariant simple even though `localOnly` already forbids the move.
     - Local CPU and GPU are the owner's, so archive jobs never count toward the Cloud Run free tier (M7 §4 already skips `runOn: 'local'`).
   - The import is never refused for the cap. Series beyond today's allowance wait (`waitReason: 'daily'`, a new reason), and `imagery.tick` releases them in the plan's order as each day's count frees.
   - The Bucharest archive has about 33 importable series: about 4 days at the default share, unless the owner raises the city's `rasterJobsPerDay` up to the project's 10.
4. **Same date only, read for maps as same edition.** M8 joins frames of one acquisition date. A map series joins sheets of one edition. Sheets of other editions (`_62`, `_64`, `_71`) form their own partial layers of their year. The scan report lists them, and the owner may drop them. A series with no per-sheet edition (the base 1:500 sheets, 1961–77) gets one layer with `year` set to the latest revision the sheets state (1977, prefilled and editable). Its label carries the range.
5. **Never publish a bad fit.** Every series ends in one of two states:
   - `awaiting_approval`, which auto-publishes only under the map rule in §5;
   - `awaiting_gcps`, with suggested pairs.
   No path publishes a fit without a held-out checkpoint.
6. **Rights gate publishing, not processing.** Every series carries `rights` (§7). Series flagged *needs confirmation* can be imported, calibrated and previewed privately (M12's signed preview). `publish` refuses them until the owner confirms the licence (`apiError.imagery.rightsUnconfirmed`). Items marked *do not publish* are skipped at the scan.
7. **Calibrate in era order (the reference ladder).** Matching a drawn map against a map of a similar era is far easier than matching it against today's OSM. Once a layer is calibrated, it becomes a reference for older maps. Its own checkpoint error is added in quadrature to theirs. The ladder for Bucharest:
   - OSM → IPB 1:500 and 1:2000 (they solve the city grid);
   - the grid → IGA 1911, the 1911–14 cadastral plan and IGA 1895 (each refined against its own printed grid);
   - those → the 1886–1939 single maps and the coloured 1895 pieces;
   - IGA 1895 → Borroczyn 1846 and 1852;
   - Borroczyn → 1770–1799.
   A reference that is not published (IPB, for rights) is still used privately. Only its derived transform and its vector junctions are used.

## 2. Intake and scan (the worker)

### 2.1 Getting the files to the worker

- **The admin's entry point.** Imagery → *Import local files* opens a panel.
  - With no worker seen in the last 180 s (M7 §0.1), it shows the M7 command and *Start the worker first*.
  - With a worker, it shows **Choose a folder or zip on this computer**, which opens `http://localhost:8765/import?archive=<nonce>` in a new tab. The picker must live on the worker's own origin. A page on `web.app` calling `localhost` would hit Chrome's Private Network Access rules and CORS.
- **The worker page.** It uses `<input type=file webkitdirectory>` and a single-file `.zip` input, so it works in every browser without the File System Access API. It posts each file to `POST /import/<archiveId>/file` with the M7 CSRF header and the relative path in a header. The path is validated and never joined raw. Only loopback is involved.
- **The alternative for very large archives.** The admin copies the zip or folder into `~/hcm-worker/import/` (already mounted as `/work`), and the page lists it. The panel's note says so.
- **Zip reading.** The worker reads entries in place. It extracts nothing outside `/work/import/<id>/x/`. It refuses:
  - absolute paths, `..`, links and device entries;
  - more than 100,000 entries;
  - an entry whose ratio is above 200:1 or whose expanded size is above 64 GiB;
  - a total above the free disk space minus 10 GiB.
  Names are decoded as UTF-8 or else CP437, as the zip specification says. Bucharest's names are Romanian with diacritics.

### 2.2 Probing (untrusted input)

- Every file is probed in a **child process** with `RLIMIT_AS` 4 GiB, a 60 s CPU limit, no network and `GDAL_MAX_PIXELS`, plus Pillow's `MAX_IMAGE_PIXELS` at 1.5 gigapixels. A crash or timeout becomes a `skipped: unreadable` row and never stops the scan. Nothing in the archive is executed. Detection goes by magic bytes, never by extension (the `.368` file and the extensionless G4 TIFF prove this matters).
- **Recorded per file** in the local `archive.json` (never in Firestore):
  - SHA-256, format, size and bit depth;
  - photometric interpretation and compression;
  - dpi, and any EXIF or software tags;
  - georeferencing found (CRS, GeoTIFF tags, GCPs, world file, `.prj`, `.aux.xml`);
  - for PDFs, the page count, encryption and image-only status.
- **Thumbnails.** One 256 px thumbnail per file, plus a contact sheet per series for the report.

### 2.3 Classification (for any city)

The detectors run in order. Each file lands in exactly one series or one skip reason.

1. **Junk.** `Thumbs.db` (OLE2 with a `Catalog` stream), OLE2 autosaves (`.VCF` of VPstudio), directory listings, `.DS_Store`, `desktop.ini`, `__MACOSX/`. Reason: `not-a-map`.
2. **Exact duplicates** by SHA-256. Reason `duplicate-of: <path>`. The shortest canonical name is kept.
3. **Georeferenced** (class a): a CRS, a world file with or without `.prj`, or GCPs.
4. **Nomenclature series** (class b). A library of name grammars:
   - the international 1:1M scheme (`L-35-…`) and its Romanian Stereo 70 sheet numbering (Gauss–Krüger lineage);
   - generic `row-col` and `col+row+quarter` city grids;
   - an owner-supplied grammar.
   A grammar is accepted for a folder when at least 80 % of its rasters parse, and the parsed cells form a connected set with consistent raster sizes and dpi. A learned city grid (§3.2) is proposed and confirmed by the owner once. It is then stored as city data (`cities/{c}/grids/{gridId}`) and reused by later imports.
5. **Atlas.** Numbered pages in one folder, with an index page found by name (`Cuprins`, `Index`, `Inhalt`) or by a page whose layout is a grid of numbers. Pages that are not maps are found by content: low line density, mostly text, or a scale bar alone (`1_Autor`, `8_Tehnic`, `10_Registru`, `99_Scara`). They are skipped with the reason `not-a-map-page`.
6. **Pieces.** At least 3 rasters with the same dpi and pairwise feature overlap of 10 % or more (ORB on 1/8 scale). They form one stitched map.
7. **Twin scans.** Two series of the same map (the same layout found by thumbnail matching after a scale normalisation, at least 0.8). One series is primary, the other only fills gaps, with reason `twin-of`. The rule:
   - prefer grey or colour at 200 dpi or more over 1-bit;
   - otherwise the higher dpi.
   For Bucharest: the grey JPEG Borroczyn set is primary and the TIF set gives only page 50. IGA 1895 and IGA 1911 use the grey JPEG quadrants, with the 1-bit TIFs as fallback. A near-duplicate crop (`Bucuresti 1770.jpg`) is skipped as `crop-of`.
8. **Single** (class c): everything else that is a raster or a PDF page.
9. **CAD** (class e): `.dwg` and `.dxf`.
10. **Owner sidecar.** An optional `hcm-archive.json` at the archive root is a schema-checked declaration of series, grids, years, authors and licences. It is **data, never code**. It overrides detection only where it validates. This file is how a city owner, or Claude preparing an archive, fixes what detection got wrong.
11. **Series metadata.** For each series, the worker reads candidate title, year, scale, author and watermark text with on-device OCR on the cartouche (Tesseract, pinned, `ron+eng+deu+fra+hun`). These are only prefilled values that the owner edits in the report. Watermarks found (romaniaforum, dacoromanica) go into the attribution suggestion.

### 2.4 What reaches the server

`worker.archiveReport` is a new worker callable (access `cityEditor`, App Check off, as M7 §2.4). It writes `cities/{c}/archives/{archiveId}`:

- `name`, `source: 'zip' | 'folder'`, `fileCount`, `bytes`, `scannedAt`, `workerId`;
- `series[]` (at most 200): `seriesId`, `class`, `title`, `year`, `yearLabel`, `files`, `bytes`, `action`, `reason?`, `edition?`, `rights`, and `estimate` (`maxzoom`, `tilesBytes`, `minutes`, and `auto: 'likely' | 'possible' | 'points'`);
- `skipped` counts by reason.

Per-file rows stay local. A skipped list of up to 500 sample relative paths goes to the paged subcollection `archives/{id}/issues`. Host paths and file contents never go up. A contact sheet per series (WebP, at most 200 KB) goes through `worker.urls` to `rasters/{c}/archives/{id}/{series}.webp`, which is private and signed for the admin.

## 3. Automatic paths per input class

### (a) Already georeferenced

1. **Read the CRS.** GeoTIFF keys, `.prj`, or `.aux.xml`. A world file with no `.prj` gets a CRS inferred from the coordinate ranges and the city's position. The candidates are Stereo 70 (EPSG:3844, E 200k–900k, N 200k–800k), the local UTM zone, EPSG:3857 and EPSG:4326. Each candidate is tested by where it lands, and an ambiguous result asks the owner in the report.
2. **Stereo 70 datum.** EPSG:3844 goes through PROJ's Helmert transformation. That is 1–3 m, under the threshold. The official TransDatRO grid is used if PROJ-data ships it (**UNVERIFIED**).
3. **Output.** `gdalwarp` to EPSG:3857 (bilinear for grey and RGB, nearest then a box pyramid for 1-bit), then the COG, `tiles` and `register`. No matching is needed.
4. **Verification against OSM.** `check` runs the checkpoint machinery as a *ruler only* (§4). A median offset under the threshold behaves like a normal fit. A larger one sets `georef.disagreesM` and waits for the admin with the note "the file's georeference disagrees with OpenStreetMap by N m". It never auto-publishes.
5. **The test case.** None of the 5,703 files is georeferenced. The path is built for other cities and tested on synthetic files.

### (b) Sheet series with a known grid or nomenclature

1. **Parse.** Each file name becomes a grid cell (row, column, quarter or block). For Bucharest:
   - columns `A…Z` west and `A'…Z'` east (24 letters, no J or Q), with A' at index 0 and A at −1;
   - rows `n` south of the 0 row and `n'` north of it;
   - 500 m cells;
   - 1:500 sheets are quarters (`17A'3`);
   - 1:2000 sheets are 2×2 blocks (`29-30cb`, where `b''c''` is the primed form);
   - cadastral `Seria N/<letter>`, where `A1…H1` means `A'…H'`.
   - The quarter numbering is one of 8 permutations. It is chosen by the lowest seam residual between neighbours (step 4) and cross-checked against the index photo (an internal check, never published).
   - The 41 + 15 + 15 odd names go into an editable table in the report ("we read these as …").
2. **Frame per sheet.** Run on a 1/8 downsample:
   - a morphological close, then the largest near-rectangular contour, then corner refinement at full resolution by line intersection (sub-pixel);
   - where the printed grid crosses the sheet (IGA 1895 and 1911 quadrants), the grid lines' crossings are detected by Hough on the long thin lines. Each crossing is a control point with known grid coordinates: tens per sheet.
   - A sheet whose frame is not found is reported (`frame-not-found`) and left out of the mosaic. One bad sheet never blocks the series.
3. **Solve the grid once per city.** The unknown is a 4-parameter similarity from grid metres to EPSG:3857, or an affine if the residual warrants it.
   - Scale is known (500 m cells), so the search is translation plus a small rotation.
   - The series is rendered in grid space at 2 m from the sheets' frames: the whole city's 1970s street pattern.
   - It is matched against OSM roads and buildings, rasterised the same way, by NCC and chamfer over a pyramid on the CPU. The ALIKED+LightGlue proposal from M10 runs on the GPU as a second voter.
   - The M9 proof gates (inliers, share, spread, the rival search) decide.
   - If it is refused, the report asks the owner to drop **3 sheets** on the map (about 6 clicks), and the solve runs from those.
4. **Per-sheet fit.** A homography from the four frame corners, or from the grid crossings. Then a **joint solve** across neighbours (M15's joint solve): line continuity across shared edges, by correlating 2 cm-wide strips of each edge. This removes paper shrink (0.2–0.5 % on old sheets) and scanner skew. Then a TPS only where at least 30 crossings support it.
5. **Check.** A spatially blocked sample of 10 % of sheets, at least 20, scored against OSM junctions held out before any fit. For the older series, the IPB reference is used as well. The figure reported is M15's blocked figure.
6. **Mosaic.** Each sheet is cut at its neat line, with a hard seam and **no feather**: blending line art doubles lines. Where editions overlap, the higher priority wins: the series' own edition, then the newer. M8's block compositor is reused with weights set to 0 or 1.
7. **Expected error for grid series.** Frame ±2 px at 300 dpi is 0.17 mm on paper (8.5 cm at 1:500, 0.85 m at 1:5000). Grid solve 1–2 m. OSM's own error 1–3 m. So expect 2–5 m, well under 15 m.

### (c) Single scanned maps (JPG, PNG, PDF page)

Calibrating a drawn map automatically is hard: it has drafting error, generalisation, a changed city, and no photo texture. The realistic pipeline:

1. **Prepare.**
   - Deskew.
   - Find the neat line (as in b). Mask outside it.
   - Mask the cartouche, legend, scale bar and text blocks. Text is found with Tesseract's layout boxes plus a morphological text-blob detector. The legend is a dense rectangle near the frame with low road density.
   - Watermarks inside the map are masked by the same detector.
   - Colour is kept as RGB for warping. A working copy for matching is made per channel: roads are often the paper-coloured channels between coloured blocks.
2. **Street network.**
   - **The classical path (always on, CPU).** Road detection by the paper colour between building blocks (colour maps) or by double-line ridge filters (line plans), then skeletonise, then a junction graph: nodes of degree 3 or more, each with its angle signature.
   - **The AI path (GPU first, CPU fallback, M10's port and sidecar).** A segmentation model behind a `RoadSegmenter` port. A candidate must have weights whose licence is explicit, as M10 required. The **landing gate R2** runs on this archive's 1886–1939 maps with points made by hand as ground truth. It lands only if it raises the share of proved maps with **zero false accepts**. Otherwise the classical path stays. No model is chosen here: none was verified with licensed weights, so this is **UNVERIFIED**.
3. **Reference.** OSM highways in the city window, filtered for persistence:
   - streets that also exist in an older calibrated reference layer;
   - OSM `historic=*`;
   - churches with `start_date` before the map's year;
   - for maps after about 1880, the river.
   The Dâmbovița was straightened and canalised in the 1880s, so the river is excluded as a feature for older maps. Better still, the reference ladder's previous layer is used as a vectorised network (§1.7).
4. **Coarse placement.**
   - The scale prior comes from the printed scale (OCR: `1:40000`, `Echelle`, `Merték`) or from the neat line's size against the city's extent.
   - The rotation prior is north up; 4 × 90° when uncertain.
   - Chamfer matching of the skeleton against the reference's distance transform, over similarity transforms (scale ±30 %, rotation ±15° per quadrant, translation over the window), on a pyramid.
   - The M10 matcher on *rendered* skeletons is a second voter (GPU).
   - The M9 rival search refuses a second peak.
5. **Fine fit.**
   - Junction correspondences within a radius set by the coarse fit's spread.
   - RANSAC similarity, then affine, then poly2.
   - **TPS only with at least 30 inliers spread over at least 60 % of the map**, with regularisation λ chosen by blocked cross-validation. TPS absorbs real drafting distortion, which is the point for 18th–19th-century maps.
6. **Checkpoints.**
   - 20 % of junctions in spatial blocks, held out before RANSAC.
   - `CHECK_GROSS_M` scaled to the map (5 mm on paper × the scale, at least 100 m). Any dropped check blocks auto-publish (M9 §11).
   - The coverage rule is relative to **the map's own extent**, not the city's (§5).
7. **Low confidence.** `awaiting_gcps`. The surviving correspondences are saved as **suggested pairs** (`auto`, disabled), and the georeferencer opens with them (M4's suggestions). After about 4 points from the admin, the same chain runs seeded (M9's "admin's points seed the same step").

### (d) Non-map pages and duplicates

These are skipped with a reason shown in the report and nothing is processed:

- `not-a-map`, `not-a-map-page`, `duplicate-of`, `twin-of`, `crop-of`;
- `rights: do-not-publish` (the Radu Oltean drawing; Giurescu, protected until 2047);
- `index-only` (the sheet-index photo: used internally to check the parser, never a layer);
- `too-small` (under 600 px on the long side; it is still importable if the owner insists, at the zoom it supports).

### (e) DWG and CAD

- **v1: report only.** The row reads "AutoCAD R14 drawing: export it to DXF or a georeferenced PDF from CAD". GDAL reads DWG only from R2000, and the 1969 atlas DWG is probably a page layout in drawing units, not a map layer.
- **v2: LibreDWG.** Pin LibreDWG `dwg2dxf` (it reads R13–R2018) in the pipeline image. Then DXF goes to OGR to a vector page index that helps assemble an atlas.
  - Its GPL-3 licence must be checked against the image's notice policy (**UNVERIFIED**).
  - ODA's converter is proprietary and is excluded.
  - Lands only if the 1969 atlas becomes publishable.

### PDFs

- Pages are extracted with **pikepdf**, pinned in the pipeline's requirements. It takes images out without re-encoding (`/DCTDecode` streams are written as is). Each page then becomes a single or an atlas page.
- An encrypted PDF that opens with an empty user password (owner restrictions only) is read. One that needs a password is skipped (`pdf-password`). The worker never asks for or cracks one.
- Miorini 1923: the encryption type is **UNVERIFIED**. Its 143 pages go to the atlas path.

### Atlases and pieces (the two assembly cases)

- **Atlas.** OCR on the index page gives page numbers on a grid, which gives the page adjacency. Neighbouring pages are aligned by matching across their shared edge: at least 8 matches along the edge strip, and a similarity with no TPS. The assembled atlas is then one map in map space, calibrated as one class (c) map. Many junctions over the whole city are far stronger than page by page. Missing pages (Borroczyn page 50 is in the twin; Miorini is unknown) leave holes, which are shown in the report.
- **Pieces.**
  - Pairwise homographies between overlapping pieces (SIFT on 1/4 scale, RANSAC). The pieces are flat scans, so an affine model is used, not a camera model.
  - A global bundle adjustment.
  - **Seam by graph cut**, not feathering. A missing piece leaves a reported hole.
  - Then class (c), with the same-era reference (IGA 1895) first.

## 4. The job

| Item | Value |
| --- | --- |
| Type | `archive-series` (new, in `COUNTED`). `runOn: 'local'`, `localOnly: true`, `waitReason` `daily` when today's share is used. |
| Input | `{archiveId, seriesId, sheets: <count>, class, gridId?, referenceLayerIds[], edition?}`. The sheet list itself is the local `archive.json`, checked by SHA-256 in `gather`. |
| Steps | `gather` → `prepare` (per sheet: decode, frame, mask; resumable per sheet through `work/.../prepare.checkpoint.json`) → `place` (grid, atlas, pieces or match) → `refine` (joint and TPS) → `check` → `merge` (RGB- or line-art-aware) → `export` → `tiles` → `register` → the publish steps (M12 own tiles, or Mapbox if the city chose it). A failure in `place` or `check` moves the job to `awaiting_gcps` with suggested pairs, never to `failed`. |
| Version | `origin: 'archive'` and `source: {kind: 'archive', archiveId, seriesId, sheetCount, placedCount, skipped: {reason: n}}`. `georef` has `method: 'grid' \| 'atlas' \| 'match' \| 'embedded' \| 'gcps'` and the blocked checkpoint figure. A series cannot be described by one scan's pixels, so the version carries per-sheet residuals only as a summary (median, p95, worst five sheet names). |
| Recalibrate (M16) | Allowed on the worker that holds the originals, recognised by SHA-256. If the folder moved, the worker page asks the owner to point to it again. |
| Time (estimate, a 4-core home PC) | 1:500 series: prepare about 1 s a sheet, so about 75 min; mosaic and tiles at z19 about 40 min. Singles: 2–10 min each on CPU, under 1 min with the GPU voter. **UNVERIFIED** until the acceptance run (§10). |

**What is uploaded.** `tiles.pmtiles`, `thumb.webp`, `preview.png`, and a small `sheets.geojson` (sheet outlines and names, for the approval view and later corrections). `scan.tif` and the originals stay local. This is a deliberate exception to M7's `scan.tif` upload, recorded in the version as `localOnly`.

## 5. Approval and the threshold for maps

Satellite keeps the city's threshold, 15 m by default. A drawn map cannot be truer than its drafting and survey. Classic graphical accuracy is 0.2–0.3 mm on paper, and its tolerance is about 3×. A guide map also widens streets to draw them. The proposal:

```text
mapThresholdM = clamp( max(cityThresholdM, 1.0 mm × scaleDenominator), cityThresholdM, MAP_THRESHOLD_MAX_M = 60 )
```

| Map | Scale | Threshold |
| --- | --- | --- |
| IPB 1:500, 1:2000; cadastral; IGA 1:5000 or 1:10000 | at most 1:15000 | 15 m (the city's) |
| Baedeker c. 1900 | 1:31000 | 31 m |
| 1897 Hungarian | 1:40000 | 40 m |
| No stated or detected scale (1770–1799, the 1935 scheme) | none | **never auto-publishes**; one click after a look |

The rest of the rule for maps:

- **Coverage.** Coverage is measured against the map's own neat-line extent: the agreeing checkpoints must span at least 70 % of it (`AUTO_MIN_MEASURED_PCT`), in place of the city's 90 %.
- **Other gates.** No dropped gross check, the rival search clean, and the rights confirmed.
- **Why 60 m is the cap.** Beyond that, a map overlaid on the modern map at street zoom misleads more than it informs. A worse fit waits for the admin, who may still approve it with the error shown on the card.
- **Settings.** `cityImagery.mapThresholdMaxM` (default 60, range 15–200) and `mapAutoPublish` (default on), in Settings → Imagery, in `ro` and `en`.

## 6. Optimisation

- **Originals are kept losslessly and untouched** on the computer. Working copies are made only where needed: 1-bit G4 is kept as is, and JPEG is read without re-encoding. The 82 MB PNG becomes a DEFLATE COG locally.
- **Encoding per series**, chosen at the scan from bit depth and colour statistics (the owner can change it):
  - **`lineart`** (1-bit or two-tone):
    - warp with nearest, then a box-filter pyramid so lines stay crisp, and no JPEG anywhere;
    - local COG with DEFLATE and a predictor;
    - tiles are **lossless WebP with a palette**;
    - option **paper transparent** (default on for line plans): paper becomes alpha 0, so the plan overlays satellite or the basemap. It is stored as a tiling flag on the version, not as a viewer adjustment.
  - **`grey`**: bilinear, JPEG COG, lossy WebP at q80, as today.
  - **`colour`**: an **RGB** path through `Warped` (3 bands + alpha), `merge` and `export` (JPEG YCbCr COG, lossy WebP at q82). Today's code forces grey. This is Workstream F's main change, tested so that a grey input stays byte-identical.
- **Max zoom from the scan's ground resolution.**
  - `gsd = 25.4 mm / dpi × scaleDenominator`.
  - `zRes = floor(log2(156543.03 × cos φ / gsd))`.
  - The tiles' `maxzoom = min(zRes, zBudget, 21)`. Mapbox overzooms to the city's `maxZoom` (M12).
  - `zBudget` is the largest zoom whose estimated archive fits `ARCHIVE_SERIES_MAX_BYTES` (2 GB by default; the estimate comes from a sample of 50 tiles encoded at the scan).
  - The report shows bytes against the bucket's 5 GB free allowance.
  - Example: 1:500 at 300 dpi gives 4.2 cm, so zRes is 21. The 1:500 series covers about 284 km², so z19 (0.21 m) is about 95k tiles and about 1 GB lossless line art, while z20 is about 4 GB. Default z19, with z20 as a choice that shows its cost.
- **Duplicates** are never processed twice. The SHA-256 index of the archive is kept, and a re-import of the same files reports *already imported* per series.

## 7. Rights, provenance and credits

Each series carries:

```ts
rights: {
  licence: 'PD' | 'CC0' | 'CC-BY-4.0' | 'CC-BY-SA-4.0' | 'permission' | 'unknown';
  state: 'clear' | 'needs-confirmation' | 'do-not-publish';
  author?: string;
  publisher?: string;
  year: string;
  sourceLabel?: string;
  sourceUrl?: string;
  watermark?: string;
  note?: string;
  confirmedBy?: string;
  confirmedAt?: Timestamp;
}
```

Pre-flag rules:

- A work dated 1931 or earlier with no named author is `clear`, PD.
- A named author with an unknown death date is `needs-confirmation`, with a "check the author's death date" note (Pantea 1921, Miorini 1923).
- An institution's work less than 70 years after publication is `needs-confirmation` (Romanian law 8/1996).
- A visible "copyright" mark becomes `do-not-publish`, and the owner can change it only by choosing `permission` and typing who granted it.

For Bucharest:

| Series | Rights |
| --- | --- |
| IPB 1:500 and 1:2000, the 1962–78 mosaic | `needs-confirmation`, with the report's explicit question: "These sheets were made by Institutul Proiect București until 1977 and come from an institutional topographic archive. Confirm where they came from and that you may publish them." Until confirmed they can be calibrated and used as private references, but never published. |
| 1968, 1969, 1974, 1982 | `needs-confirmation` |
| Giurescu pages (two) | `do-not-publish` (protected until 2047) |
| The Oltean drawing | `do-not-publish` (marked "copyright Radu Oltean") |

- **Credits.** `layer.attribution` gets the built line "Author, Title, year · licence · scan: source (watermark)", within 500 characters. It already reaches the legal line and the compare bar.
- **Manifest change** (a minor, additive change, recorded in `ENGINE_API.md`): `layer.rights?: {licence, author?, source?: {label, url?}}`, shown in a layer-info row in the Layers panel and in About → Credits. Strict schema, plain text only, no HTML.

## 8. Admin UX

1. **Import local files** card on the Imagery page. It shows the worker's state, the choose button, and the archives already scanned.
2. **Scan report** (`/admin/imagery/archives/<id>`):
   - a header with files, size, series found and files skipped;
   - one row per series: contact-sheet thumbnail, title, year, files, size, class, what will happen ("Place 4,545 sheets from their names on the city grid", "Match against the 1895 plan", "Skip: modern artwork, copyright"), the estimated zoom and bytes, auto-calibration likelihood (*likely*, *possible*, *needs points*), and the rights chip;
   - editable title, year, licence and author per series, an include toggle, and the table of odd names;
   - a total: bytes to publish, jobs, and days at the city's share.
3. **One Import click.** `archive.import {cityId, archiveId, series: [{seriesId, include, title, year, rights}]}` creates every included series job in reference-ladder order. The jobs beyond today's share are created `queued` with `waitReason: 'daily'`. The response shows "11 series start today, 22 wait for the next 3 days".
4. **Progress per series** on the Jobs page and on the archive page: step and sheet counts ("prepare 1,812 of 4,545"), skipped sheets with reasons, and the GPU or CPU in use (M10).
5. **Results.** Error in metres (the blocked figure), the threshold that applies and why, the checkerboard and own-tiles preview (M12), and sheet outlines over the map with per-sheet residuals coloured. *Approve*, *Fix points* (opens the georeferencer with suggested pairs), or *Exclude sheet*.
6. **Rights confirmation.** A dialog per flagged series, with the question and a free-text "permission from", logged in `rights.confirmedBy` and `rights.confirmedAt`. Publish stays disabled until it is done.
7. **Home → What needs you** (M18 §7) lists series waiting for points or rights.
8. **Strings and states.** Every string is in `ro` and `en`, in a lazy chunk `archive` with its own i18n catalogue (as M7's `admin-worker`). Every state joins `e2e/tour/states.ts`.

## 9. Viewer

- Map layers already render. They need:
  - a **Maps** subgroup inside *Historical layers*, next to *Aerial and satellite*, grouped by `kind`;
  - a small map glyph on a map year's timeline chip;
  - the `rights` row in the layer info.
- Default opacity for a `map` layer is 0.85. The `lineart` paper-transparent tiles make it legible over satellite.
- Compare (swipe) works unchanged: a map against a 1970s satellite frame is the headline use.
- No Firestore and no HTML from data. The new manifest field is plain text.

## 10. Workstreams and tests

### A. Contracts

(shared plus Python twins)

- Scope:
  - `archiveDocSchema` and the series plan;
  - `rightsSchema`;
  - job type `archive-series` in `COUNTED`;
  - wait reason `daily`, `localOnly`;
  - version origin `archive` and source kind `archive`;
  - `georef.method` additions;
  - the `mapThreshold` function;
  - `cityImagery.mapThresholdMaxM` and `mapAutoPublish`;
  - `layer.rights?` in the manifest;
  - grid documents `cities/{c}/grids/{id}`.
- Tests:
  - schema round trips;
  - Python and TypeScript parity;
  - `mapThreshold` table cases (no scale, 1:500, 1:40000, the cap);
  - manifest v1 back-compatibility (a layer without `rights` is valid);
  - a strict refusal of extra fields.

### B. Worker intake and scan

(`hcm_pipeline/archive/`)

- Scope: the import page, the loopback stream, zip reading, the sandboxed probe, the classifier, OCR prefill, the report callable.
- Tests:
  - zip-slip, absolute paths, symlinks, an entry ratio bomb and a too-many-entries archive are each refused;
  - CP437 and UTF-8 names;
  - magic-byte detection (a TIFF named `.368`, a file with no extension);
  - a probe child that crashes or times out becomes a skip row;
  - junk detectors (a synthetic `Thumbs.db`, an OLE2 autosave);
  - SHA-256 duplicates;
  - twin choice;
  - an atlas with an index and non-map pages;
  - piece overlap grouping;
  - sidecar validation (an invalid one is ignored and reported);
  - a report over 200 series is paged;
  - host paths never appear in the report.

### C. Grid series

- Scope: grammar parsers (the Bucharest grid, the 1:1M scheme), the quarter-permutation search, frame and crossing detection, the global grid solve, per-sheet homography, the joint seam solve, the hard-seam mosaic.
- Tests:
  - synthetic G4 sheets drawn from a known grid under a known similarity, with shrink and skew: recovered within 0.5 m;
  - the wrong quarter permutation loses to the true one;
  - a sheet with no frame is left out and reported;
  - the 3-sheet manual seed solves;
  - a grid solve against a mirrored or other city is refused by the proof gates;
  - the parser covers every name in the inventory's list of special cases (names only, as a data fixture).

### D. Drawn-map calibration

- Scope: masks, classical road extraction, the `RoadSegmenter` port (a null default), the persistence-filtered reference, chamfer coarse placement, junction RANSAC, the TPS with CV λ, scaled checkpoints, suggested pairs, the reference ladder with error in quadrature.
- Tests:
  - a synthetic network warped by a known TPS plus drafting noise, recovered under the threshold;
  - a map of another city is refused (zero false accepts, as `m9-false.py`);
  - a rotated-180 map is found;
  - too few junctions gives `awaiting_gcps` with pairs;
  - the TPS is refused under 30 inliers;
  - the legend and cartouche mask excludes text blocks;
  - a ladder reference's error adds into the figure.
- Gate R2: the AI path lands only on a measured gain with zero false accepts. No GPU and no weights in any gate (M10's rule).

### E. Assembly

- Scope: atlas layout from the index page, edge alignment, piece stitching with graph-cut seams, PDF page extraction (pikepdf), a password PDF skipped, DWG reported.
- Tests:
  - a synthetic atlas of 3×3 pages with one missing page leaves one hole;
  - a page out of order is placed by the index;
  - synthetic overlapping pieces are stitched within 1 px;
  - an encrypted-without-password PDF extracts; a password PDF is skipped;
  - a DWG file gives the `needs-cad-export` row.

### F. Optimisation and export

- Scope: the RGB path through warp, merge, export and tiles; `lineart` encoding with paper transparency; maxzoom from gsd and budget; originals untouched; local-only `scan`.
- Tests:
  - a grey input's outputs stay byte-identical to today's (regression);
  - an RGB input keeps colour (channel means preserved within 2 %);
  - line art has no grey halos at maxzoom (a palette of at most 4 colours);
  - the paper-transparent alpha;
  - `maxzoom` cases (1:500 at 300 dpi gives 19 under a 2 GB budget);
  - a byte estimate within ±25 % of the real archive on a fixture;
  - the original's SHA-256 is unchanged after a run.

### G. Functions

- Scope: `worker.archiveReport`, `archive.import`, `archive.cancel`; `localOnly` refusing `imagery.runOn`; the cap at one per series job with `daily` waits released by the tick in order; `autoApproves` for maps (own-extent coverage, the scaled threshold, no scale meaning no auto); the publish rights gate; attribution built into the manifest.
- Tests (emulator and unit):
  - 33 series with 10 left today gives 10 queued and 23 `daily`, and the tick releases the next day;
  - a re-run does not count;
  - moving a local-only job to the cloud is refused;
  - an unconfirmed series refuses publish; confirmed, it publishes;
  - auto-approve true and false per rule;
  - access matrix rows (editor yes, uploader and viewer no);
  - a 1 MB document limit cannot be reached (the report is capped and paged).

### H. Admin UI, viewer and e2e

- Scope: the import card, the scan report, the rights dialog, progress, results with sheet outlines, settings; the viewer's Maps subgroup, chip glyph and rights row.
- Each behaviour gets a happy and a bad row in `e2e/scenarios.json`:
  - S-A import: happy and BAD-NO-WORKER;
  - report edit: happy and BAD-YEAR-EMPTY;
  - unsafe zip: BAD-ZIP-SLIP;
  - the daily queue: BAD-DAILY-SPLITS;
  - low confidence to points: BAD-LOW-CONFIDENCE;
  - rights gate: happy and BAD-RIGHTS-UNCONFIRMED;
  - skip reasons: BAD-DUPLICATE, BAD-CAD;
  - S-V Maps group: happy and BAD-NO-MAPS;
  - rights row: happy and BAD-NO-RIGHTS.
- Every screen and state goes into the tour with `expectStateSound`. Strings exist in `ro` and `en`. The worker is a fake at the boundary; owned modules are never mocked.

### I. Acceptance on `harti.zip`

(CPU on the NUC, GPU here, nothing uploaded until the owner approves)

- Run the scan, then every series job on the worker against the local emulators.
- Record a table per series: placed and skipped sheets, blocked figure, threshold, auto or points, minutes, bytes, peak memory.
- Checkerboards read by eye.
- Record whether the IPB grid also fits IGA 1895, IGA 1911 and the cadastral plan within 5 m (the inventory's claim, **UNVERIFIED**).
- Results go into this document's *As built*, and bugs go into `docs/LESSONS.md`.

**Order:** A, then B with C and F in parallel, then D and E, then G and H, then I.

## 11. Estimate for this archive

| Series | Path | Expected |
| --- | --- | --- |
| IPB 1:500 (4,545; base layer plus edition layers) | b, grid | **Auto.** The grid is solved from the whole series; about 98 % of sheets placed, the rest reported. Publish blocked on rights. |
| IPB 1:2000 (531) | b, grid | **Auto.** 15 odd names need checking in the report. Blocked on rights. |
| Cadastral 1911–14 (124) | b, grid | **Auto** for about 109. The about 15 street-named files are matched against IGA 1911: mostly auto, a few need points. |
| IGA 1895–99 (4 quadrants, grey; TIF fallback) | b, printed grid | **Auto** (tens of crossings per quadrant) |
| IGA 1911 official edition (4, grey) | b, printed grid | **Auto.** The 1:5000 vs 1:10000 question is settled by the detected grid. |
| IPB mosaic 1962–78 (2) | c against IPB 1:2000 | **Auto likely** (same content). Rights blocked. |
| 1974 centre, building periods (2 halves) | c against IPB 1:2000 | **Auto likely.** Rights blocked. |
| Coloured 1895 pieces (60) | pieces, then c against IGA 1895 | Stitch **auto**, with holes where pieces are missing. Calibration **auto likely**. |
| Single maps 1893 Orascu, 1895 PNG, 1897, c. 1900 Baedeker, 1914 SOCEC, 1921, 1928, 1931, 1939 (9) | c against IGA 1895/1911 and OSM | **Possible.** About 5–7 of 9 automatic (estimate); the rest need about 4 points. |
| 1886, 1871 Pappasoglu, 1864 regional | c | **Points likely** (small scale, generalised); suggested pairs offered |
| Borroczyn 1846 atlas (95 map pages; page 50 from the twin) | atlas, then c against IGA 1895 | Assembly **auto**. Calibration **possible**; expect a few points, then TPS. |
| Borroczyn 1852 (A–D), post-1847 sheet | assemble, then c against 1846 | The 1852 border's Paris-meridian longitudes (+2°20′14″) give a **coarse prior only**. **Points likely.** |
| 1770, 1789/91 Purcel, 1791 Ernst, 1799 (500×366) | c against Borroczyn 1846 | **Points.** Never auto-publishes (no scale). 1799 is `too-small`, importable at about z14. |
| 1935 street-plan scheme | c | **Points.** A plan, not a survey: never auto-publishes. |
| Miorini 1923 PDF (143 pages) | PDF, atlas, then c | **Possible.** Depends on the encryption type and an index page (**UNVERIFIED**). |
| 1969 atlas (144 tiny pages), 1968, 1982 | c or atlas | Low value at 478×909. Rights blocked. **Points.** Recommend deferring. |
| DWG | e | "Needs export from CAD" (v1) |
| Giurescu (2), Oltean 1847, index photo, 1770 crop, Thumbs.db, VCF, LL.TXT, 10 exact duplicates, twin TIFs | d | Skipped with a reason |

**Totals.** About 5,300 of the 5,304 TIFF sheets (the grid and cadastral series) place automatically. Of the about 35 drawn single maps and atlases, about 12–15 are likely automatic. The rest go to the georeferencer with suggested pairs, typically 4–8 points each. **Publishable without the owner's rights answer:** everything from 1931 and earlier. The IPB and post-1966 series wait for confirmation.

## 12. Not verified, and owner decisions

- **Not verified:**
  - that the IPB grid is the same grid as IGA 1895 and 1911 and the cadastral plan;
  - the grid's quarter numbering;
  - a road segmenter with explicitly licensed weights;
  - LibreDWG's licence fit;
  - Miorini's encryption type;
  - TransDatRO in PROJ-data;
  - the run times and byte figures (all checked in Workstream I).
- **Owner decisions:**
  - the map threshold rule and its 60 m cap (§5);
  - whether local archive jobs count against the daily cap (proposed: yes, one per series, §1.3);
  - z19 versus z20 for the 1:500 plan;
  - the year for undated base editions (1977 prefilled);
  - where the IPB sheets came from and permission to publish them;
  - deferring the 1969 atlas and the DWG.

## 13. The owner's decisions (2026-11-09)

- **The map threshold** is the scaled rule of §5: `max(city threshold, 1 mm × scale)`, capped at `mapThresholdMaxM` (default 60 m, range 15–200); `mapAutoPublish` is on by default. A map of no stated or detected scale never publishes itself.
- **Rights.** The whole Idei Urbane DocuBucurești collection is free to publish, credited "Idei Urbane – DocuBucurești" with a link to <https://ideiurbane.ro/docubucuresti-planuri-harti-si-alte-documente/>, plus the originals where known: the 1871 Pappasoglu plan from Wikimedia Commons / Biblioteca Academiei Române; c. 1900 and c. 1938 from muzeuldefotografie.ro; 1844–46, 1895–99, 1911, 1968, 1969 and 1974 probably digitised about 2000 at UAUIM "Ion Mincu" (marked *probable*). So the IPB 1:500 and 1:2000 sheets, the 1962–78 mosaic, 1968, 1969, 1974 and 1982 are rights *confirmed by the owner* (`licence: 'permission'`, `confirmedBy`).
- **Skipped:** `bucuresti 1847.jpg` (copyright Radu Oltean) and the two Giurescu 1966 book pages (`do-not-publish`).
- **Dates and zoom:** the 1974 plan is dated 1962–1978; the undated 1:500 base edition gets year 1977, labelled 1961–1977; the IPB 1:500 series stops at z19.
- **The daily cap:** a local archive's job counts once per series (§1.3).
- **DWG:** "needs an export from CAD" in v1. **The 1969 atlas:** imported (the owner published it), at a low priority.
- **The standing rule** (every importer falls back to one guided "Help calibrate" queue, designed separately): until that design lands, an uncertain series ends in `awaiting_gcps` with suggested pairs and a one-line reason, in a small shared record (`helpItemSchema`: `reason`, `note`, `at`) that the queue's design adopts.

These decisions reach a run through the owner's sidecar `hcm-archive.json` (§2.3 step 10), which now also takes `confirmedBy`, `maxzoom` and `priority: low`. A permission with no `confirmedBy` is read as *needs confirmation*, and a watermark with a copyright mark stays *do not publish* unless a permission is named.

## 14. As built: the core (track/archive, 2026-11-09)

What landed (§1–§2, §4, §6, §7; Workstreams A, B, the core of F and G):

| Part | Where | Notes |
| --- | --- | --- |
| Contracts | `packages/shared/src/schemas/imagery-archive.ts`, `packages/shared/src/api/archive.ts`; Python twins in `pipeline/src/hcm_pipeline/archive/model.py` (held equal by `pipeline/tests/contracts/enums.json`) | `archiveDocSchema`, `archiveSeriesSchema`, `archiveIssueSchema`, `archiveSeriesParamsSchema` (with `maxzoom`), `archiveSourceSchema`, `archiveReportSchema`, `rightsSchema`, `helpItemSchema`, `gridDocSchema`, `mapThresholdM`, `rightsAllowPublish`, `creditLine`, `layerRightsSchema`, `layerRightsOf`. Job type `archive-series` (steps `gather`, `place`, then the shared tail), wait reason `daily`, `JobDoc.localOnly` and `countedAt`, version origin `archive` with `archive`, `rights` and `help`. |
| Settings | `packages/shared/src/schemas/imagery-settings.ts` | `mapThresholdMaxM` (60, 15–200) and `mapAutoPublish` (on). |
| Credits and provenance | `functions/src/imagery/finalize.ts`, `layerRightsSchema` in `imagery-archive.ts` | The manifest's `attribution` carries the built credit line (author, title, year, licence, scan source and watermark), which already reaches the legal line and the compare bar. The layer document keeps `rights` (`{licence, author?, source?: {label, url?}}`). **The manifest field `layer.rights?` of §7 is not built:** with it the engine's IIFE measured 125,040 bytes gzip against its 125,000 budget, so it waits for viewer bytes (with §9's rights row, Workstream H); the builder does not copy it, so the v1 manifest is unchanged. |
| Intake and scan | `pipeline/src/hcm_pipeline/archive/` (`safepath`, `zipread`, `magic`, `probe`, `probe_child`, `classify`, `grammar`, `sidecar`, `rights`, `encoding`, `report`, `intake`) | The probe child is spawned through `multiprocessing` (never forked, no `subprocess`), limits itself, and a crash or timeout is an `unreadable` row. Classification covers junk, duplicates, CAD, georeferenced, grids (the Bucharest quarter and block names, `Seria N/`, the 1:1M scheme, row-col), atlases with their titled pages, and singles. Pieces and twins need pixels and stay singles until Workstream E. |
| The worker's page | `pipeline/src/hcm_pipeline/worker/import_page.py`, `worker/imports.py`, routes in `worker/server.py` | `GET /import`, `POST /import/new`, `/import/<id>/file` (streamed, `X-HCM-Path`), `/import/<id>/zip`, `/import/<id>/scan`, `GET /import/<id>`; the page's origin and CSRF header as the main page's. |
| Server | `functions/src/worker/archive-report.ts`, `functions/src/imagery/archive-import.ts`, `functions/src/imagery/daily.ts`; `limits.ts` (`dailyRoom`, `countedAt`), `run-on.ts` (`localOnly`), `claim.ts` and `dispatch.ts` (`daily` is never claimed or dispatched), `tick-jobs.ts` (the release), `approval.ts` (the map rule), `approve.ts` (the rights gate), `finalize.ts` (kind `map`, opacity 0.85, the credit line, the layer's rights) | Firestore rules: `archives/{a}`, `archives/{a}/issues/{i}` and `grids/{g}` are read by city members, written by the server only. |
| Pipeline steps | `steps/gather.py`, `steps/place.py`, `tiles/encoding.py`, `steps/pyramid.py`, `steps/export.py` | `gather` checks every sheet's SHA-256 where it lies and writes the local `sheets.json`; `place` dispatches to a placer per class (`PLACERS`, empty in the core) or parks the version `needs_gcps` with `help` (`no-path`) and the job `awaiting_gcps`. Tiles per encoding: line art lossless WebP, nearest at the deepest zoom, its paper transparent; grey as today; colour at q82. A line-art COG is DEFLATE with a predictor, never JPEG. The export step is band-agnostic, so an RGB `warped.tif` keeps its colour. |

What the paths phase (§3, Workstreams C, D, E and the rest of F) needs from the core:

- **A placer per class**, registered in `steps/place.py`'s `PLACERS` (`grid`, `atlas`, `pieces`, `single`, `georeferenced`), each writing `warped.tif` (RGBA or grey and alpha, EPSG:3857, at the resolution of `params.maxzoom`) and the version's `archive` report (`archiveReportSchema`: `method`, `encoding`, `paperTransparent`, `scaleDenominator`, the blocked `checkpointRmseM`, `checkpointCount`, `checksDropped`, `measuredPct` on the map's own extent, `rivalClean`, `residuals`), then `Done`; or `wait_for_help(ctx, reason, note, {"suggestions": ...})` with `HELP_REASONS` (`low-confidence`, `frame-not-found`, `no-scale`).
- **The sheet list** is `work/{city}/{job}/sheets.json` (path relative to the archive, cell, bytes, SHA-256), written by `gather`; the originals are under `ArchiveStore(root).files(archiveId)`.
- **The approval** already applies §5 to `archive` (no `georef` or `scan` is needed); `register` and the publish steps are unchanged.
- **Not built in the core:** the admin's Import card, scan report, rights dialog and progress (Workstream H), the manifest's `layer.rights?` and the viewer's Maps subgroup, chip glyph and rights row (§9: they need engine bytes the IIFE does not have; the layer document already keeps the rights), OCR prefill (§2.3 step 11), contact sheets and thumbnails (§2.2, §2.4), grid documents written by a solve, recalibration of a series (§4, M16), and the acceptance run on `harti.zip` (Workstream I).
- **A layer's year is 1800 to 2100** (`yearSchema`): `imagery.archiveImport` refuses a series dated before 1800 (the 1770–1799 maps) with `apiError.invalidRequest` until the viewer's timeline takes earlier years; the report itself takes years from 1500.

## 15. As built: the paths (track/archive, 2026-11-09)

What landed (§3 a–e, *PDFs*, *Atlases and pieces*, the reference ladder of §1.7, the checks of §3 c step 6; Workstreams C, D and E):

| Part | Where | Notes |
| --- | --- | --- |
| The placers | `pipeline/src/hcm_pipeline/placing/`, registered in `steps/place.py` `PLACERS` | `georeferenced` → `embedded.py`; `grid` → `grid.py` (+ `gridscheme.py`, `render.py`); `single`, `atlas`, `pieces` → `maps.py` (+ `single.py`, `assemble.py`, `pdfpages.py`). Each writes `warped.tif` and the version's `archive` report and `source.placedCount`, or waits `needs_gcps` with `help` (and `junctions` suggestions), never `failed`. |
| Street network (§3 c step 2, the classical path) | `placing/streets.py` | Paper (lighter than Otsu, unsaturated in colour) that spans the map; Zhang–Suen skeleton; on a line plan only the skeleton within 2.5 street half-widths of ink (block interiors are paper too); junctions by crossing number, merged within a street's width. The AI `RoadSegmenter` is not built (no licensed weights verified). |
| Neat line (§3 b step 2, §3 c step 1) | `placing/frame.py` | The outermost rows and columns of ink that run across half the sheet (a faint line of a reduced 1-bit scan counts as ink), each side fitted as a line and their crossings the corners; else the largest convex four-cornered outline; 30–99.5 % of the sheet, in full-scan pixels. |
| Reference (§1.7, §3 c step 3) | `placing/reference.py` | The job's `referenceLayerIds` (a calibrated layer's COG, read as streets, its own error carried), then OpenStreetMap, asked once per city window and cached in the worker's work folder (`osm/`). Never Mapbox Satellite. |
| Coarse placement (§3 c step 4) | `placing/coarse.py` | Chamfer by FFT template matching, zero-mean (the closeness on the map's lines less what the window gives by chance: lesson 528) on a loosened closeness (σ 4 px), scales 12 % apart (±25 % around a stated scale and dpi), four quarter turns ± 3°; three placements far apart are kept; each is refined in 2 % and 1° steps on a finer reference. |
| Fine fit and checks (§3 c steps 5–6) | `placing/fine.py`, `placing/checks.py`, `placing/geometry.py` | Junction pairs within 4 reference pixels, a seeded RANSAC similarity that keeps the pixel flip, an affine, then a thin-plate spline with ≥ 30 pairs over ≥ 60 % of the map (a grid's mosaic stays affine). Checks: one block in five held out before any fit; gross = max(100 m, 5 mm × scale), any gross check blocks; the span on the map's own extent. Holds with ≥ 20 pairs and ≥ 20 % of the training junctions, ≥ 5 checks; the winner is the candidate with most pairs and its runner-up must have at most half as many (M9's rival share). A ladder rung's own error is added in quadrature. |
| Grid series (§3 b) | `placing/grid.py`, `gridscheme.py`, `render.py` | `CityGrid` (500 m cells, rows south, columns east, quarters, 2 × 2 blocks, cadastral cells) as a pluggable scheme per grammar; the quarter order of eight chosen by the seams; the series' mosaic at 2 m (coarser past 6,000 px) placed as one map of known scale, north up, rigid; or from the owner's confirmed grid (`params.gridId` → `cities/{c}/grids/{g}`). Every sheet rendered by a 5 × 5 lattice through its frame's homography, cut at its neat line, hard seams. Not built: the joint seam solve, printed-crossing detection, TPS per sheet. |
| Atlases and pieces | `placing/assemble.py`, `placing/maps.py` | Atlas pages (or a PDF's pages) cropped to their frames and laid out by edge continuity, strongest links first (no OCR of the index page); pieces chained by SIFT affines along the strongest overlaps, nearest-centre hard seams (no graph cut, no bundle adjustment). The canvas stays in the job's scratch folder and is placed as one drawn map. |
| PDFs | `placing/pdfpages.py` (pikepdf 10.18.0) | Each page's largest image written as stored; an owner-locked PDF (Miorini 1923: Standard handler, V4 R4) is read; a password PDF waits (`PDF_LOCKED`) and is never cracked. |
| Georeferenced files (§3 a) | `placing/embedded.py` | Own tags or GCPs; a world file read by the placer itself (lesson 522), its system inferred among Stereo 70, the city's UTM zone, EPSG:3857 and 4326 by where the centre lands; the ruler against OpenStreetMap: a median offset over 15 m waits ("disagrees with OpenStreetMap by N m"). |
| Pieces at the scan | `archive/classify.py` `take_pieces` | A folder of ≥ 3 scans in a scanner's order (`img362.jpg`) is one pieces series; sibling folders that are all pieces merge at their parent (the four `N_quadrat` of the coloured 1895 plan). |
| Server | `functions/src/worker/{allow-list,step-update}.ts` | A run may write `source`, but only an archive series' `placedCount` and `skipped` (`sourceAllowed`). |
| Contracts | `AUTO_GCP_METHODS` (+ `junctions`) | Shared, Python, `pipeline/tests/contracts/autogcp.json`. |

Tests: `pipeline/tests/unit/test_placing_{parts,single,assemble,grid,embedded}.py` on a synthetic town (`pipeline/tests/synthetic/town.py`: a jittered, bent street grid drawn as grey, colour or line-art maps, sheets, pages and pieces through known placements), `functions/test/worker/step-archive.test.ts`; scenarios `S-P20-HAPPY-{STREETS,FRAME,CHECKS,MATCH,LINEART,PIECES,ATLAS,PDF,GRID,EMBEDDED,LADDER}` and `S-P20-BAD-{FRAME-NOT-FOUND,OTHER-CITY,LOW-CONFIDENCE,PDF-PASSWORD,GRID-NOT-PROVED,EMBEDDED-DISAGREES,SOURCE-FORGED}`.

### 15.1 The local dry run on `harti.zip`

Run on the NUC on 2026-11-09 against the extracted `harti.zip`, with the worker's own intake and the real `gather` and `place` steps in a
local-only world (documents in memory, objects in a local folder, nothing uploaded); OpenStreetMap read once for the city window from a
public Overpass mirror and cached (the main instance refused this network). Maximum zoom capped at 16 for the run.

- **Scan**: 5,703 files probed in 74 minutes (one spawned probe child per file); after the classification fixes (DECISIONS §135h) 64
  series: 9 grid (1:500 base and 6 one-sheet editions, the 1:2000, the cadastral plan), 4 atlases (Borroczyn 1846 twice, the 1969 atlas,
  Miorini's PDF), 1 pieces (the coloured 1895, 60 scans), 46 singles, 4 skipped (Oltean, two Giurescu pages, the 500 px 1799 plan); 66
  files skipped (50 not a map, 10 duplicates, 4 titled pages, 1 index, 1 DWG).
- **Outcome**: **no series placed itself**; all 60 imported series ended `awaiting_gcps` with a one-line `help`, none failed, none was
  placed wrongly. Times: 1:500 grid 18.0 min (4,533 sheets, peak 1.2 GB), 1:2000 grid 7.1 min, every other series under 2 minutes.
- **What worked**: names to cells and neat lines placed the sheets on the city grid by themselves: the 1:2000 mosaic (303 of 512 sheets
  framed) shows Bucharest's ring railway, the Dâmbovița and its street pattern in place (preview `preview-ipb-1-2000-mosaic.png`), and the
  1:500 mosaic (2,356 of 4,501 framed) the city's outline; the PDF's 143 pages came out of the encrypted file.
- **Why they wait** (each a next step):
  - the grid solve against OpenStreetMap does not prove: the classical street network is read from paper corridors, and the IPB line
    plans are sparse outlines; a solve on the ink itself (rails, river, block edges) against OpenStreetMap's lines is the next try;
  - the cadastral sheets have no printed neat line (`frame-not-found`): their cells need a frame from the content's extent or the grid's
    printed crossings; 2,145 of the 1:500 and 209 of the 1:2000 sheets are framed by neither method yet;
  - drawn maps: guide maps hatch or tint their blocks and letter their streets, so a grey threshold finds no street network or the wrong
    one (the 1900 Baedeker crop, `streets-baedeker-1900-crop.png`); six coloured maps showed no network at all. This is the case §3 c
    step 2 kept for the `RoadSegmenter` (gate R2), and OCR of the printed scale would narrow the search for every single map;
  - atlases: edge continuity joined 2 of 94 Borroczyn pages and none of Miorini's (hand-drawn pages do not continue pixel for pixel
    after cropping); the index page (OCR) is needed; pieces: SIFT on the reduced colour scans joined 1 of 60.

The per-series table and the previews are the run's artefacts (`harti-dryrun.json`, kept outside the repository with the archive).

## 16. As built: the admin and the viewer (Workstream H, track/archive, 2026-11-09)

What landed (§8, §9, §5's settings; behaviours A121 and V53):

| Part | Where | Notes |
| --- | --- | --- |
| Import local files | `packages/ui/src/admin/archive/hcm-archive-panel.ts`, in the Imagery area's Upload view under the GeoTIFF upload | With no worker of the city seen in the last three minutes: "Start the worker on this computer first", Open Jobs. With one: **Choose a folder or zip on this computer**, a link to the worker's own page `http://127.0.0.1:8765/import?lat=<the city's latitude>` in a new tab (a page of the map's site cannot reach the computer's loopback). Below, the scanned archives (`cities/{c}/archives`, newest first), each opening its report. An archive that arrives while the card is open, not yet imported, opens its report by itself (`hcm-archive-arrived`). |
| The scan report | `packages/ui/src/admin/archive/hcm-archive-report.ts` at `#/imagery/archive/<id>` (the Imagery page's detail kind `archive`) | Files, size, series found, files skipped by reason; per series: title and year label, what will happen ("Place 4,545 sheets from their names on the city's grid", "Skipped: may not be published (rights)"), the chance to calibrate itself, the rights chip, zoom, bytes and minutes; Import this series, Title, Year; rights that wait ask "Permission from" and Confirm the rights (inline, not a dialog). The total: series, bytes of tiles, days at the city's daily share. One **Import** (`imagery.archiveImport` with only the owner's edits); "N series start today, M wait for the next days". |
| First edits | `packages/admin/src/archive/model.ts` | A series is kept when the scan proposes it and a layer can show its year (1800–2100): the 1770–1799 maps, the too-small 1799 plan and the skipped series start left out, so the defaults import without a click more. |
| Progress | the same report once the archive records its jobs | Each series from its version and its job, live (`layerVersions` where `source.archiveId`, `jobs` where `params.archiveId`): Waiting for a later day's share, Waiting for the computer, Working: step, percent; Needs your points and the help's reason; Waiting for approval with the blocked error against the threshold its scale earns (`mapThresholdM` with the city's settings), or "the map has no scale"; Publishing, Published, Failed, Cancelled; each opens its version's page. |
| Rights confirmed | `functions/src/imagery/archive-import.ts` | A choice whose rights name `confirmedBy` is stamped `confirmedAt` by the server's clock. |
| Settings | `packages/ui/src/admin/settings/imagery-section.ts`, group *Drawn maps* | Publish drawn maps within their threshold on their own (`mapAutoPublish`, on) and A map's largest threshold (`mapThresholdMaxM`, 60, 15–200, said at its field when out of range). |
| A version's place | `packages/admin/src/worker/feed.ts` | `archive-series` joins the pipeline's job types, so an archive version's page shows where its job runs and why it waits (lesson 529). |
| The chunk | `packages/admin/src/archive/archive.ts` (the `archive` chunk, its own row in `scripts/ci/check_bundle_budget.py`), texts `@hcm/shared/admin-archive` (`ro`, `en`) | Fetched when the Upload view or a report first shows (`ImageryIntents.archive`, `archiveElements`). |
| The owner's sidecar in a folder | `pipeline/src/hcm_pipeline/archive/sidecar.py` | A folder chosen whole arrives under its own name, so `hcm-archive.json` is also read from the archive's one top folder; its paths stay relative to the archive's root (`Harti/...`). |
| The viewer | none | A map layer already renders, is listed in Layers with its credit (`attribution`, the built credit line) and credits the legal line while it shows (S-V53-*). §9's Maps subgroup, the chip's map glyph and the rights row are **not built**: the engine's IIFE has 4 bytes of headroom (DECISIONS §113a), so they wait for the owner's budget decision or a saving (DECISIONS §136c). |

The admin-input budget: from the Upload view, Choose (1), the zip on the worker's page (2), Import (3); the report opens by itself when the worker's report arrives (S-A121-HAPPY-BUDGET). Scenarios `S-A121-*`, `S-V53-*`, `S-P20-HAPPY-SIDECAR-FOLDER`; tour states `archive.*` (`e2e/admin/specs/imagery/archive-states.ts`).

**Not built here:** the sheet outlines and per-sheet residuals over the map, Exclude sheet, the checkerboard for a series (the version's page shows its own-tiles preview as for any version), a rights confirmation after Import (Approve refuses until then; a re-scan imports again), Home's *What needs you* rows for series, OCR prefill and contact sheets in the report.

## 17. As built: the review's fixes (track/archive, 2026-11-09)

DECISIONS §137; lessons 530 and 531.

| What | Where | Behaviour |
| --- | --- | --- |
| Sidecar inheritance | `pipeline/src/hcm_pipeline/archive/sidecar.py` | Every entry that covers a file applies from the root down, a deeper key overriding. New keys `originalLabel`, `originalUrl`, `originalProbable`. |
| The original in the credit | `packages/shared/src/schemas/imagery-archive.ts` | `rights.original {label, url?, probable?}`; the credit line ends "original: …" or "original, probably: …". |
| Rights on the server | `functions/src/imagery/archive-import.ts` | The stored report's rights; a series' sent rights are the owner's confirmation only (owner role, `confirmedBy`), stamped `confirmedAt`. |
| Year | same, `packages/admin/src/archive/model.ts` | `?` or before 1800 without a typed year: `apiError.imagery.archiveYear`. The 1800 minimum stays (owner, 2026-11-09). |
| Daily share | `functions/src/imagery/limits.ts` (`dailyRoomIn`, `passTurnstile`), `daily.ts` | Counted inside the import's and each release's transaction behind `ops/daily`. A share of 0: "none starts until it is raised". |
| Local only | `pipeline/src/hcm_pipeline/steps/export.py` (`uploads_rasters`), `functions/src/imagery/tick-worker.ts`, `packages/ui/src/admin/worker/hcm-run-place.ts` | No COG or Studio upload for an archive series; no cloud offer for a local-only job. |
| Sheet names | `pipeline/src/hcm_pipeline/archive/grammar.py` | Blocks of neighbours only; `prim`, `-MIC`, whole cells read as odd; no extension, no cell. |
| Intake | `archive/intake.py`, `archive/zipread.py` | A cut-off file is removed and refused; an entry onto the zip itself is refused. |
| Estimates | `archive/report.py`, `archive/intake.py` | A grid sheet counts `GRID_CELL_SHARE` (0.5) of its paper; `bytes` is every file's. |
