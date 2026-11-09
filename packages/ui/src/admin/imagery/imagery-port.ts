/**
 * What `<hcm-imagery-page>` reads of the Imagery area (`packages/admin/src/imagery/imagery.ts`,
 * `docs/research/M3-interfaces.md` §10.2), mirrored structurally because `@hcm/ui` sits below `@hcm/admin`;
 * `packages/admin/test/app/admin-port.test.ts` checks that the real store satisfies it.
 */
import type {
    ApiErrorCode,
    BBox,
    Calibration,
    CheckpointKind,
    DatePlanRow,
    GeorefTransform,
    JobStatus,
    JobType,
    JobWaitReason,
    JoinPart,
    JoinReport,
    LayerVersionState,
    LngLat,
    OrderState,
    PublishChoice,
    RankReasonEntry,
    Recalibration,
    SceneAcquisitionState,
    Sensor,
    ServiceState,
    UsgsDataset,
} from '@hcm/shared';

import type { DocStatePort, ListStatePort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { GuardPort } from './guard-port.js';

export type ImageryTabPort = 'find' | 'work' | 'upload';
export type MapStatusPort = 'none' | 'loading' | 'ready' | 'no-token' | 'no-webgl' | 'failed';

/** M4 (`docs/research/M4-interfaces.md` §1.3): a scene's order as its card and page show it. */
export interface SceneOrderPort {
    readonly state: OrderState;
    readonly orderedAt: string;
    readonly nextCheckAt: string;
    readonly lastCheckedAt: string | null;
    /** The last failed check, as an `apiError.*` code. */
    readonly lastError: ApiErrorCode | null;
    readonly importJobId: string | null;
}

export interface SceneItemPort {
    readonly id: string;
    readonly displayId: string;
    readonly dataset: UsgsDataset;
    readonly sensor: Sensor;
    readonly sensorName: string;
    readonly date: string;
    readonly year: number;
    readonly status: 'candidate' | 'ordered' | 'available' | 'imported' | 'rejected';
    readonly free: boolean;
    readonly cloudCover: number | null;
    readonly resolutionM: number;
    readonly coverage: number;
    readonly score: number;
    readonly reasons: readonly RankReasonEntry[];
    readonly footprint: readonly LngLat[];
    readonly corners: readonly [LngLat, LngLat, LngLat, LngLat] | null;
    readonly browse: { readonly state: 'none' | 'copied' | 'failed'; readonly path: string | null; readonly error: string | null };
    readonly layerId: string | null;
    /** M4: the chip's one state, the order, the scene's EarthExplorer page (null: unknown, the card names the entity id). */
    readonly acquisition: SceneAcquisitionState;
    readonly order: SceneOrderPort | null;
    readonly earthExplorerUrl: string | null;
}

interface SceneFiltersPort {
    readonly freeOnly: boolean;
    readonly datasets: readonly UsgsDataset[];
    readonly fromYear: number | null;
    readonly toYear: number | null;
    readonly hideRejected: boolean;
}

type BrowseImagePort =
    | { readonly status: 'loading' }
    | { readonly status: 'ready'; readonly url: string; readonly preview?: string | null; readonly error?: AdminNoticeInputPort }
    | { readonly status: 'failed'; readonly error: AdminNoticeInputPort };

export interface VersionItemPort {
    readonly id: string;
    readonly layerId: string;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number;
    readonly origin: 'usgs' | 'upload' | 'regeoref' | 'crop' | 'join' | 'archive';
    readonly state: LayerVersionState;
    readonly updatedAt: string;
    readonly needsYou: boolean;
    readonly checkpointRmseM: number | null;
    readonly partOf: string | null;
    readonly entityIds: readonly string[];
    /** M12: the small picture of a waiting row. */
    readonly thumbPath: string | null;
}

export interface JobProgressPort {
    readonly id: string;
    readonly status: JobStatus;
    readonly progress: number | null;
    readonly step: string | null;
    readonly waitReason: JobWaitReason | null;
    readonly retryAt: string | null;
    readonly attempt: number;
}

interface SearchStatePort {
    readonly phase: 'idle' | 'searching' | 'done' | 'failed';
    readonly found: number | null;
    readonly added: number | null;
    readonly failedDatasets: readonly UsgsDataset[];
    readonly error: AdminNoticeInputPort | null;
}

export interface UploadStatePort {
    readonly phase: 'idle' | 'refused' | 'ready' | 'uploading' | 'checking' | 'done' | 'failed';
    readonly fileName: string | null;
    readonly bytes: number;
    readonly year: string;
    readonly needsYear: boolean;
    readonly refusal: AdminNoticeInputPort | null;
    readonly progress: number;
    readonly jobId: string | null;
    readonly layerId: string | null;
}

export interface VersionViewPort {
    readonly id: string;
    readonly layerId: string;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number;
    readonly date: string | null;
    readonly sensor: Sensor | null;
    readonly origin: 'usgs' | 'upload' | 'regeoref' | 'crop' | 'join' | 'archive';
    readonly state: LayerVersionState;
    readonly georef: {
        readonly method: string;
        readonly transform: GeorefTransform;
        readonly pairs: number;
        readonly fitRmseM: number | null;
        readonly checkpointRmseM: number | null;
        readonly checkpointCount: number | null;
        readonly checkpointKind: CheckpointKind | null;
    } | null;
    /** M9: how the frame was found and what proved it (`calibration-card.ts`). */
    readonly calibration: Calibration | null;
    readonly output: {
        readonly bounds: BBox;
        readonly minzoom: number;
        readonly maxzoom: number;
        readonly areaKm2: number;
        readonly previewPath: string;
        readonly studioPath: string | null;
        /** The file for Mapbox, in bytes (a refusal as too large names its size). */
        readonly cogBytes: number;
        /** M9: the share of the city the render holds, measured. */
        readonly coveragePct: number | null;
        /** M12: the version's own tiles (null: none yet); `bytes` is what publishing puts in the public bucket. */
        readonly tiles: { readonly path: string; readonly bytes: number } | null;
        /** M12: the image's measured edge over the city (the map shades what it misses). */
        readonly outline: readonly LngLat[] | null;
    } | null;
    readonly estimate: number | null;
    readonly guard: {
        readonly verdict: 'within' | 'over' | 'tileset-limit' | 'too-large' | 'city-over';
        readonly available: number;
        readonly overageUsd: number | null;
        readonly choice: PublishChoice | null;
        readonly deferUntil: string | null;
    } | null;
    readonly approval: { readonly auto: boolean; readonly by: string; readonly at: string } | null;
    readonly error: AdminNoticeInputPort | null;
    readonly hasScan: boolean;
    /** M8: the USGS scene it came from, the join that holds it, a join's frames and what the join measured. */
    readonly entityId: string | null;
    readonly partOf: string | null;
    readonly parts: readonly JoinPart[];
    readonly join: JoinReport | null;
    /** M16: the version it recalibrates, how and with what figures, and its own public archive (a published one). */
    readonly basedOn: string | null;
    readonly recalibration: Recalibration | null;
    readonly publicUrl: string | null;
}

export interface JobViewPort {
    readonly id: string;
    readonly type: JobType;
    readonly status: JobStatus;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly {
        readonly name: string;
        readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
        /** A running transfer's bytes so far and its total (null: unknown). */
        readonly transfer: { readonly received: number; readonly total: number | null } | null;
    }[];
    readonly waitReason: JobWaitReason | null;
    readonly retryAt: string | null;
    readonly attempt: number;
    readonly cancelRequested: boolean;
    readonly error: { readonly notice: AdminNoticeInputPort; readonly message: string } | null;
    /** Retry may cure the failure (CR-M3-47: not a token or scope problem, not a refused upload, attempts left). */
    readonly retryable: boolean;
    /** Mapbox was asked to publish: Cancel can no longer stop it. */
    readonly atMapbox: boolean;
    /** An upload the server refused (no version was made): the cure is another file. */
    readonly refusedUpload: boolean;
}

export interface JobLogLinePort {
    readonly seq: number;
    readonly level: 'info' | 'warn' | 'error';
    readonly step: string | null;
    readonly message: string;
    readonly at: string;
}

/** `usage/mapbox-YYYY-MM` as the approval card reads it (absent counters are zero). */
interface UsagePort {
    readonly computeUnits: number;
    readonly computeUnitBudget: number;
    readonly overageComputeUnits: number;
    readonly reservations: Readonly<Record<string, { readonly computeUnits: number }>>;
}

type VersionActionPort = 'approve' | 'reject' | 'choose' | 'studioDone' | 'download' | 'retry' | 'locate' | 'cancel' | 'recalibrate';

export interface VersionPagePort {
    readonly id: string;
    readonly version: DocStatePort<VersionViewPort>;
    readonly job: DocStatePort<JobViewPort>;
    readonly logs: ListStatePort<JobLogLinePort>;
    readonly usage: UsagePort | null;
    readonly acting: VersionActionPort | null;
    readonly refusal: AdminNoticeInputPort | null;
    readonly downloaded: boolean;
    /** M16: the version a recalibration would replace, and which of the two the map shows. */
    readonly current: VersionViewPort | null;
    readonly showing: 'new' | 'current';
}

/** M12: `small`: only the small picture exists; `loading`: on its way; `ready`: its tiles are on the map; `failed`: why not. */
type VersionImagePort =
    { readonly status: 'none' | 'small' | 'loading' | 'ready' } | { readonly status: 'failed'; readonly notice: AdminNoticeInputPort };

export interface ImageryViewState {
    readonly tab: ImageryTabPort;
    readonly usgs: ServiceState | null;
    readonly settings: {
        readonly autoPublish: boolean;
        readonly rmseThresholdM: number;
        readonly targetYears: readonly number[];
        /** M12: on, this city keeps Mapbox's publishing path; off (the default), its own public bucket. */
        readonly publishThroughMapbox: boolean;
    };
    readonly search: SearchStatePort;
    readonly filters: SceneFiltersPort;
    readonly scenes: ListStatePort<SceneItemPort>;
    readonly visible: readonly SceneItemPort[];
    readonly browse: Readonly<Record<string, BrowseImagePort>>;
    readonly versions: ListStatePort<VersionItemPort>;
    readonly jobs: Readonly<Record<string, JobProgressPort>>;
    readonly detail: { readonly kind: 'scene' | 'version'; readonly id: string } | null;
    readonly version: VersionPagePort | null;
    readonly importing: string | null;
    readonly importRefusal: { readonly id: string; readonly notice: AdminNoticeInputPort } | null;
    readonly upload: UploadStatePort;
    readonly map: MapStatusPort;
    readonly previewOpacity: number;
    /** `#/imagery/replace/<layerId>`: the upload replaces that layer's image. */
    readonly replaceLayer: string | null;
    /** The budget guard (null while reading; CR-M3-47). */
    readonly guard: GuardPort | null;
    readonly resuming: boolean;
    /** M4: the scenes that have an order, whatever the filters (Work's orders; a routed scene Free only hides). */
    readonly orders: ListStatePort<SceneItemPort>;
    /** The routed scene read by its id (a scene the filters hide, or past the list's page): loading, then it, null or why not. */
    readonly named: { readonly loading: boolean; readonly scene: SceneItemPort | null; readonly failure: StoreFailurePort | null };
    /** M4: the order card's action running, for which scene, and the last refusal on its card. */
    readonly ordering: { readonly id: string; readonly action: 'mark' | 'check' | 'cancel' } | null;
    readonly orderRefusal: { readonly id: string; readonly notice: AdminNoticeInputPort } | null;
    /** M8: the server's plan of each date's whole-city layer, the join on its way (by its first frame), its refusal, the year being saved. */
    readonly dates: readonly DatePlanRow[];
    readonly joining: string | null;
    readonly joinRefusal: { readonly id: string; readonly notice: AdminNoticeInputPort } | null;
    readonly addingYear: number | null;
    /** M12: how far the open version's picture has come, and Work's small pictures by version id. */
    readonly image: VersionImagePort;
    readonly thumbs: Readonly<Record<string, string>>;
}

/** A chosen file (a `File`). */
export interface ChosenFilePort {
    readonly name: string;
    readonly size: number;
    slice(start: number, end: number): Blob;
}

export interface ImageryIntentsPort {
    setTab(tab: ImageryTabPort): void;
    setFilters(patch: Partial<SceneFiltersPort>): void;
    search(): Promise<void>;
    more(): void;
    retry(): void;
    importScene(id: string): Promise<string | null>;
    retryBrowse(id: string): void;
    /** M16: `acceptWorse`: the owner chose a recalibration not shown better. */
    approve(acceptWorse?: boolean): Promise<boolean>;
    reject(): Promise<boolean>;
    /** M16: Refine automatically (the new version's id, or null when refused), and the map between the new version and the current one. */
    recalibrate(): Promise<string | null>;
    toggleCurrent(): void;
    choose(choice: PublishChoice): Promise<boolean>;
    studioDone(): Promise<boolean>;
    download(): Promise<boolean>;
    retryJob(): Promise<boolean>;
    locateAgain(): Promise<boolean>;
    cancelJob(): Promise<boolean>;
    resumeGuard(): Promise<boolean>;
    chooseFile(file: ChosenFilePort): Promise<void>;
    setYear(text: string): void;
    startUpload(): void;
    cancelUpload(): void;
    resetUpload(): void;
    setPreviewOpacity(percent: number): void;
    /** M12: the open version at one tile pixel on one screen pixel; its tiles asked for again. */
    actualPixels(): void;
    retryImage(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** M4: "I ordered it", "Check now", "Take the mark back". */
    markOrdered(id: string): Promise<boolean>;
    checkOrder(id: string): Promise<boolean>;
    cancelOrder(id: string): Promise<boolean>;
    /** M8: Join frames (the new join's version id, or null when refused) and Add {year} to target years. */
    joinFrames(entityIds: readonly string[]): Promise<string | null>;
    addTargetYear(year: number): Promise<boolean>;
}
