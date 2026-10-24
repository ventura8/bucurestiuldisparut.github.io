/**
 * The publisher's last step (`docs/research/M3-interfaces.md` §2.2, §7.2 step 4, §7.3 `finalize`, §7.5): in one
 * transaction the layer is created (its first version) or pointed at the new tiles (a later one: its presentation is
 * kept), the previous version is superseded, this one is published, the job succeeds, and the month's counters move:
 * the compute units counted and the reservation released for MTS, one more Studio upload for the free path. The
 * manifest is rebuilt by `publish.onLayerWrite`.
 */
import {
    FIRESTORE_PATHS,
    MAPBOX_FREE_COMPUTE_UNITS,
    SENSOR_SPECS,
    USGS_ATTRIBUTION,
    enabledGcps,
    jobDocSchema,
    layerDocSchema,
    layerVersionDocSchema,
    timestampToDate,
    usageDocSchema,
    usageMonth,
    type Georef,
    type JobDoc,
    type LayerDoc,
    type LayerVersionDoc,
    type MtsPrecision,
    type Schema,
    type UsageDoc,
} from '@hcm/shared';

import { compact, omit } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { IMAGERY_WRITER, stampOf, withStep, type Stamp } from './records.js';

export type FinalizeDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

export interface Finish {
    readonly cityId: string;
    readonly jobId: string;
    readonly versionId: string;
    readonly origin: 'mts' | 'studio';
    readonly tilesetId: string;
    readonly sourceId?: string;
    /** km² processed per precision, as the MTS job reported it (the estimate's calibration). */
    readonly precisions?: Readonly<Record<MtsPrecision, number>>;
}

type Output = NonNullable<LayerVersionDoc['output']>;
type Provenance = NonNullable<LayerDoc['provenance']>;

/** A file name or label that says it shows a plan or a map (else an aerial photograph). */
const MAP_WORDS = /\b(?:plan|planul|harta|hart[aă]|map)\b/i;

type Apply = (transaction: DocumentTransaction) => Promise<void>;

function setting<T>(path: string, schema: Schema<T>, data: T): Apply {
    return (transaction) => transaction.set(path, schema, data);
}

/** An upload's own file name, else the version's label. */
function nameOf(version: LayerVersionDoc): string {
    return version.source?.kind === 'upload' ? (version.source.originalName ?? version.label.ro) : version.label.ro;
}

function kindOf(version: LayerVersionDoc): LayerDoc['kind'] {
    if (version.source?.kind === 'usgs' || version.sensor !== undefined) {
        return 'satellite';
    }
    return MAP_WORDS.test(nameOf(version)) ? 'map' : 'aerial';
}

/** USGS's courtesy credit, or an upload's own name until the admin writes one. */
function attributionOf(version: LayerVersionDoc): string {
    return version.source?.kind === 'upload' ? nameOf(version).slice(0, 500) : USGS_ATTRIBUTION;
}

function georefProvenance(georef: Georef): NonNullable<Provenance['georef']> {
    return compact<NonNullable<Provenance['georef']>>({
        method: georef.method,
        gcpCount: georef.method === 'embedded' ? undefined : enabledGcps(georef.gcps),
        checkpointRmseM: georef.checkpointRmseM,
    });
}

function usgsProvenance(version: LayerVersionDoc): Pick<Provenance, 'usgsEntityId' | 'usgsDataset'> {
    return version.source?.kind === 'usgs' ? { usgsEntityId: version.source.entityId, usgsDataset: version.source.dataset } : {};
}

/** Where the tiles came from, kept on the layer: the USGS frame (the layer's own when the version has no source). */
function provenanceOf(version: LayerVersionDoc, before: LayerDoc | undefined): Provenance {
    const kept = omit(before?.provenance ?? {}, ['georef']);
    const georef = version.georef === undefined ? {} : { georef: georefProvenance(version.georef) };
    return { ...kept, ...usgsProvenance(version), ...georef };
}

function mapboxOf(finish: Finish, output: Output): NonNullable<LayerDoc['mapbox']> {
    return compact<NonNullable<LayerDoc['mapbox']>>({
        tilesetId: finish.tilesetId,
        sourceId: finish.sourceId,
        publishedSourceSha: finish.origin === 'mts' ? output.cogSha256 : undefined,
        origin: finish.origin,
    });
}

