import { describe, expect, it } from 'vitest';

import { SECRET_MANAGER_API, SecretStoreError, createRestSecretStore } from '../../src/adapters/secret-store-rest.js';
import type { Clock } from '../../src/ports/clock.js';

const TOKEN = 'ya29.e2e-access-token';
const SECRETS = `${SECRET_MANAGER_API}/projects/demo-hcm/secrets`;

interface Call {
    readonly url: string;
    readonly method: string | undefined;
    readonly headers: unknown;
    readonly body: unknown;
}

/** A Secret Manager stand-in: answers each call with the next response and records the request. */
function fakeApi(...responses: Response[]): { readonly fetch: typeof fetch; readonly calls: Call[] } {
    const calls: Call[] = [];
    const fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = input instanceof Request ? input.url : input.toString();
        calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
        const next = responses.shift();
        return next === undefined ? Promise.reject(new Error('unexpected call')) : Promise.resolve(next);
    };
    return { fetch, calls };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function accessed(value: string): Response {
    return json({ name: 'projects/1/secrets/mapbox-sk-tiles/versions/3', payload: { data: Buffer.from(value).toString('base64') } });
}

class ManualClock implements Clock {
    millis = Date.UTC(2026, 9, 11);

    now(): Date {
        return new Date(this.millis);
    }
}

function store(api: ReturnType<typeof fakeApi>, clock = new ManualClock()): ReturnType<typeof createRestSecretStore> {
    return createRestSecretStore({
        projectId: 'demo-hcm',
        tokens: { accessToken: () => Promise.resolve(TOKEN) },
        fetch: api.fetch,
        clock,
        ttlMs: 60_000,
    });
}

describe('read', () => {
    it('happyPath_readsTheLatestVersionWithTheServiceAccountToken', async () => {
        const api = fakeApi(accessed('sk.e2e-tiles'));

        await expect(store(api).read('mapbox-sk-tiles')).resolves.toBe('sk.e2e-tiles');
        expect(api.calls).toEqual([
            {
                url: `${SECRETS}/mapbox-sk-tiles/versions/latest:access`,
                method: 'GET',
                headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
                body: undefined,
            },
        ]);
    });

    it('happyPath_cachesTheValueUntilTheTtlExpires', async () => {
        const clock = new ManualClock();
        const api = fakeApi(accessed('first'), accessed('second'));
        const secrets = store(api, clock);

        await secrets.read('usgs-app-token');
        clock.millis += 59_999;
        const cached = await secrets.read('usgs-app-token');
        clock.millis += 1;
        const refreshed = await secrets.read('usgs-app-token');

        expect([cached, refreshed, api.calls.length]).toEqual(['first', 'second', 2]);
    });

    it('happyPath_aSecretWithoutVersionsReadsAsUnset', async () => {
        await expect(store(fakeApi(json({ error: { code: 404 } }, 404))).read('usgs-username')).resolves.toBeUndefined();
    });

    it('happyPath_invalidateForcesAFreshRead', async () => {
        const api = fakeApi(accessed('old'), accessed('new'));
        const secrets = store(api);

        await secrets.read('mapbox-sk-bootstrap');
        secrets.invalidate();

        await expect(secrets.read('mapbox-sk-bootstrap')).resolves.toBe('new');
    });

    it('badPath_aDeniedReadFailsWithoutLeakingTheToken', async () => {
        const failure = store(fakeApi(json({ error: { code: 403 } }, 403))).read('mapbox-sk-tiles');

        await expect(failure).rejects.toThrow(new SecretStoreError('Secret Manager access of mapbox-sk-tiles failed (HTTP 403)', 403));
        await expect(failure).rejects.toMatchObject({ name: 'SecretStoreError', status: 403 });
    });

    it.each([{ payload: {} }, { payload: 'x' }, null])('badPath_aMalformedBodyIsRejected_%#', async (body) => {
        await expect(store(fakeApi(json(body))).read('mapbox-sk-tiles')).rejects.toThrow(
            'access of mapbox-sk-tiles returned an unexpected body',
        );
    });
});

describe('write', () => {
    it('happyPath_addsAVersionAndDropsTheCachedValue', async () => {
        const api = fakeApi(
            accessed('old'),
            json({ name: 'projects/1/secrets/mapbox-sk-tiles/versions/4', state: 'ENABLED' }),
            accessed('new'),
        );
        const secrets = store(api);
        await secrets.read('mapbox-sk-tiles');

        await expect(secrets.write('mapbox-sk-tiles', 'new')).resolves.toBe('projects/1/secrets/mapbox-sk-tiles/versions/4');
        await expect(secrets.read('mapbox-sk-tiles')).resolves.toBe('new');
        expect(api.calls[1]).toMatchObject({
            url: `${SECRETS}/mapbox-sk-tiles:addVersion`,
            method: 'POST',
            body: JSON.stringify({ payload: { data: Buffer.from('new').toString('base64') } }),
        });
    });

    it('badPath_aMissingSecretCannotBeWritten', async () => {
        await expect(store(fakeApi(json({}, 404))).write('usgs-app-token', 'x')).rejects.toMatchObject({ status: 404 });
    });

    it.each([{ state: 'ENABLED' }, 'ENABLED'])('badPath_aMalformedAddVersionBodyIsRejected_%#', async (body) => {
        await expect(store(fakeApi(json(body))).write('usgs-app-token', 'x')).rejects.toThrow(
            'addVersion of usgs-app-token returned an unexpected body',
        );
    });
});
