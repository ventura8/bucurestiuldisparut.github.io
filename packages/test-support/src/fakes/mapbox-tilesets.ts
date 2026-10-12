import { fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import { mapboxAuthorized, type MapboxAnswer, type MapboxJob, type MapboxState } from './mapbox-state.js';
import { jsonResponse, requestObject, route, type Route, type RouteParams } from './routes.js';
import { sequence } from './service.js';

/**
 * The Mapbox Tilesets API v1 (MTS, the M3 publisher behind its compute-unit guard) and the styles list: upload a
 * tileset source, create a tileset with a recipe, publish it, and poll the job, which moves `queued` → `processing` →
 * the state's `jobOutcome` one poll at a time. Every call needs a secret token of the tileset's owner with the scope
 * Mapbox asks for.
 */

/** The owner of a tileset id (`<user>.<name>`). */
function tilesetOwner(params: RouteParams): string {
    return String(params['tileset']).split('.')[0] ?? '';
}

const NEXT_STAGE: Readonly<Record<MapboxJob['stage'], MapboxJob['stage'] | 'outcome'>> = {
    queued: 'processing',
    processing: 'outcome',
    success: 'success',
    failed: 'failed',
};

/** The routes of the Tilesets API and the styles list, served by the `mapbox` fake (mapbox.ts). */
export function tilesetRoutes(state: MapboxState): readonly Route[] {
    const nextJob = sequence('cle2e00job', 16);
    const nextStyle = sequence('cle2e00style', 15);
    const createTileset: MapboxAnswer = (request, params, owner) => {
        const id = String(params['tileset']);
        if (owner.tilesets.has(id)) {
            return fixtureResponse('mapbox/tilesets.create.exists', { values: { tilesetId: id } });
        }
        const body = requestObject(request);
        if (body['recipe'] === undefined || typeof body['name'] !== 'string') {
            return jsonResponse({ message: 'recipe and name are required' }, 400);
        }
        owner.tilesets.set(id, { id, name: body['name'], recipe: body['recipe'] });
        return fixtureResponse('mapbox/tilesets.create.ok', { values: { tilesetId: id } });
    };
    const publish: MapboxAnswer = (_request, params, owner) => {
        const id = String(params['tileset']);
        if (!owner.tilesets.has(id)) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const job: MapboxJob = { id: nextJob(), tilesetId: id, stage: 'queued' };
        owner.jobs.set(job.id, job);
        return fixtureResponse('mapbox/tilesets.publish.ok', { values: { tilesetId: id, jobId: job.id } });
    };
    const poll: MapboxAnswer = (_request, params, owner) => {
        const job = owner.jobs.get(String(params['job']));
        if (job === undefined || job.tilesetId !== params['tileset']) {
            return fixtureResponse('mapbox/error.not-found');
        }
        const answer = fixtureResponse(`mapbox/tilesets.job.${job.stage}`, { values: { tilesetId: job.tilesetId, jobId: job.id } });
        const next = NEXT_STAGE[job.stage];
        job.stage = next === 'outcome' ? state.jobOutcome : next;
        return answer;
    };
    const list: MapboxAnswer = (request, _params, owner) => {
        const limit = Number(request.url.searchParams.get('limit') ?? 100);
        const template = (fixtureBody('mapbox/tilesets.list.one') as Record<string, unknown>[])[0] ?? {};
        return jsonResponse(
            [...owner.tilesets.values()].slice(0, limit).map((tileset) => ({ ...template, id: tileset.id, name: tileset.name })),
        );
    };
    const base = 'https://api.mapbox.com/tilesets/v1';
    const byTileset = { userOf: tilesetOwner };
    return [
        route(
            'POST',
            `${base}/sources/{user}/{source}`,
            'mapbox.tilesets.sources.create',
            mapboxAuthorized(state, 'tilesets:write', (_request, params, owner) => {
                owner.sources.add(String(params['source']));
                return fixtureResponse('mapbox/tilesets.source.created', {
                    values: { mapboxUser: String(params['user']), sourceId: String(params['source']) },
                });
            }),
        ),
        route(
            'POST',
            `${base}/{tileset}/publish`,
            'mapbox.tilesets.publish',
            mapboxAuthorized(state, 'tilesets:write', publish, byTileset.userOf),
        ),
        route(
            'GET',
            `${base}/{tileset}/jobs/{job}`,
            'mapbox.tilesets.jobs.get',
            mapboxAuthorized(state, 'tilesets:read', poll, byTileset.userOf),
        ),
        route(
            'POST',
            `${base}/{tileset}`,
            'mapbox.tilesets.create',
            mapboxAuthorized(state, 'tilesets:write', createTileset, byTileset.userOf),
        ),
        route(
            'DELETE',
            `${base}/{tileset}`,
            'mapbox.tilesets.delete',
            mapboxAuthorized(
                state,
                'tilesets:write',
                (_request, params, owner) => {
                    return owner.tilesets.delete(String(params['tileset']))
                        ? new Response(null, { status: 204 })
                        : fixtureResponse('mapbox/error.not-found');
                },
                byTileset.userOf,
            ),
        ),
        route('GET', `${base}/{user}`, 'mapbox.tilesets.list', mapboxAuthorized(state, 'tilesets:list', list)),
        route(
            'GET',
            'https://api.mapbox.com/styles/v1/{user}',
            'mapbox.styles.list',
            mapboxAuthorized(state, 'styles:list', () => fixtureResponse('mapbox/styles.list.none')),
        ),
        route(
            'POST',
            'https://api.mapbox.com/styles/v1/{user}',
            'mapbox.styles.create',
            mapboxAuthorized(state, 'styles:write', (request, params) =>
                fixtureResponse('mapbox/styles.create.ok', {
                    values: { mapboxUser: String(params['user']), styleId: nextStyle() },
                    merge: requestObject(request),
                }),
            ),
        ),
    ];
}