interface Held {
    readonly job: JobDoc;
    readonly version: LayerVersionDoc & { readonly output: Output };
    readonly layer: LayerDoc | undefined;
    readonly previous: LayerVersionDoc | undefined;
    readonly usage: UsageDoc | undefined;
    readonly usageMonth: string;
}

/** A new layer from its first published version: on top of the others, on the public map (auto-publish means it). */
function newLayer(version: LayerVersionDoc, order: number, stamp: Stamp): Omit<LayerDoc, 'source' | 'minzoom' | 'maxzoom' | 'status'> {
    return compact<Omit<LayerDoc, 'source' | 'minzoom' | 'maxzoom' | 'status'>>({
        year: version.year,
        date: version.date,
        label: version.label,
        description: undefined,
        kind: kindOf(version),
        sensor: version.sensor === undefined ? undefined : SENSOR_SPECS[version.sensor].name,
        attribution: attributionOf(version),
        bounds: undefined,
        order,
        opacity: 1,
        defaultVisible: false,
        adjustments: undefined,
        published: true,
        provenance: undefined,
        mapbox: undefined,
        currentVersion: undefined,
        pendingVersion: undefined,
        createdAt: stamp.updatedAt,
        ...stamp,
    });
}

/** The layer as the new tiles leave it: a new one from the version, or the existing one with its presentation kept. */
function layerAfter(held: Held, finish: Finish, order: number, stamp: Stamp): LayerDoc {
    const { version, layer } = held;
    const tiles = {
        source: { type: 'mapbox' as const, tilesetId: finish.tilesetId },
        minzoom: version.output.minzoom,
        maxzoom: version.output.maxzoom,
        bounds: version.output.bounds,
        provenance: provenanceOf(version, layer),
        mapbox: mapboxOf(finish, version.output),
        currentVersion: finish.versionId,
        status: 'ready' as const,
        ...stamp,
    };
    const base = layer === undefined ? newLayer(version, order, stamp) : omit(layer, ['pendingVersion']);
    return { ...base, ...tiles };
}

function publishedVersion(held: Held, finish: Finish, stamp: Stamp): LayerVersionDoc {
    const mapbox = compact<NonNullable<LayerVersionDoc['mapbox']>>({
        tilesetId: finish.tilesetId,
        sourceId: finish.sourceId,
        jobId: held.job.mapboxJobId,
        origin: finish.origin,
        precisions: finish.precisions,
        publishedAt: stamp.updatedAt,
    });
    return { ...held.version, state: 'published', mapbox, ...stamp };
}

/** The MTS tiles the publisher was waiting for are there once the job is finalized (the Studio path has no such step). */
function tilesDone(job: JobDoc, stamp: Stamp): JobDoc {
    return job.steps?.['tiles']?.status === 'running' ? withStep(job, 'tiles', 'done', stamp.updatedAt) : job;
}

function succeededJob(held: Held, stamp: Stamp): JobDoc {
    const job = withStep(tilesDone(held.job, stamp), 'finalize', 'done', stamp.updatedAt);
    return { ...omit(job, ['waitReason', 'error', 'lease']), status: 'succeeded', finishedAt: stamp.updatedAt, progress: 1, ...stamp };
}

function studioUsage(usage: UsageDoc, stamp: Stamp): UsageDoc {
    return { ...usage, studioUploads: (usage.studioUploads ?? 0) + 1, ...stamp };
}

/** MTS counts the estimate (the measured units once the calibration is verified), one publish and the bytes uploaded. */
function mtsUsage(usage: UsageDoc, held: Held, finish: Finish, stamp: Stamp): UsageDoc {
    const reservations = Object.fromEntries(Object.entries(usage.reservations ?? {}).filter(([id]) => id !== finish.versionId));
    const units = held.version.estimate?.computeUnits ?? 0;
    const counted = {
        computeUnits: usage.computeUnits + units,
        publishes: usage.publishes + 1,
        uploadedMb: usage.uploadedMb + held.version.output.cogBytes / 1e6,
    };
    return { ...usage, ...counted, reservations, ...stamp };
}

