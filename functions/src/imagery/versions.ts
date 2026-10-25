/**
 * Layer versions and the jobs that make them (`docs/research/M3-interfaces.md` §2.2, §4.1): their ids, the layer id a
 * new layer reserves, the years the city already shows (the ranking's new-year part), and the documents a creator
 * writes in one transaction. A version's id is its job's id.
 */
import {
    ENDED_VERSION_STATES,
    FIRESTORE_PATHS,
    freeOverlayId,
    jobDocSchema,
    layerDeleteParamsSchema,
    layerDocSchema,
    layerVersionDocSchema,
    poiCategoryDocSchema,
    timestampFromDate,
    validate,
    type JobDoc,
    type JobType,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import { compact } from '../api/objects.js';
import type { DocumentStore, DocumentTransaction } from '../ports/documents.js';
import { stampOf } from './records.js';

const ENDED: ReadonlySet<LayerVersionState> = new Set(ENDED_VERSION_STATES);

/** `<prefix>-<time in base 36>-<tail>`, at most 40 characters (`ID_PATTERN`): one job per subject and millisecond. */
export function jobIdFor(prefix: string, now: Date, tail: string): string {
    const head = `${prefix}-${now.getTime().toString(36)}-`;
    return `${head}${tail.replaceAll(/[^A-Za-z0-9_-]/g, '-').slice(0, 40 - head.length)}`;
}

/** The versions not yet ended (they hold their layer id, reserved or existing). */
async function unfinishedVersions(documents: DocumentStore, cityId: string): Promise<LayerVersionDoc[]> {
    const versions = await documents.query(FIRESTORE_PATHS.layerVersions(cityId), layerVersionDocSchema);
    return versions.documents.map((version) => version.data).filter((version) => !ENDED.has(version.state));
}

/**
 * The layer ids of deleted layers whose `layer-delete` job still waits out its grace (CR-M3-47): the job deletes that
 * id's tileset and files when it runs, so a new layer must not take the id meanwhile.
 */
async function deletionsPending(documents: DocumentStore, cityId: string): Promise<string[]> {
    const jobs = await documents.query(FIRESTORE_PATHS.jobs(cityId), jobDocSchema, { where: [['type', '==', 'layer-delete']] });
    return jobs.documents.flatMap((job) => {
        const params = validate(layerDeleteParamsSchema, job.data.params);
        return job.data.status === 'queued' && params.ok ? [params.value.layerId] : [];
    });
}

/**
 * A free layer id for a new layer labelled `label`: clear of the layers', the categories', `photos`, every unfinished
 * version's layer id (the overlay namespace of the manifest) and every layer id a queued deletion will clean up.
 */
export async function reserveLayerId(documents: DocumentStore, cityId: string, label: string): Promise<string> {
    const [layers, categories, versions, deletions] = await Promise.all([
        documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema),
        documents.query(FIRESTORE_PATHS.poiCategories(cityId), poiCategoryDocSchema),
        unfinishedVersions(documents, cityId),
        deletionsPending(documents, cityId),
    ]);
    const taken = new Set([
        ...[...layers.documents, ...layers.invalid, ...categories.documents, ...categories.invalid].map((document) => document.id),
        ...versions.map((version) => version.layerId),
        ...deletions,
    ]);
    return freeOverlayId(label, taken, 'layer');
}

/** The years the city's layers and unfinished versions show, leaving out layer `except` (a scene's own import). */
export async function shownYears(documents: DocumentStore, cityId: string, except?: string): Promise<{ layerId: string; year: number }[]> {
    const [layers, versions] = await Promise.all([
        documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema),
        unfinishedVersions(documents, cityId),
    ]);
    return [
        ...layers.documents.map((layer) => ({ layerId: layer.id, year: layer.data.year })),
        ...versions.map((version) => ({ layerId: version.layerId, year: version.year })),
    ].filter((shown) => shown.layerId !== except);
}

/** What a new job and its version have in common. */
export interface NewWork {
    readonly cityId: string;
    readonly jobId: string;
    readonly type: JobType;
    readonly params: Readonly<Record<string, unknown>>;
    readonly layerId: string;
    readonly createdBy: string;
    readonly now: Date;
}

/** A `queued` job of `work`, stamped by its creator. */
function queuedJob(work: NewWork): JobDoc {
    return {
        type: work.type,
        status: 'queued',
        params: { ...work.params },
        createdBy: work.createdBy,
        createdAt: timestampFromDate(work.now),
        layerId: work.layerId,
        versionId: work.jobId,
        ...stampOf(work.createdBy, work.now),
    };
}

type VersionFields = Omit<LayerVersionDoc, 'layerId' | 'jobId' | 'state' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>;

/** A `processing` version of `work` (its id and its job's are the same). */
function processingVersion(work: NewWork, fields: VersionFields): LayerVersionDoc {
    return compact<LayerVersionDoc>({
        layerId: work.layerId,
        jobId: work.jobId,
        state: 'processing',
        createdBy: work.createdBy,
        createdAt: timestampFromDate(work.now),
        ...stampOf(work.createdBy, work.now),
        origin: fields.origin,
        basedOn: fields.basedOn,
        source: fields.source,
        label: fields.label,
        year: fields.year,
        date: fields.date,
        sensor: fields.sensor,
        scan: fields.scan,
        reference: fields.reference,
        georef: fields.georef,
        suggestions: undefined,
        crop: fields.crop,
        output: undefined,
        estimate: undefined,
        guard: undefined,
        approval: undefined,
        mapbox: undefined,
        error: undefined,
    });
}

/** Creates the job and its version in `transaction` (a second creation of either is a conflict). */
export async function createWork(transaction: DocumentTransaction, work: NewWork, fields: VersionFields): Promise<void> {
    await transaction.create(FIRESTORE_PATHS.job(work.cityId, work.jobId), jobDocSchema, queuedJob(work));
    await transaction.create(FIRESTORE_PATHS.layerVersion(work.cityId, work.jobId), layerVersionDocSchema, processingVersion(work, fields));
}
