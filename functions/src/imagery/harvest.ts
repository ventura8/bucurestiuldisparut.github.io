/**
 * The USGS harvest (`docs/research/M3-interfaces.md` §3.1–§3.5; S-A11-*): every declassified frame over the city's
 * bounds in `corona2`, `declassii` and `declassiii` (100 a page, at most 500 per dataset), each kept as a
 * `usgsScenes/{entityId}` document with its camera, footprint, coverage, download availability and rank. A dataset that
 * fails is named in `failedDatasets` and the others are harvested; when every dataset fails USGS did not answer, and the
 * search says so (`apiError.usgs.maintenance` when every failure was maintenance, else `apiError.usgs.unavailable`)
 * instead of "nothing found". An existing document keeps the admin's status and note, its layer and its browse copy. The
 * best `BROWSE_PREFETCH` frames get their browse copy at once. Every attempt is recorded (`ops/harvest-{city}`,
 * CR-M3-47): the tick's monthly harvest is keyed on it, and backs off after a failure. M4 (`docs/research/M4-interfaces.md`
 * §1.6): a known scene also keeps its order (the buy flow's record), and every scene records EarthExplorer's id of its
 * dataset (`dataset-search`, once a run), which the order card's deep link needs.
 */
import {
    BROWSE_PREFETCH,
    EE_DATASET_ID_PATTERN,
    FIRESTORE_PATHS,
    USGS_DATASETS,
    imagerySettingsOf,
    rankScene,
    timestampFromDate,
    usgsSceneDocSchema,
    validate,
    type ApiErrorCode,
    type CityDoc,
    type ImagerySearchRequest,
    type ImagerySearchResponse,
    type UsgsDataset,
    type UsgsSceneDoc,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { compact } from '../api/objects.js';
import type { Ports } from '../ports/index.js';
import { copyBrowse } from './browse.js';
import { IMAGERY_WRITER, requireCity, stampOf } from './records.js';
import { browseSourceOf, sceneFields, type SceneFields, type SceneRecord } from './scene-record.js';
import { recordHarvest } from './harvest-state.js';
import { requireUsgs, usgsError, withUsgs } from './usgs-session.js';
import { shownYears } from './versions.js';

export type HarvestDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'secrets' | 'usgs' | 'scenes' | 'setup' | 'remote' | 'blobs'>;

const PAGE_SIZE = 100;
const MAX_SCENES_PER_DATASET = 500;
/** Browse copies made at once by the prefetch. */
const BROWSE_CONCURRENCY = 5;

interface Found {
    readonly dataset: UsgsDataset;
    readonly record: SceneRecord;
}

interface Search {
    readonly request: ImagerySearchRequest;
    readonly bounds: CityDoc['bounds'];
}

/** The acquisition window of the request, as `scene-search` takes it (absent ends are open). */
function windowOf(request: ImagerySearchRequest): { from?: string; to?: string } {
    return compact<{ from?: string; to?: string }>({ from: request.from, to: request.to });
}

/** Every page of one dataset's search over the city's bounds, up to {@link MAX_SCENES_PER_DATASET} records. */
async function searchDataset(deps: HarvestDeps, apiKey: string, dataset: UsgsDataset, search: Search): Promise<Found[]> {
    const records: SceneRecord[] = [];
    const base = { dataset, bounds: search.bounds, maxResults: PAGE_SIZE, ...windowOf(search.request) };
    let startingNumber: number | undefined = 1;
    while (startingNumber !== undefined && records.length < MAX_SCENES_PER_DATASET) {
        const page = await deps.scenes.search(apiKey, { ...base, startingNumber });
        records.push(...page.records);
        startingNumber = page.records.length === 0 ? undefined : page.next;
    }
    return records.slice(0, MAX_SCENES_PER_DATASET).map((record): Found => ({ dataset, record }));
}

/** The codes a search that no dataset answered keeps as they are (each says what to do). */
const NO_ANSWER_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>(['apiError.usgs.maintenance', 'apiError.rateLimited']);

/** The code a whole search fails with when no dataset answered: their shared code, else USGS not answering. */
function noAnswer(failures: readonly Error[]): ApiError {
    const codes = new Set(failures.map((failure) => (failure instanceof ApiError ? failure.code : 'apiError.usgs.unavailable')));
    const [only] = codes;
    return new ApiError(codes.size === 1 && only !== undefined && NO_ANSWER_CODES.has(only) ? only : 'apiError.usgs.unavailable');
}

/**
 * Each requested dataset searched on its own: a failure (maintenance, 5xx) only removes that dataset; when every one
 * failed, USGS did not answer and the search fails.
 */
async function searchAll(deps: HarvestDeps, apiKey: string, search: Search) {
    const request = search.request;
    const datasets = request.datasets ?? USGS_DATASETS;
    const found: Found[] = [];
    const failures: Error[] = [];
    const failedDatasets: UsgsDataset[] = [];
    for (const dataset of datasets) {
        try {
            found.push(...(await searchDataset(deps, apiKey, dataset, search)));
        } catch (error) {
            deps.log.warn('usgs dataset not harvested', { cityId: request.cityId, dataset, error: String(error) });
            failedDatasets.push(dataset);
            failures.push(usgsError(error));
        }
    }
    if (failedDatasets.length === datasets.length) {
        throw noAnswer(failures);
    }
    return { found, failedDatasets };
}

/** The browse record a harvested scene gets: the existing copy when its source did not move, else to be copied. */
function browseFor(existing: UsgsSceneDoc | undefined, sourceUrl: string | undefined, now: Date): UsgsSceneDoc['browse'] {
    if (sourceUrl === undefined) {
        return { state: 'failed', error: 'apiError.imagery.browseUnavailable', checkedAt: timestampFromDate(now) };
    }
    return existing?.browse.sourceUrl === sourceUrl && existing.browse.state === 'copied' ? existing.browse : { state: 'none', sourceUrl };
}

interface RankWorld {
    readonly targetYears: readonly number[];
    readonly shown: readonly { readonly layerId: string; readonly year: number }[];
    readonly bounds: CityDoc['bounds'];
    /** M4: EarthExplorer's id of each dataset by its alias, as this run's `dataset-search` read them (none when it failed). */
    readonly eeIds: ReadonlyMap<string, string>;
}

/** A scene's rank against the city's target years and the years its layers show (its own import left out). */
function rankOf(fields: SceneFields, layerId: string | undefined, world: RankWorld): UsgsSceneDoc['rank'] {
    const layerYears = world.shown.filter((shown) => shown.layerId !== layerId).map((shown) => shown.year);
    return rankScene(fields, { targetYears: world.targetYears, layerYears });
}

interface Harvested {
    readonly fields: SceneFields;
    readonly sourceUrl: string | undefined;
}

type Kept = Pick<UsgsSceneDoc, 'status' | 'createdAt' | 'note' | 'layerId' | 'order' | 'eeDatasetId'>;

/**
 * What a harvest keeps of a scene it knew: the admin's triage and note, the layer of its import, its creation, and (M4)
 * its order, which only the order callables and the watch write, and the EarthExplorer id an earlier run or order read.
 */
function keptOf(existing: UsgsSceneDoc | undefined, at: UsgsSceneDoc['harvestedAt']): Kept {
    if (existing === undefined) {
        return { status: 'candidate', createdAt: at };
    }
    const { status, note, layerId, order, eeDatasetId } = existing;
    return compact<Kept>({ status, note, layerId, order, eeDatasetId, createdAt: existing.createdAt ?? at });
}

/** The scene's EarthExplorer dataset id: this run's for its dataset, else the one it kept. */
function eeDatasetIdOf(dataset: UsgsDataset, kept: Kept, world: RankWorld): Pick<UsgsSceneDoc, 'eeDatasetId'> {
    const eeDatasetId = world.eeIds.get(dataset) ?? kept.eeDatasetId;
    return eeDatasetId === undefined ? {} : { eeDatasetId };
}

function sceneDoc(harvested: Harvested, existing: UsgsSceneDoc | undefined, world: RankWorld, now: Date): UsgsSceneDoc {
    const at = timestampFromDate(now);
    const kept = keptOf(existing, at);
    return {
        ...harvested.fields,
        ...kept,
        ...eeDatasetIdOf(harvested.fields.dataset, kept, world),
        browse: browseFor(existing, harvested.sourceUrl, now),
        rank: rankOf(harvested.fields, kept.layerId, world),
        harvestedAt: at,
        ...stampOf(IMAGERY_WRITER, now),
    };
}

/** The document of one record, or undefined for a record the harvest skips (no valid id, footprint or date). */
function docOf(found: Found, known: ReadonlyMap<string, UsgsSceneDoc>, world: RankWorld, now: Date): UsgsSceneDoc | undefined {
    const fields = sceneFields(found.record, found.dataset, world.bounds);
    if (fields === undefined) {
        return undefined;
    }
    const doc = sceneDoc({ fields, sourceUrl: browseSourceOf(found.record) }, known.get(fields.entityId), world, now);
    return validate(usgsSceneDocSchema, doc).ok ? doc : undefined;
}

/** Writes the harvested scenes; returns how many were new and how many were already known. */
async function storeScenes(deps: HarvestDeps, cityId: string, found: readonly Found[], world: RankWorld) {
    const existing = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema);
    const known = new Map(existing.documents.map((scene) => [scene.id, scene.data]));
    const now = deps.clock.now();
    const written = new Map<string, UsgsSceneDoc>();
    for (const each of found) {
        const doc = docOf(each, known, world, now);
        if (doc === undefined) {
            deps.log.warn('usgs scene skipped', { cityId, dataset: each.dataset, entityId: each.record.entityId });
            continue;
        }
        await deps.documents.set(FIRESTORE_PATHS.usgsScene(cityId, doc.entityId), usgsSceneDocSchema, doc);
        written.set(doc.entityId, doc);
    }
    await rerankUnseen(
        deps,
        cityId,
        [...known].filter(([id]) => !written.has(id)),
        world,
    );
    const added = [...written.keys()].filter((id) => !known.has(id)).length;
    return { written: [...written.values()], added, updated: written.size - added };
}

