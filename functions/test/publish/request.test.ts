/**
 * A manifest build request: `requestedVersion` + 1 and `queued` on `manifests/{city}`, one task per one-minute window
 * (Cloud Tasks drops a second task with the same id), the stamp of whoever asked.
 */
import { FIRESTORE_PATHS, manifestStateDocSchema, timestampFromDate } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { requestManifestBuild } from '../../src/publish/request.js';
import { CITY_ID } from './city.js';
import { contentDeps } from './fakes.js';

const NOW = '2026-10-12T08:30:10.000Z';
const WINDOW = String(Math.floor(Date.parse(NOW) / 60_000));

describe('requestManifestBuild', () => {
    it('happyPath_theFirstRequestCreatesTheStateAndQueuesTheWindowsTask', async () => {
        const deps = contentDeps(NOW);

        await expect(requestManifestBuild(deps, { cityId: CITY_ID, full: false, updatedBy: 'system:publish' })).resolves.toEqual({
            requestedVersion: 1,
            queued: true,
        });

        expect(await deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema)).toEqual({
            requestedVersion: 1,
            builtVersion: 0,
            status: 'queued',
            updatedBy: 'system:publish',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect(deps.tasks.queued).toEqual([
            {
                queue: 'publish-buildManifest',
                payload: { cityId: CITY_ID, requestedVersion: 1, full: false },
                options: { id: `manifest-${CITY_ID}-${WINDOW}`, delaySeconds: 60 },
            },
        ]);
    });

    it('badPath_aSecondRequestInTheSameMinuteSharesTheBuild', async () => {
        const deps = contentDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema, {
            requestedVersion: 4,
            builtVersion: 4,
            status: 'idle',
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucuresti/manifest.json',
            updatedBy: 'system:publish',
            updatedAt: timestampFromDate(new Date('2026-10-12T08:00:00.000Z')),
        });

        await requestManifestBuild(deps, { cityId: CITY_ID, full: false, updatedBy: 'system:publish' });
        const second = await requestManifestBuild(deps, { cityId: CITY_ID, full: true, updatedBy: 'u-admin' });

        expect(second).toEqual({ requestedVersion: 6, queued: false });
        expect(await deps.documents.get(FIRESTORE_PATHS.manifestState(CITY_ID), manifestStateDocSchema)).toMatchObject({
            requestedVersion: 6,
            builtVersion: 4,
            status: 'queued',
            url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucuresti/manifest.json',
            updatedBy: 'u-admin',
        });
        expect(deps.tasks.queued).toHaveLength(1);
    });
});
