// Edit points after a version is on the map: a published version opens with its pairs, editable (S-A16-HAPPY-EDIT-POINTS-PUBLISHED);
// one that ended, or is on its way to the map, takes none (S-A16-BAD-EDIT-POINTS-ENDED). Saving is `imagery.saveGcps`, which starts
// a new version of the same layer (`georef.test.ts`: the save of a rendered version).
import { describe, expect, it } from 'vitest';

import { GEOREF_MODULE } from '../../src/georef/georef.js';
import { settle } from '../app/fakes.js';
import { golden, imageryWorld, VERSIONS } from '../imagery/world.js';

const VERSION = 'job-1966-0712';

async function openedAs(state: string) {
    const world = imageryWorld();
    world.store.docs.set(VERSIONS(VERSION), { ...golden('version.awaiting-approval.json'), state });
    const georef = GEOREF_MODULE.create(world.services);
    georef.open([VERSION]);
    await settle();
    return georef;
}

describe('edit points after approval', () => {
    it('happyPath_aPublishedVersionOpensWithItsPairsAndTakesNewOnes @S-A16-HAPPY-EDIT-POINTS-PUBLISHED', async () => {
        const georef = await openedAs('published');

        expect(georef.state.version).toMatchObject({ id: VERSION, state: 'published', editable: true });
        expect(georef.state.pairs).toHaveLength(8);
        const first = georef.state.pairs[0]?.id ?? '';
        georef.intents.movePixel(first, { x: 12, y: 34 });
        expect([georef.state.dirty, georef.state.pairs[0]?.pixel]).toEqual([true, { x: 12, y: 34 }]);
    });

    it('badPath_aVersionThatEndedOrIsOnItsWayToTheMapTakesNoPoints @S-A16-BAD-EDIT-POINTS-ENDED', async () => {
        for (const state of ['superseded', 'approved', 'publishing', 'rejected']) {
            const georef = await openedAs(state);
            expect([state, georef.state.version?.editable]).toEqual([state, false]);
        }
    });
});
