/**
 * The allow-lists of a worker's job (`docs/research/M7-local-worker.md` §2.5): which documents `worker.step` may read and
 * write, which fields and states its writes may set, and which objects `worker.urls` may sign. Everything is bound to the
 * one job the worker claimed: its city, its version, its layer and its parameters.
 */
import { FIRESTORE_PATHS, RASTER_PATHS, VERSION_FILES, isId, type JobDoc, type JobStatus, type LayerVersionState } from '@hcm/shared';

/**
 * The job fields a run writes (`pipeline/src/hcm_pipeline/{runner,lease,jobs}.py`: the lease and its heartbeat, the step
 * records, the progress, the waits and the endings; `pipeline/tests/contracts/job.*.json`).
 */
export const WORKER_JOB_FIELDS: ReadonlySet<string> = new Set([
    'status',
    'waitReason',
    'retryAt',
    'lease',
    'startedAt',
    'finishedAt',
    'error',
    'step',
    'steps',
    'progress',
    'updatedAt',
    'updatedBy',
]);

/**
 * The layer version fields a run writes (`pipeline/src/hcm_pipeline/{documents,runner}.py` and `steps/*.py`: the scan,
 * the reference, the georeference, the suggestions, the output, the machines and the state with its error;
 * `pipeline/tests/contracts/version.*.json`).
 */
export const WORKER_VERSION_FIELDS: ReadonlySet<string> = new Set([
    'state',
    'error',
    'scan',
    'reference',
    'georef',
    'suggestions',
    'output',
    'machines',
    'updatedAt',
    'updatedBy',
]);

/** The statuses a run moves its job to (`cancelled` only after the admin asked). */
export const WORKER_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
    'running',
    'queued',
    'waiting_usgs',
    'awaiting_gcps',
    'awaiting_approval',
    'failed',
    'cancelled',
]);

/** The states a run moves its version to. */
export const WORKER_VERSION_STATES: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>([
    'processing',
    'needs_gcps',
    'awaiting_approval',
    'failed',
    'cancelled',
]);

/** What a document path is to the job: one of the documents of §2.5. */
export type DocumentTarget = 'city' | 'job' | 'version' | 'base' | 'layer' | 'scene';

/** The job a worker holds, with the ids its allow-lists name. */
export interface JobScope {
    readonly cityId: string;
    readonly jobId: string;
    readonly job: JobDoc;
    /** The version it makes (`job.versionId`, else the job's own id). */
    readonly versionId: string;
}

/** A parameter of the job that is a document or object id (`params.basedOn`, `params.entityId`), else undefined. */
function idParam(job: JobDoc, name: string): string | undefined {
    const value = job.params[name];
    return isId(value) ? value : undefined;
}

/** A string parameter of the job (`params.uploadPath`), else undefined. */
function textParam(job: JobDoc, name: string): string | undefined {
    const value = job.params[name];
    return typeof value === 'string' ? value : undefined;
}

/** The base version a re-georeference renders again. */
function baseVersionOf(job: JobDoc): string | undefined {
    return job.type === 'regeoref' ? idParam(job, 'basedOn') : undefined;
}

/** The scene a USGS import fetches. */
export function sceneOf(job: JobDoc): string | undefined {
    return job.type === 'usgs-import' ? idParam(job, 'entityId') : undefined;
}

/** The upload a GeoTIFF import reads. */
function uploadOf(job: JobDoc): string | undefined {
    return job.type === 'geotiff-import' ? textParam(job, 'uploadPath') : undefined;
}

/** The documents of §2.5 by path (the base version, the layer and the scene only when the job names them). */
function documentTargets({ cityId, jobId, job, versionId }: JobScope): Map<string, DocumentTarget> {
    const base = baseVersionOf(job);
    const scene = sceneOf(job);
    const layerId = job.layerId;
    const entries: [string | undefined, DocumentTarget][] = [
        [FIRESTORE_PATHS.city(cityId), 'city'],
        [FIRESTORE_PATHS.job(cityId, jobId), 'job'],
        [FIRESTORE_PATHS.layerVersion(cityId, versionId), 'version'],
        [base === undefined ? undefined : FIRESTORE_PATHS.layerVersion(cityId, base), 'base'],
        [layerId === undefined ? undefined : FIRESTORE_PATHS.layer(cityId, layerId), 'layer'],
        [scene === undefined ? undefined : FIRESTORE_PATHS.usgsScene(cityId, scene), 'scene'],
    ];
    return new Map(entries.flatMap(([path, target]) => (path === undefined ? [] : [[path, target] as const])));
}

/** What `path` is to the job, or undefined when it is off the allow-list. */
export function documentTarget(scope: JobScope, path: string): DocumentTarget | undefined {
    return documentTargets(scope).get(path);
}

/** A log line's id: its sequence number zero-padded to six digits (`pipeline/src/hcm_pipeline/documents.py` → `log_id`). */
const LOG_ID = /^\d{6}$/;

/** The sequence number of the job's log line at `path`, or undefined when `path` is not one of its log lines. */
export function logLineOf(scope: JobScope, path: string): number | undefined {
    const prefix = `${FIRESTORE_PATHS.jobLogs(scope.cityId, scope.jobId)}/`;
    const id = path.startsWith(prefix) ? path.slice(prefix.length) : '';
    return LOG_ID.test(id) ? Number(id) : undefined;
}

/** True when `collection` is the job's log. */
export function isJobLog(scope: JobScope, collection: string): boolean {
    return collection === FIRESTORE_PATHS.jobLogs(scope.cityId, scope.jobId);
}

/** The objects of a version's run: the version's folder, its layer, and the inputs its parameters name. */
export interface ObjectScope {
    readonly cityId: string;
    readonly layerId: string;
    readonly versionId: string;
    readonly job: JobDoc;
}

function versionFolder({ cityId, layerId, versionId }: Pick<ObjectScope, 'cityId' | 'layerId' | 'versionId'>): string {
    return `rasters/${cityId}/${layerId}/${versionId}/`;
}

/** One file of the version's folder (`rasters/C/L/V/<file>`). */
function inVersionFolder(scope: ObjectScope, path: string): boolean {
    const folder = versionFolder(scope);
    const name = path.startsWith(folder) ? path.slice(folder.length) : '';
    return name !== '' && !name.includes('/');
}

/** The inputs a run reads beyond its own folder: the base version's scan (`regeoref`), the upload (`geotiff-import`). */
function inputsOf(scope: ObjectScope): string[] {
    const base = baseVersionOf(scope.job);
    const upload = uploadOf(scope.job);
    return [
        ...(base === undefined ? [] : [RASTER_PATHS.version(scope.cityId, scope.layerId, base, 'scan.tif')]),
        ...(upload === undefined ? [] : [upload]),
    ];
}

/** True when the run may read `path`: a file of its version, or one of its inputs. */
export function mayRead(scope: ObjectScope, path: string): boolean {
    return inVersionFolder(scope, path) || inputsOf(scope).includes(path);
}

/** True when the run may write `path`: one of its version's files (`VERSION_FILES`), nothing else. */
export function mayWrite(scope: ObjectScope, path: string): boolean {
    return VERSION_FILES.some((file) => RASTER_PATHS.version(scope.cityId, scope.layerId, scope.versionId, file) === path);
}
