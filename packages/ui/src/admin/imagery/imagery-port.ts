/**
 * What `<hcm-imagery-page>` reads of the Imagery area (`packages/admin/src/imagery/imagery.ts`,
 * `docs/research/M3-interfaces.md` §10.2), mirrored structurally because `@hcm/ui` sits below `@hcm/admin`;
 * `packages/admin/test/app/admin-port.test.ts` checks that the real store satisfies it.
 */
import type {
    ApiErrorCode,
    BBox,
    GeorefTransform,
    JobStatus,
    JobType,
    JobWaitReason,
    LayerVersionState,
    LngLat,
    OrderState,
    PublishChoice,
    RankReasonEntry,
    SceneAcquisitionState,
    Sensor,
    ServiceState,
    UsgsDataset,
} from '@hcm/shared';

import type { DocStatePort, ListStatePort } from '../area-port.js';
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
    | { readonly status: 'ready'; readonly url: string }
    | { readonly status: 'failed'; readonly error: AdminNoticeInputPort };

export interface VersionItemPort {
    readonly id: string;
    readonly layerId: string;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly year: number;
    readonly origin: 'usgs' | 'upload' | 'regeoref' | 'crop';
    readonly state: LayerVersionState;
    readonly updatedAt: string;
    readonly needsYou: boolean;
    readonly checkpointRmseM: number | null;
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
    readonly origin: 'usgs' | 'upload' | 'regeoref' | 'crop';
    readonly state: LayerVersionState;
    readonly georef: {
        readonly method: string;
        readonly transform: GeorefTransform;
        readonly pairs: number;
        readonly fitRmseM: number | null;
        readonly checkpointRmseM: number | null;
        readonly checkpointCount: number | null;
    } | null;
    readonly output: {
        readonly bounds: BBox;
        readonly minzoom: number;
        readonly maxzoom: number;
        readonly areaKm2: number;
        readonly previewPath: string;
        readonly studioPath: string | null;
        /** The file for Mapbox, in bytes (a refusal as too large names its size). */
        readonly cogBytes: number;
    } | null;
    readonly estimate: number | null;
    readonly guard: {
        readonly verdict: 'within' | 'over' | 'tileset-limit' | 'too-large';
        readonly available: number;
        readonly overageUsd: number | null;
        readonly choice: PublishChoice | null;
        readonly deferUntil: string | null;
    } | null;
    readonly approval: { readonly auto: boolean; readonly by: string; readonly at: string } | null;
    readonly error: AdminNoticeInputPort | null;
    readonly hasScan: boolean;
}

export interface JobViewPort {
    readonly id: string;
    readonly type: JobType;
    readonly status: JobStatus;
    readonly finished: boolean;
    readonly progress: number | null;
    readonly step: string | null;
    readonly steps: readonly { readonly name: string; readonly status: 'pending' | 'running' | 'done' | 'failed' | 'skipped' }[];
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

type VersionActionPort = 'approve' | 'reject' | 'choose' | 'studioDone' | 'download' | 'retry' | 'cancel';

export interface VersionPagePort {
    readonly id: string;
    readonly version: DocStatePort<VersionViewPort>;
    readonly job: DocStatePort<JobViewPort>;
    readonly logs: ListStatePort<JobLogLinePort>;
    readonly usage: UsagePort | null;
    readonly acting: VersionActionPort | null;
    readonly refusal: AdminNoticeInputPort | null;
    readonly downloaded: boolean;
}

export interface ImageryViewState {
    readonly tab: ImageryTabPort;
    readonly usgs: ServiceState | null;
    readonly settings: { readonly autoPublish: boolean; readonly rmseThresholdM: number; readonly targetYears: readonly number[] };
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
    readonly pickedScene: { readonly id: string; readonly seq: number } | null;
    /** `#/imagery/replace/<layerId>`: the upload replaces that layer's image. */
    readonly replaceLayer: string | null;
    /** The budget guard (null while reading; CR-M3-47). */
    readonly guard: GuardPort | null;
    readonly resuming: boolean;
    /** M4: the scenes that have an order, whatever the filters (Work's orders; a routed scene Free only hides). */
    readonly orders: ListStatePort<SceneItemPort>;
    /** M4: the order card's action running, for which scene, and the last refusal on its card. */
    readonly ordering: { readonly id: string; readonly action: 'mark' | 'check' | 'cancel' } | null;
    readonly orderRefusal: { readonly id: string; readonly notice: AdminNoticeInputPort } | null;
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
    approve(): Promise<boolean>;
    reject(): Promise<boolean>;
    choose(choice: PublishChoice): Promise<boolean>;
    studioDone(): Promise<boolean>;
    download(): Promise<boolean>;
    retryJob(): Promise<boolean>;
    cancelJob(): Promise<boolean>;
    resumeGuard(): Promise<boolean>;
    chooseFile(file: ChosenFilePort): Promise<void>;
    setYear(text: string): void;
    startUpload(): void;
    cancelUpload(): void;
    resetUpload(): void;
    setPreviewOpacity(percent: number): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    /** M4: "I ordered it", "Check now", "Take the mark back". */
    markOrdered(id: string): Promise<boolean>;
    checkOrder(id: string): Promise<boolean>;
    cancelOrder(id: string): Promise<boolean>;
}
