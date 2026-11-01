import { usgsSceneDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { BrowseImages, type BrowseImage } from '../../src/imagery/browse.js';
import { sceneItemOf, type SceneItem } from '../../src/imagery/model.js';
import { failure, settle } from '../app/fakes.js';
import { answer, callsOf, imageryWorld, sceneDoc } from './world.js';

const COPY = (id: string): string => `usgs-browse/corona2/${id}.jpg`;

/** A scene whose browse copy is made, not made yet, or failed (as the harvest or `imagery.browse` recorded it). */
const BROWSE = {
    copied: (id: string) => ({ state: 'copied', path: COPY(id) }),
    none: () => ({ state: 'none' }),
    failed: () => ({ state: 'failed', error: 'apiError.imagery.browseUnavailable' }),
} as const;

function scene(id: string, copy: keyof typeof BROWSE = 'copied'): SceneItem {
    const browse = BROWSE[copy](id);
    const doc = usgsSceneDocSchema.parse(sceneDoc(id, { browse }));
    return sceneItemOf({ id, path: id, data: doc, version: '', pending: false });
}

function images() {
    const world = imageryWorld();
    let shown: Readonly<Record<string, BrowseImage>> = {};
    const browse = new BrowseImages(world.services, world.files, (next) => {
        shown = next;
    });
    return { ...world, browse, shown: () => shown };
}

describe('the browse images', () => {
    it('happyPath_theDetailCopiesAMissingImageFirstThenShowsItOnce', async () => {
        const { browse, files, shown, callables } = images();
        files.put(COPY('b'));
        answer(callables, 'imagery.browse', (request) => ({ path: COPY(request.entityId), contentType: 'image/jpeg' }));

        await browse.open(scene('b', 'none'));
        await browse.open(scene('b', 'none'));

        expect(callsOf(callables, 'imagery.browse')).toEqual([{ cityId: 'bucharest', entityId: 'b' }]);
        expect(shown()['b']).toEqual({ status: 'ready', url: `blob:${COPY('b')}` });
    });

    it('badPath_aCopyThatFailsOrCannotBeReadIsUnavailableAndTryAgainAsksAgain', async () => {
        const { browse, files, shown, callables } = images();
        callables.fail('imagery.browse', failure('unavailable', 'apiError.imagery.browseUnavailable'));

        await browse.open(scene('c', 'none'));
        const refused = shown()['c'];
        await browse.open(scene('d'));
        files.put(COPY('d'));
        await browse.retry(scene('d'));

        expect(refused).toEqual({ status: 'failed', error: { key: 'apiError.imagery.browseUnavailable' } });
        expect(shown()['d']).toEqual({ status: 'ready', url: `blob:${COPY('d')}` });
    });

    it('happyPath_closingReleasesEveryAddressAndALateOneToo', async () => {
        const { browse, files, shown, callables } = images();
        files.put(COPY('a'));
        files.put(COPY('late'));
        await browse.open(scene('a'));
        files.hold = true;
        const late = browse.open(scene('late'));
        await settle();
        let copy: () => void = () => undefined;
        answer(
            callables,
            'imagery.browse',
            () =>
                new Promise(
                    (resolve) =>
                        (copy = () => {
                            resolve({ path: COPY('late'), contentType: 'image/jpeg' });
                        }),
                ),
        );
        const copying = browse.open(scene('slow', 'none'));
        await settle();

        browse.clear();
        files.flush();
        await late;
        copy();
        await copying;

        expect(files.released).toEqual([`blob:${COPY('a')}`, `blob:${COPY('late')}`]);
        expect(shown()).toEqual({});
        expect(browse.pathOf('a')).toBeNull();
    });

    it('badPath_aRefusalAfterClosingIsForgotten', async () => {
        const { browse, shown, callables } = images();
        let refuse: () => void = () => undefined;
        answer(
            callables,
            'imagery.browse',
            () =>
                new Promise(
                    (_resolve, reject) =>
                        (refuse = () => {
                            reject(new Error('offline'));
                        }),
                ),
        );
        const opening = browse.open(scene('e', 'none'));
        await settle();

        browse.clear();
        refuse();
        await opening;

        expect(shown()).toEqual({});
    });
});

describe('the list asks for the copies it lacks (finding 52 of 2026-11-01)', () => {
    it('happyPath_theListShowsItsCopiesAndAsksForTheMissingOnesFourAtATime', async () => {
        const { browse, files, shown, callables } = images();
        const missing = ['b', 'c', 'd', 'e', 'f', 'g'];
        for (const id of ['a', ...missing]) {
            files.put(COPY(id));
        }
        const pending: (() => void)[] = [];
        answer(
            callables,
            'imagery.browse',
            (request) =>
                new Promise((resolve) => {
                    pending.push(() => {
                        resolve({ path: COPY(request.entityId), contentType: 'image/jpeg' });
                    });
                }),
        );

        browse.thumbnails([scene('a'), ...missing.map((id) => scene(id, 'none'))]);
        await settle();
        const atOnce = callsOf(callables, 'imagery.browse').length;
        const loading = shown()['g'];
        while (pending.length > 0) {
            pending.shift()?.();
            await settle();
        }

        // The rest wait for a place (their rows keep the placeholder), and start as copies end.
        expect([atOnce, loading]).toEqual([4, undefined]);
        expect(callsOf(callables, 'imagery.browse')).toHaveLength(6);
        expect(Object.keys(shown()).toSorted((a, b) => a.localeCompare(b))).toEqual(['a', ...missing]);
        expect(Object.values(shown()).every((image) => image.status === 'ready')).toBe(true);
        expect(browse.pathOf('g')).toBe(COPY('g'));
    });

    it('badPath_aCopyThatFailedIsUnavailableWithoutAskingUntilTryAgain', async () => {
        const { browse, files, shown, callables } = images();
        files.put(COPY('x'));
        answer(callables, 'imagery.browse', (request) => ({ path: COPY(request.entityId), contentType: 'image/jpeg' }));

        browse.thumbnails([scene('x', 'failed')]);
        await browse.open(scene('x', 'failed'));
        const unavailable = shown()['x'];
        const asked = callsOf(callables, 'imagery.browse').length;
        await browse.retry(scene('x', 'failed'));

        expect([unavailable, asked]).toEqual([{ status: 'failed', error: { key: 'apiError.imagery.browseUnavailable' } }, 0]);
        expect(shown()['x']).toEqual({ status: 'ready', url: `blob:${COPY('x')}` });
    });

    it('happyPath_theOpenScenesCopyStartsAtOnceAndOneTheListAskedForIsAskedOnce', async () => {
        const { browse, files, callables } = images();
        const ids = ['b', 'c', 'd', 'e', 'f', 'g'];
        for (const id of ids) {
            files.put(COPY(id));
        }
        const pending: (() => void)[] = [];
        answer(
            callables,
            'imagery.browse',
            (request) =>
                new Promise((resolve) => {
                    pending.push(() => {
                        resolve({ path: COPY(request.entityId), contentType: 'image/jpeg' });
                    });
                }),
        );
        browse.thumbnails(ids.map((id) => scene(id, 'none')));
        await settle();

        const opening = [browse.open(scene('g', 'none')), browse.open(scene('b', 'none'))];
        await settle();
        const asked = callsOf(callables, 'imagery.browse').map((request) => (request as { entityId: string }).entityId);
        while (pending.length > 0) {
            pending.shift()?.();
            await settle();
        }
        await Promise.all(opening);

        expect(asked).toEqual(['b', 'c', 'd', 'e', 'g']);
        expect([browse.pathOf('g'), browse.pathOf('b')]).toEqual([COPY('g'), COPY('b')]);
        expect(callsOf(callables, 'imagery.browse')).toHaveLength(6);
    });
});
