/**
 * USGS M2M scene search and download availability (docs/research/M3-interfaces.md §3), with an API key from
 * `UsgsApi.login` (the harvest logs in, searches, and logs out in a `finally`). Adapter: `functions/src/adapters/usgs.ts`
 * (fn-imagery extends fn-setup's adapter); failures as `UsgsApi`'s (`maintenance` for the HTML 503, `rateLimited`,
 * `unauthorized`, `invalid`, `unavailable`). The browser never calls USGS (no CORS outside `*.usgs.gov`).
 */
interface SceneSearchRequest {
    /** `corona2`, `declassii` or `declassiii`. */
    readonly dataset: string;
    /** The city's bounds: the M2M `spatialFilter` (`mbr`). */
    readonly bounds: { readonly west: number; readonly south: number; readonly east: number; readonly north: number };
    /** `YYYY-MM-DD`, the acquisition window (M2M `temporalFilter`). */
    readonly from?: string;
    readonly to?: string;
    readonly maxResults: number;
    readonly startingNumber?: number;
}

/** One `scene-search` result as the harvest needs it (`metadataType: 'full'`). */
interface SceneRecord {
    readonly entityId: string;
    readonly displayId: string;
    /** `temporalCoverage.startDate`'s date. */
    readonly acquisitionDate: string;
    /** `spatialCoverage`'s outer ring, `[lng, lat]` pairs as M2M sends them, open. */
    readonly footprint: readonly (readonly [number, number])[];
    /** Null for M2M's `-1` (none recorded). */
    readonly cloudCover: number | null;
    /** `options.download`: already scanned. */
    readonly downloadAvailable: boolean;
    /** The first `browse[].browsePath`. */
    readonly browseUrl?: string;
    /** The full metadata's fields by name (the camera, the corner coordinates when listed). UNVERIFIED names. */
    readonly metadata: Readonly<Record<string, string>>;
}

interface SceneSearchPage {
    readonly records: readonly SceneRecord[];
    readonly totalHits: number;
    /** `nextRecord` when more pages exist. */
    readonly next?: number;
}

export interface DownloadOption {
    readonly entityId: string;
    readonly available: boolean;
    readonly bytes: number;
    /** M4: EarthExplorer's own id of the scene's dataset (the products' `datasetId`), when M2M sends one. */
    readonly datasetId?: string;
}

/** M4 (`docs/research/M4-interfaces.md` §1.6): a declassified dataset's M2M alias and EarthExplorer's own id of it. */
export interface DatasetIds {
    /** `corona2`, `declassii` or `declassiii`. */
    readonly alias: string;
    /** `5e839febdccb64b3`: what a scene's EarthExplorer page names. */
    readonly datasetId: string;
}

export interface UsgsScenes {
    search(apiKey: string, request: SceneSearchRequest): Promise<SceneSearchPage>;
    /** `download-options`: whether each scene can be downloaded now, and its size. */
    downloadOptions(apiKey: string, dataset: string, entityIds: readonly string[]): Promise<readonly DownloadOption[]>;
    /** M4: `dataset-search` for the declassified datasets (`declass`): each one's EarthExplorer id, read once per harvest. */
    datasets(apiKey: string): Promise<readonly DatasetIds[]>;
}
