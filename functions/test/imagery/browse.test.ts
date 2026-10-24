/**
 * `imagery.browse` (`functions/src/imagery/browse.ts`, `docs/research/M3-interfaces.md` §3.4): the browser never asks
 * USGS; the scene's browse image is fetched server-side from `ims.cr.usgs.gov` only, checked by its bytes, copied once
 * into the private bucket and read from there; a failure is recorded on the scene and answered so the card can retry.
 */
import { RASTER_PATHS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { browseFunction } from '../../src/imagery/browse.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { JPEG_BYTES, PNG_BYTES } from '../support/imagery-fakes.js';
import { CITY, readScene, readyWorld, seedScene, type ImageryWorld } from './world.js';

const ENTITY = 'DS1105-1071DF075';
const SOURCE = `https://ims.cr.usgs.gov/browse/declass1/${ENTITY}.jpg`;
const COPY = RASTER_PATHS.browse('corona2', ENTITY);

function browse(world: ImageryWorld, entityId = ENTITY) {
    return browseFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId }));
}

describe('imagery.browse', () => {
    it('happyPath_theFirstAskCopiesTheBrowseImageIntoOurBucket', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY);
        world.remote.serve(SOURCE, JPEG_BYTES);

        await expect(browse(world)).resolves.toEqual({ path: COPY, contentType: 'image/jpeg' });

        expect(world.deps.blobs.object('private', COPY)?.options).toMatchObject({ contentType: 'image/jpeg', ifGenerationMatch: 0 });
        expect(await readScene(world, ENTITY)).toMatchObject({ browse: { state: 'copied', path: COPY, sourceUrl: SOURCE } });
        expect(world.remote.recorder.argsOf('get')[0]?.[1]).toMatchObject({ allowedHosts: ['ims.cr.usgs.gov'], maxBytes: 5_000_000 });
    });

    it('happyPath_aCopyThatExistsIsReadWithoutAskingUsgs', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY, { browse: { state: 'copied', sourceUrl: SOURCE, path: COPY } });
        world.deps.blobs.put('private', COPY, PNG_BYTES, { contentType: 'image/png' });

        await expect(browse(world)).resolves.toEqual({ path: COPY, contentType: 'image/png' });
        expect(world.remote.recorder.calls).toEqual([]);
    });

    it('happyPath_aCopyTheLifecycleRemovedIsMadeAgain', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY, { browse: { state: 'copied', sourceUrl: SOURCE, path: COPY } });
        world.remote.serve(SOURCE, PNG_BYTES, 'image/png');

        await expect(browse(world)).resolves.toEqual({ path: COPY, contentType: 'image/png' });
        expect(world.remote.fetched).toEqual([SOURCE]);
    });

    it('happyPath_aFrameAnotherCityCopiedFirstIsShared', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY);
        world.remote.serve(SOURCE, JPEG_BYTES);
        world.deps.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'conflict', { status: 412 }));

        await expect(browse(world)).resolves.toEqual({ path: COPY, contentType: 'image/jpeg' });
        expect((await readScene(world, ENTITY))?.browse.state).toBe('copied');
    });

    it.each([
        [
            'USGS answering 503',
            (world: ImageryWorld) => {
                world.remote.files.set(SOURCE, new UpstreamError('remote', 'unavailable', { status: 503 }));
            },
        ],
        [
            'an HTML page instead of an image',
            (world: ImageryWorld) => {
                world.remote.serve(SOURCE, new TextEncoder().encode('<html></html>'), 'text/html');
            },
        ],
        [
            'the bucket refusing the write',
            (world: ImageryWorld) => {
                world.remote.serve(SOURCE, JPEG_BYTES);
                world.deps.blobs.recorder.failNext('write', new UpstreamError('cloud-storage', 'forbidden', { status: 403 }));
            },
        ],
    ])('badPath_aFailedCopyIsRecordedAndAnsweredBrowseUnavailable_%s', async (_case, arrange) => {
        const world = await readyWorld();
        await seedScene(world, ENTITY);
        arrange(world);

        const failure = await failureOf(browse(world));

        expect(failure).toMatchObject({ code: 'unavailable', details: { code: 'apiError.imagery.browseUnavailable' } });
        expect(await readScene(world, ENTITY)).toMatchObject({
            browse: { state: 'failed', sourceUrl: SOURCE, error: 'apiError.imagery.browseUnavailable' },
        });
    });

    it('badPath_aSceneWithoutABrowseAddressFetchesNothing', async () => {
        const world = await readyWorld();
        await seedScene(world, ENTITY, { browse: { state: 'failed' } });

        const failure = await failureOf(browse(world));

        expect(failure).toMatchObject({ details: { code: 'apiError.imagery.browseUnavailable' } });
        expect(world.remote.recorder.calls).toEqual([]);
        expect((await readScene(world, ENTITY))?.browse).toMatchObject({ state: 'failed', error: 'apiError.imagery.browseUnavailable' });
    });

    it('badPath_anUnknownSceneIsNotFound', async () => {
        const world = await readyWorld();

        expect(await failureOf(browse(world))).toMatchObject({ code: 'not-found', details: { code: 'apiError.notFound' } });
    });
});