function usageAfter(held: Held, finish: Finish, stamp: Stamp): UsageDoc {
    const usage = held.usage ?? {
        month: held.usageMonth,
        computeUnits: 0,
        computeUnitBudget: MAPBOX_FREE_COMPUTE_UNITS,
        uploadedMb: 0,
        publishes: 0,
        ...stamp,
    };
    return finish.origin === 'studio' ? studioUsage(usage, stamp) : mtsUsage(usage, held, finish, stamp);
}

/** The month whose counter the publish is booked in: where its reservation was taken (the guard), else now. */
function bookedMonth(version: LayerVersionDoc, now: Date): string {
    const checkedAt = version.guard?.checkedAt;
    return usageMonth(checkedAt === undefined ? now : timestampToDate(checkedAt));
}

function hasOutput(version: LayerVersionDoc | undefined): version is Held['version'] {
    return version?.output !== undefined;
}

/** Every document the step touches, read first; undefined when the job or its rendered version is gone. */
async function readHeld(transaction: DocumentTransaction, finish: Finish, now: Date): Promise<Held | undefined> {
    const job = await transaction.get(FIRESTORE_PATHS.job(finish.cityId, finish.jobId), jobDocSchema);
    const version = await transaction.get(FIRESTORE_PATHS.layerVersion(finish.cityId, finish.versionId), layerVersionDocSchema);
    if (job === undefined || !hasOutput(version)) {
        return undefined;
    }
    const layer = await transaction.get(FIRESTORE_PATHS.layer(finish.cityId, version.layerId), layerDocSchema);
    const previousId = layer?.currentVersion;
    const previous =
        previousId === undefined
            ? undefined
            : await transaction.get(FIRESTORE_PATHS.layerVersion(finish.cityId, previousId), layerVersionDocSchema);
    const month = bookedMonth(version, now);
    const usage = await transaction.get(FIRESTORE_PATHS.usage(month), usageDocSchema);
    return { job, version, layer, previous, usage, usageMonth: month };
}

/** The previous published version of the layer becomes `superseded`. */
function supersede(held: Held, finish: Finish, stamp: Stamp): Apply | undefined {
    const previous = held.previous;
    if (previous?.state !== 'published' || previous.jobId === finish.versionId) {
        return undefined;
    }
    return setting(FIRESTORE_PATHS.layerVersion(finish.cityId, previous.jobId), layerVersionDocSchema, {
        ...previous,
        state: 'superseded',
        ...stamp,
    });
}

/** The top of the layer stack (a new layer goes there). */
async function topOrder(deps: FinalizeDeps, cityId: string): Promise<number> {
    const layers = await deps.documents.query(FIRESTORE_PATHS.layers(cityId), layerDocSchema);
    return layers.documents.reduce((top, layer) => Math.max(top, layer.data.order + 1), 0);
}

/** Publishes the version (see the module comment); false when the job or its rendered version is gone. */
export async function finalizeVersion(deps: FinalizeDeps, finish: Finish): Promise<boolean> {
    const order = await topOrder(deps, finish.cityId);
    const now = deps.clock.now();
    const stamp = stampOf(IMAGERY_WRITER, now);
    const done = await deps.documents.transaction(async (transaction) => {
        const held = await readHeld(transaction, finish, now);
        if (held === undefined) {
            return false;
        }
        const writes = [
            setting(FIRESTORE_PATHS.layer(finish.cityId, held.version.layerId), layerDocSchema, layerAfter(held, finish, order, stamp)),
            supersede(held, finish, stamp),
            setting(
                FIRESTORE_PATHS.layerVersion(finish.cityId, finish.versionId),
                layerVersionDocSchema,
                publishedVersion(held, finish, stamp),
            ),
            setting(FIRESTORE_PATHS.job(finish.cityId, finish.jobId), jobDocSchema, succeededJob(held, stamp)),
            setting(FIRESTORE_PATHS.usage(held.usageMonth), usageDocSchema, usageAfter(held, finish, stamp)),
        ];
        for (const write of writes) {
            await write?.(transaction);
        }
        return true;
    });
    deps.log.info('layer version published', { cityId: finish.cityId, jobId: finish.jobId, origin: finish.origin, done });
    return done;
}
