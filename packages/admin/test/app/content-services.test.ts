/**
 * The city the editor areas work on (`packages/admin/src/app/content-services.ts`, M5-interfaces §1.5; behaviour A49):
 * the shell's current city once `admin.session` decided it, else the `e2e` build's own, else the project's first.
 */
import { FakeContentStore } from '@hcm/test-support/fake-content-store';
import { describe, expect, it } from 'vitest';

import { contentServices, type ContentShell } from '../../src/app/content-services.js';
import { FakeCallables, FakeClock, MemoryStore, shellStateAccess, testLog } from './fakes.js';

function shellOf(cityId: string | null, e2eCity: string | null, cities: readonly string[]): ContentShell {
    return {
        content: {
            modules: {},
            store: new FakeContentStore(),
            theme: () => ({ light: {}, dark: {}, highContrastLight: {}, highContrastDark: {} }),
            areas: {} as ContentShell['content']['areas'],
            cityId: e2eCity,
        },
        cities,
        callables: new FakeCallables(),
        clock: new FakeClock(),
        local: new MemoryStore(),
        log: testLog().log,
        shell: shellStateAccess({ cityId }),
        denied: () => undefined,
    };
}

describe('the city the areas edit', () => {
    it.each([
        ['the shell has chosen one', 'cluj', 'e2e-city', ['bucharest'], 'cluj'],
        ['the shell has not chosen yet, in the e2e build', null, 'e2e-city', ['bucharest'], 'e2e-city'],
        ['the shell has not chosen yet', null, null, ['bucharest', 'cluj'], 'bucharest'],
    ] as const)('happyPath_%s', (_name, chosen, e2eCity, cities, expected) => {
        expect(contentServices(shellOf(chosen, e2eCity, cities)).cityId).toBe(expected);
    });

    it('badPath_aProjectWithoutCitiesEditsNone', () => {
        expect(contentServices(shellOf(null, null, [])).cityId).toBe('');
    });
});