/**
 * Scenes this harvest did not see keep their record but are ranked again against today's layers and target years (and
 * the current `RANKING_VERSION`), so the list compares like with like; only a changed rank is written.
 */
async function rerankUnseen(deps: HarvestDeps, cityId: string, unseen: readonly (readonly [string, UsgsSceneDoc])[], world: RankWorld) {
    for (const [id, scene] of unseen) {
        const rank = rankOf(scene, scene.layerId, world);
        if (JSON.stringify(rank) !== JSON.stringify(scene.rank)) {
            await deps.documents.set(FIRESTORE_PATHS.usgsScene(cityId, id), usgsSceneDocSchema, {
                ...scene,
                rank,
                ...stampOf(IMAGERY_WRITER, deps.clock.now()),
            });
        }
    }
}

/** The best-ranked frames without a browse copy get one, each on its own (a failure is recorded on the scene). */
async function prefetchBrowse(deps: HarvestDeps, cityId: string, scenes: readonly UsgsSceneDoc[]): Promise<void> {
    const pending = scenes
        .filter((scene) => scene.browse.state === 'none' && scene.browse.sourceUrl !== undefined)
        .sort((left, right) => right.rank.score - left.rank.score)
        .slice(0, BROWSE_PREFETCH);
    for (let start = 0; start < pending.length; start += BROWSE_CONCURRENCY) {
        await Promise.allSettled(pending.slice(start, start + BROWSE_CONCURRENCY).map((scene) => copyBrowse(deps, cityId, scene)));
    }
}

