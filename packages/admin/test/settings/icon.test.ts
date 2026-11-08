/**
 * Settings → Browser tab icon (`packages/admin/src/settings/icon.ts`; S-A101-*): the card's base64 goes to `cities.setIcon`,
 * Use the default asks for the default, the browser's refusal and the server's show and change nothing, and leaving the
 * section forgets them. The browser's own checks are `packages/ui/test/admin/settings/icon-upload.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { IconSection, NO_ICON_SECTION, type IconSectionState } from '../../src/settings/icon.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld } from '../content/world.js';

const IMAGE = 'iVBORw0KGgoBAgM=';
const ANSWER = {
    source: 'custom',
    url: 'https://storage.googleapis.com/demo-hcm-public/cities/x/icon-180.png',
    sha256: 'a'.repeat(64),
} as const;

function world() {
    const content = contentWorld();
    const states: IconSectionState[] = [];
    const section = new IconSection(content.services, (state) => states.push(state));
    return { ...content, section, states };
}

describe('the browser tab icon section', () => {
    it('happyPath_anUploadIsSentAndSaid @S-A101-HAPPY-UPLOAD', async () => {
        const w = world();
        w.callables.answer('cities.setIcon', () => ANSWER);

        await expect(w.section.intents.uploadIcon(IMAGE)).resolves.toBe(true);

        expect(w.callables.calls.find((call) => call.name === 'cities.setIcon')?.request).toEqual({
            kind: 'upload',
            cityId: CITY,
            image: IMAGE,
        });
        expect(w.states.map((state) => state.busy)).toEqual([true, false]);
        expect(w.section.state).toEqual(NO_ICON_SECTION);
        expect(w.notices).toEqual([{ key: 'adminContent.settings.icon.saved' }]);
    });

    it('happyPath_useTheDefaultAsksForIt @S-A101-HAPPY-RESET', async () => {
        const w = world();
        w.callables.answer('cities.setIcon', () => ({ ...ANSWER, source: 'default' as const }));

        await expect(w.section.intents.resetIcon()).resolves.toBe(true);

        expect(w.callables.calls.find((call) => call.name === 'cities.setIcon')?.request).toEqual({ kind: 'reset', cityId: CITY });
    });

    it('badPath_theBrowsersRefusalShowsAndNothingIsSent @S-A101-BAD-SVG', () => {
        const w = world();

        w.section.intents.refuseIcon({ key: 'apiError.cityIcon.badType' });

        expect(w.callables.calls).toEqual([]);
        expect(w.section.state.error).toEqual({ key: 'apiError.cityIcon.badType' });
        w.section.close();
        expect(w.section.state).toEqual(NO_ICON_SECTION);
    });

    it('badPath_theServersRefusalShows @S-A101-BAD-SMALL', async () => {
        const w = world();
        w.callables.fail('cities.setIcon', failure('invalid-argument', 'apiError.cityIcon.tooSmall', { min: '192' }));

        await expect(w.section.intents.uploadIcon(IMAGE)).resolves.toBe(false);

        expect(w.section.state).toEqual({ busy: false, error: { key: 'apiError.cityIcon.tooSmall', params: { min: '192' } } });
        expect(w.notices).toEqual([]);
    });
});
