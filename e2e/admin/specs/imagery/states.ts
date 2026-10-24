/**
 * The M3 screens' states of the tour inventory (`ADMIN_STATES` of e2e/tour/states.ts spreads them inside its imagery
 * section, which keeps that file within its line limit; docs/research/M3-interfaces.md §10.9, §12.2): the Imagery area,
 * the Jobs page's raster jobs, the georeferencer, the layer editor's Crop, Replace and pending version, the Link dialog's
 * Check and the imagery settings, ids `imagery.<state>`, `georef.<state>`, `layers.<state>` and `settings.<state>`, each reached by the spec named in
 * `visit` at the admin tier's five projects (the Jobs page's in a city of its own, the others behind the tier's lock).
 */
export const IMAGERY_STATES = {
    'imagery.results': {
        title: 'Historical imagery: the ranked scenes, free first, their reasons, the filters and the footprints on the map',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.scene': {
        title: 'Historical imagery: a scene with its preview, its reasons and Import',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.browse-unavailable': {
        title: 'Historical imagery: a scene whose preview cannot be fetched, with Try again',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.empty-usgs': {
        title: 'Historical imagery: USGS not set up, with the link to its Setup step',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.zero-results': {
        title: 'Historical imagery: a search that found nothing, and what to try (every year, every collection, the area)',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.search-credentials': {
        title: 'Historical imagery: a search USGS refused for its token, with the way to its Setup step',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.downloads-pending': {
        title: 'Historical imagery: a free scene while USGS has not approved downloads, Import off and why',
        visit: 'specs/imagery/search.spec.ts',
    },
    'imagery.version-steps': {
        title: 'Historical imagery: a version being made, its steps advancing live, Cancel',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-approval': {
        title: 'Historical imagery: a version over the threshold, both errors, the compute units and Approve',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-published': {
        title: 'Historical imagery: a version the policy approved and published',
        visit: 'specs/imagery/published.spec.ts',
    },
    'imagery.version-cancelled': {
        title: 'Historical imagery: a cancelled import',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-failed': {
        title: 'Historical imagery: a failed import, its error, the failed step and Retry',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-dismiss': {
        title: 'Historical imagery: a failure no retry cures, no Try again, and Dismiss asked first',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-usgs-wait': {
        title: 'Historical imagery: an import waiting for USGS maintenance to end',
        visit: 'specs/imagery/import.spec.ts',
    },
    'imagery.version-over-budget': {
        title: "Historical imagery: an approved version past the month's compute units, the three ways out",
        visit: 'specs/imagery/publish.spec.ts',
    },
    'imagery.version-studio': {
        title: 'Historical imagery: the free Mapbox Studio upload in three steps',
        visit: 'specs/imagery/publish.spec.ts',
    },
    'imagery.upload-approval': {
        title: 'Historical imagery: an uploaded GeoTIFF with its own georeference, its error unmeasured, Approve',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.upload-needs-points': {
        title: 'Historical imagery: an uploaded scan without georeference, waiting for points, the georeferencer',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.upload-not-tiff': {
        title: 'Historical imagery: Upload refusing a file that is not a TIFF',
        visit: 'specs/imagery/upload.spec.ts',
    },
    'imagery.guard-paused': {
        title: 'Historical imagery: processing paused by the budget guard, the spend and Resume processing',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.guard-resume': {
        title: 'Jobs: Resume processing? asked first, what it lets spend',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.job-guard-paused': {
        title: 'Jobs: processing paused by the budget guard, the spend and Resume processing',
        visit: 'specs/imagery/guard.spec.ts',
    },
    'imagery.job-failed': {
        title: 'Jobs: a failed import, every step by its name, Run it again',
        visit: 'specs/imagery/jobs.spec.ts',
    },
    'imagery.job-points': {
        title: 'Jobs: an import waiting for points, with the georeferencer',
        visit: 'specs/imagery/jobs.spec.ts',
    },
    'georef.pairs': {
        title: 'Georeferencer: the scan, the reference map, the pairs and their residuals',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.too-few': {
        title: 'Georeferencer: too few pairs, Save off',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.rmse-over': {
        title: 'Georeferencer: an error over the threshold, the warning',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'georef.degenerate': {
        title: 'Georeferencer: pairs in a line refused, Save off',
        visit: 'specs/imagery/georeferencer.spec.ts',
    },
    'layers.link-probed': {
        title: 'Layers, Link a layer: Check asked one tile, which answered',
        visit: 'specs/imagery/link-probe.spec.ts',
    },
    'layers.link-no-tiles': {
        title: 'Layers, Link a layer: Check found no tiles, Link off',
        visit: 'specs/imagery/link-probe.spec.ts',
    },
    'layers.pending-version': {
        title: "Layer editor: a new version of the layer's image on its way, the layer keeping its tiles",
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'layers.crop-refused': {
        title: 'Layer editor: a crop off the layer refused, why',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'layers.crop-drawn': {
        title: 'Layer editor: the area to keep drawn on the map, Save the crop',
        visit: 'specs/imagery/layer-geometry.spec.ts',
    },
    'settings.imagery': {
        title: 'Settings: historical imagery, auto-publish off',
        visit: 'specs/imagery/publish.spec.ts',
    },
} as const;