/**
 * M4 (`docs/research/M4-interfaces.md` §1.6): EarthExplorer's id of each declassified dataset (`dataset-search`), kept
 * when it has the id's shape; a failure only leaves them unknown (the card then names the entity id to search for).
 */
async function earthExplorerIds(deps: HarvestDeps, apiKey: string): Promise<ReadonlyMap<string, string>> {
    try {
        const datasets = await deps.scenes.datasets(apiKey);
        return new Map(datasets.filter((each) => EE_DATASET_ID_PATTERN.test(each.datasetId)).map((each) => [each.alias, each.datasetId]));
    } catch (error) {
        deps.log.warn('usgs dataset ids not read', { error: String(error) });
        return new Map();
    }
}

async function harvestIn(deps: HarvestDeps, request: ImagerySearchRequest, city: CityDoc): Promise<ImagerySearchResponse> {
    const searchedAt = deps.clock.now();
    const { found, failedDatasets, eeIds } = await withUsgs(deps, async (apiKey) => ({
        ...(await searchAll(deps, apiKey, { request, bounds: city.bounds })),
        eeIds: await earthExplorerIds(deps, apiKey),
    }));
    const shown = await shownYears(deps.documents, request.cityId);
    const world: RankWorld = { targetYears: imagerySettingsOf(city.imagery).targetYears, shown, bounds: city.bounds, eeIds };
    const stored = await storeScenes(deps, request.cityId, found, world);
    await prefetchBrowse(deps, request.cityId, stored.written);
    deps.log.info('usgs harvest finished', { cityId: request.cityId, found: found.length, added: stored.added, failedDatasets });
    return { found: found.length, added: stored.added, updated: stored.updated, failedDatasets, searchedAt: searchedAt.toISOString() };
}

/** Harvests the city (`imagery.search`, and `imagery.tick` once a month), the attempt recorded whatever happened. */
export async function harvestCity(deps: HarvestDeps, request: ImagerySearchRequest): Promise<ImagerySearchResponse> {
    const city = await requireCity(deps.documents, request.cityId);
    await requireUsgs(deps.setup);
    try {
        const response = await harvestIn(deps, request, city);
        await recordHarvest(deps, request.cityId, response.found > 0 ? 'ok' : 'empty');
        return response;
    } catch (error) {
        await recordHarvest(deps, request.cityId, 'failed', error instanceof ApiError ? error.code : 'apiError.internal');
        throw error;
    }
}
