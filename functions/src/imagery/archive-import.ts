import '../global-options.js';

import {
    FIRESTORE_PATHS,
    archiveDocSchema,
    timestampFromDate,
    yearSchema,
    type ArchiveDoc,
    type ArchiveSeries,
    type ArchiveSeriesParams,
    type CallableRequest,
    type CallableResponse,
    type Rights,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { dailyRoom, refuseWhileGuardRed } from './limits.js';
import { requireCity, stampOf } from './records.js';
import { createWork, jobIdFor, reserveLayerIds, type NewWork } from './versions.js';

/**
 * `imagery.archiveImport` (a city editor; `docs/research/M20-import-local.md` §1.3, §8; S-A120-*): one click imports the series the
 * owner kept of a scanned archive. Each becomes one `archive-series` job and its version, under a layer id reserved from its title,
 * pinned to the owner's computer (`runOn: 'local'`, `localOnly`), in the archive's order (the reference ladder). Today's share of
 * new layers (`dailyRoom`) lets the first ones start; the rest are born waiting (`daily`) and `imagery.tick` releases them on the
 * following days: the import is never refused for the cap, only paused by the budget guard. Everything, the archive's record of
 * its jobs included, is written in one transaction, so a second click finds the series imported (`apiError.imagery.archiveImported`).
 */
export type ArchiveImportDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'imagery.archiveImport'>;
type Choice = Request['series'][number];

/** A series the owner kept, as the report found it and as they edited it. */
interface Kept {
    readonly series: ArchiveSeries;
    readonly title: string;
    readonly year: number;
    readonly rights: Rights;
}

/** A skipped series may be imported only when it was skipped as too small (the owner insists: it is imported at the zoom it supports). */
function importable(series: ArchiveSeries): boolean {
    return series.action === 'import' || series.reason === 'too-small';
}

/** The report's series, or `apiError.invalidRequest` when it has none of that id or proposed to skip it. */
function seriesOf(archive: ArchiveDoc, seriesId: string): ArchiveSeries {
    const series = archive.series.find((each) => each.seriesId === seriesId);
    if (series === undefined || !importable(series)) {
        throw new ApiError('apiError.invalidRequest');
    }
    return series;
}

/**
 * The layer's year, or `apiError.invalidRequest` for one a layer cannot show yet (before 1800: the report knows 1770, a layer's
 * year does not; the owner types a year, or the series waits until layers go further back).
 */
function yearOf(choice: Choice, series: ArchiveSeries): number {
    const year = choice.year ?? series.year;
    if (!yearSchema.safeParse(year).success) {
        throw new ApiError('apiError.invalidRequest');
    }
    return year;
}

/** The owner's word on a series' rights is stamped by the server's clock (`rights.confirmedAt`, §8.6), never the browser's. */
function stampedRights(rights: Rights, choice: Choice, now: Date): Rights {
    return choice.rights?.confirmedBy === undefined ? rights : { ...rights, confirmedAt: timestampFromDate(now) };
}

/** The series as kept: the report's, with the owner's edits. */
function keptOf(archive: ArchiveDoc, choice: Choice, now: Date): Kept {
    const series = seriesOf(archive, choice.seriesId);
    const rights = stampedRights(choice.rights ?? series.rights, choice, now);
    return { series, title: choice.title ?? series.title, year: yearOf(choice, series), rights };
}

/** The kept series in the archive's order (the reference ladder, then the report's own order). */
function keptInOrder(archive: ArchiveDoc, request: Request, now: Date): Kept[] {
    const kept = request.series.filter((choice) => choice.include).map((choice) => keptOf(archive, choice, now));
    if (kept.length === 0) {
        throw new ApiError('apiError.invalidRequest');
    }
    return kept.sort((a, b) => a.series.order - b.series.order);
}

/** The archive, unimported, or `apiError.notFound` / `apiError.imagery.archiveImported`. */
async function requireFresh(reader: Pick<Ports['documents'], 'get'>, cityId: string, archiveId: string): Promise<ArchiveDoc> {
    const archive = await reader.get(FIRESTORE_PATHS.archive(cityId, archiveId), archiveDocSchema);
    if (archive === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (archive.jobs !== undefined) {
        throw new ApiError('apiError.imagery.archiveImported');
    }
    return archive;
}

function paramsOf(archiveId: string, series: ArchiveSeries): ArchiveSeriesParams {
    return {
        archiveId,
        seriesId: series.seriesId,
        class: series.class,
        sheets: series.files,
        encoding: series.encoding,
        order: series.order,
        maxzoom: series.estimate.maxzoom,
        referenceLayerIds: [],
        ...(series.edition === undefined ? {} : { edition: series.edition }),
        ...(series.scaleDenominator === undefined ? {} : { scaleDenominator: series.scaleDenominator }),
    };
}

/** What one series' job is: where it runs, and whether it starts today (it counts now) or waits for a later day's share. */
interface Planned {
    readonly kept: Kept;
    readonly work: NewWork;
    readonly waiting: boolean;
}

function planOf(request: Request, kept: readonly Kept[], room: number, start: { readonly uid: string; readonly now: Date }) {
    return (layerIdFor: (label: string) => string): Planned[] =>
        kept.map((each, index) => {
            const waiting = index >= room;
            const work: NewWork = {
                cityId: request.cityId,
                jobId: jobIdFor('ar', start.now, each.series.seriesId),
                type: 'archive-series',
                params: paramsOf(request.archiveId, each.series),
                layerId: layerIdFor(each.title),
                createdBy: start.uid,
                now: start.now,
                runOn: 'local',
                localOnly: true,
                ...(waiting
                    ? { waitReason: 'daily' as const }
                    : { waitReason: 'worker' as const, countedAt: timestampFromDate(start.now) }),
            };
            return { kept: each, work, waiting };
        });
}

async function writeAll(
    transaction: DocumentTransaction,
    request: Request,
    planned: readonly Planned[],
    start: { uid: string; now: Date },
) {
    const archive = await requireFresh(transaction, request.cityId, request.archiveId);
    for (const { kept, work } of planned) {
        await createWork(transaction, work, {
            origin: 'archive',
            source: { kind: 'archive', archiveId: request.archiveId, seriesId: kept.series.seriesId, sheetCount: kept.series.files },
            label: { ro: kept.title },
            year: kept.year,
            rights: kept.rights,
        });
    }
    const jobs = Object.fromEntries(planned.map(({ kept, work }) => [kept.series.seriesId, work.jobId]));
    await transaction.set(FIRESTORE_PATHS.archive(request.cityId, request.archiveId), archiveDocSchema, {
        ...archive,
        jobs,
        importedBy: start.uid,
        importedAt: timestampFromDate(start.now),
        ...stampOf(start.uid, start.now),
    });
}

async function archiveImport(
    deps: ArchiveImportDeps,
    caller: VerifiedCaller,
    request: Request,
): Promise<CallableResponse<'imagery.archiveImport'>> {
    await requireCity(deps.documents, request.cityId);
    const start = { uid: caller.uid, now: deps.clock.now() };
    const kept = keptInOrder(await requireFresh(deps.documents, request.cityId, request.archiveId), request, start.now);
    await refuseWhileGuardRed(deps.documents);
    const room = await dailyRoom(deps.documents, start.now, request.cityId);
    const planned = planOf(request, kept, room, start)(await reserveLayerIds(deps.documents, request.cityId));
    await deps.documents.transaction((transaction) => writeAll(transaction, request, planned, start));
    const waiting = planned.filter((each) => each.waiting).length;
    deps.log.info('archive imported', {
        uid: caller.uid,
        cityId: request.cityId,
        archiveId: request.archiveId,
        today: planned.length - waiting,
        waiting,
    });
    return {
        jobs: planned.map(({ kept: each, work, waiting: later }) => ({
            seriesId: each.series.seriesId,
            jobId: work.jobId,
            layerId: work.layerId,
            waiting: later,
        })),
        today: planned.length - waiting,
        waiting,
    };
}

/** The `imagery-archiveImport` callable. */
export function archiveImportFunction(getDeps: () => ArchiveImportDeps & CallableDeps) {
    return defineCallable('imagery.archiveImport', archiveImport, getDeps);
}
