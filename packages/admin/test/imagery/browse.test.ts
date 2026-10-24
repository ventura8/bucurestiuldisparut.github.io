import { usgsSceneDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { BrowseImages, type BrowseImage } from '../../src/imagery/browse.js';
import { sceneItemOf, type SceneItem } from '../../src/imagery/model.js';
import { failure, settle } from '../app/fakes.js';
import { answer, callsOf, imageryWorld, sceneDoc } from './world.js';

const COPY = (id: string): string => `usgs-browse/corona2/${id}.jpg`;

function scene(id: string, copied = true): SceneItem {
    const browse = copied ? { state: 'copied', path: COPY(id) } : { state: 'none' };
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
    it('happyPath_theListShowsTheCopiesThatExistWithoutAskingUsgs', async () => {
        const { browse, files, shown, callables } = images();
        files.put(COPY('a'));

        browse.thumbnails([scene('a'), scene('b', false)]);
        await settle();

        expect(shown()).toEqual({ a: { status: 'ready', url: `blob:${COPY('a')}` } });
        expect(browse.pathOf('a')).toBe(COPY('a'));
        expect(browse.pathOf('b')).toBeNull();
        expect(callsOf(callables, 'imagery.browse')).toEqual([]);
    });

    it('happyPath_theDetailCopiesAMissingImageFirstThenShowsItOnce', async () => {
        const { browse, files, shown, callables } = images();
        files.put(COPY('b'));
        answer(callables, 'imagery.browse', (request) => ({ path: COPY(request.entityId), contentType: 'image/jpeg' }));

        await browse.open(scene('b', false));
        await browse.open(scene('b', false));

        expect(callsOf(callables, 'imagery.browse')).toEqual([{ cityId: 'bucharest', entityId: 'b' }]);
        expect(shown()['b']).toEqual({ status: 'ready', url: `blob:${COPY('b')}` });
    });

    it('badPath_aCopyThatFailsOrCannotBeReadIsUnavailableAndTryAgainAsksAgain', async () => {
        const { browse, files, shown, callables } = images();
        callables.fail('imagery.browse', failure('unavailable', 'apiError.imagery.browseUnavailable'));

        await browse.open(scene('c', false));
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
        const copying = browse.open(scene('slow', false));
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
        const opening = browse.open(scene('e', false));
        await settle();

        browse.clear();
        refuse();
        await opening;

        expect(shown()).toEqual({});
    });
});
