/** `<hcm-review-page>` (M13, `docs/research/M13-roles.md` §8): the queues, each decision, what strangers typed shown as text. Axe-clean. */
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { AREA_ELEMENTS } from '../../../src/admin/areas/review.js';
import type {
    ReviewIntentsPort,
    ReviewItemPort,
    ReviewRequestPort,
    ReviewSuggestionPort,
    ReviewViewState,
} from '../../../src/admin/review/review-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { adminState, cleanup, deep, deepAll, deepText, defineAll, FakeAdminApp, mount, updated } from '../shell/fake-app.js';

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

function list<Item>(items: readonly Item[]) {
    return { status: 'ready', items, hasMore: false, reconnecting: false, failure: null } as const;
}

const ITEM: ReviewItemPort = { entity: 'photo', id: 'p1', title: { ro: 'Poză', en: 'Picture' }, thumbPath: 'held/t.webp', credit: 'Maria' };
const POI: ReviewItemPort = { entity: 'poi', id: 'l1', title: { ro: 'Loc' }, thumbPath: null, credit: null };
const SUGGESTION: ReviewSuggestionPort = {
    id: 's1',
    photoId: 'p1',
    title: { ro: 'Unde?', en: 'Where?' },
    thumb: PIXEL,
    kind: 'place',
    status: 'pending',
    proposal: { location: { lat: 44.44, lng: 26.1 }, bearing: 45, year: 1936, yearEnd: 1940, dateText: 'Vara' },
    count: 2,
    voices: [
        { uid: 'a', reason: '<b>Se vede</b> biserica.', sourceUrl: 'https://example.org/s', credit: 'Maria' },
        { uid: 'b', reason: null, sourceUrl: null, credit: null },
    ],
    decidedBy: null,
};
const REQUEST: ReviewRequestPort = {
    uid: 'u1',
    role: 'moderator',
    reason: 'Vreau să ajut.',
    credit: 'Ana',
    name: 'Ana',
    email: 'ana@e.test',
};

function state(overrides: Partial<ReviewViewState> = {}): ReviewViewState {
    return {
        photos: list([ITEM]),
        places: list([POI]),
        suggestions: list([SUGGESTION]),
        decided: list([{ ...SUGGESTION, id: 's2', status: 'approved', decidedBy: 'u', proposal: { year: 1950 } }]),
        requests: list([REQUEST]),
        pictures: { 'held/t.webp': PIXEL },
        selected: null,
        current: null,
        adjusted: null,
        map: 'none',
        busy: false,
        ...overrides,
    };
}

async function page(view: ReviewViewState) {
    const area = new FakeArea<ReviewViewState, ReviewIntentsPort>(view);
    const app = new FakeAdminApp(adminState({ route: { id: 'review', params: [] } }));
    app.areas.review = area;
    AREA_ELEMENTS.define(customElements);
    const host = await mount<HTMLElement>(html`<hcm-review-page .app=${app} .state=${app.state}></hcm-review-page>`, 900);
    await updated(host);
    return { host, area };
}

/** The button named `label` inside the card that says `text`. */
function press(host: HTMLElement, text: string, label: string): void {
    const card = deepAll(host, 'li.card').find((item) => item.textContent.includes(text));
    const button = card === undefined ? undefined : deepAll(card, 'hcm-button').find((item) => item.textContent.includes(label));
    if (button === undefined) {
        throw new Error(`no ${label} beside ${text}`);
    }
    deep(button, 'button').click();
}

describe('<hcm-review-page>', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('happyPath_everyQueueShows @S-A90-HAPPY-APPROVE', async () => {
        const { host } = await page(state());
        const text = deepText(host);
        for (const expected of [
            'Contributions',
            'Picture',
            'Loc',
            'Suggestions',
            '2 people suggested this',
            'Requests for a role',
            'Ana (ana@e.test)',
        ]) {
            expect(text).toContain(expected);
        }
        expect(await axeViolations(host)).toEqual([]);
    });

    it('happyPath_whatAStrangerTypedIsText @S-A93-BAD-MARKUP-IS-TEXT', async () => {
        const { host } = await page(state());
        expect(deepText(host)).toContain('<b>Se vede</b> biserica.');
        expect(deepAll(host, 'b')).toEqual([]);
        expect(deepAll(host, 'a[rel="noopener noreferrer nofollow ugc"]')).toHaveLength(1);
    });

    it('happyPath_decidingAnItem', async () => {
        const { host, area } = await page(state());
        (deep(host, '#note-photo-p1') as HTMLInputElement).value = 'Bună.';
        press(host, 'Picture', 'Approve');
        expect(area.calls.at(-1)).toContain('decideItem');
        expect(area.calls.at(-1)).toContain('"approve" "Bună."'.replace(' ', ' '));
        press(host, 'Loc', 'Refuse');
        expect(area.calls.at(-1)).toContain('"refuse"');
    });

    it('happyPath_aSuggestionIsComparedThenDecided @S-A93-HAPPY-ADJUST', async () => {
        const { host, area } = await page(state());
        press(host, 'suggested this', 'Compare');
        expect(area.calls.at(-1)).toBe('select "s1"');
        area.set({ selected: 's1', current: { location: { lat: 44.5, lng: 26.2 } }, map: 'ready' });
        await updated(host);
        expect(deepText(host)).toContain('Now: 44.5, 26.2');
        expect(deepText(host)).toContain('Proposed: 44.44, 26.1 · 45° · 1936–1940 · Vara');
        press(host, 'suggested this', 'Adjust');
        expect(area.calls.at(-1)).toBe('startAdjusting');
        area.set({ adjusted: { location: { lat: 44.45, lng: 26.15 }, year: 1950 } });
        await updated(host);
        expect(deepText(host)).toContain('Proposed: 44.45, 26.15 · 1950');
        expect(deepText(host)).toContain('Move the pin');
        press(host, 'suggested this', 'Approve my values');
        expect(area.calls.at(-1)).toContain('"adjust"');
        press(host, 'suggested this', 'Reject');
        expect(area.calls.at(-1)).toContain('"reject"');
        press(host, 'suggested this', 'Approve');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-zoom', { detail: { delta: -1 } }));
        expect(area.calls.at(-1)).toBe('zoomBy -1');
        deep(host, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-host', { detail: { container: {} } }));
        expect(area.calls.at(-1)).toContain('attachMap');
    });

    it('happyPath_aPhotoWithNoPlaceSaysSo', async () => {
        const { host } = await page(state({ selected: 's1', current: {}, map: 'unavailable' }));
        expect(deepText(host)).toContain('Now: no place yet');
        const none = await page(state({ selected: 's1', current: null, map: 'unavailable' }));
        expect(deepText(none.host)).toContain('Now: no place yet');
    });

    it('happyPath_blockAndRevertAndARequest @S-A93-BAD-BLOCKED', async () => {
        const { host, area } = await page(state());
        press(host, 'suggested this', 'Block');
        expect(area.calls.at(-1)).toBe('block "a"');
        press(host, '1950', 'Revert');
        expect(area.calls.at(-1)).toContain('revert');
        press(host, 'Ana (ana@e.test)', 'Approve');
        expect(area.calls.at(-1)).toContain('decideRequest "u1" "approve"');
        press(host, 'Ana (ana@e.test)', 'Refuse');
        expect(area.calls.at(-1)).toContain('"refuse"');
    });

    it('badPath_aModeratorHasNoRequestsAndNothingWaits @S-A91-BAD-NO-REQUESTS', async () => {
        const { host } = await page(
            state({ photos: list([]), places: list([]), suggestions: list([]), decided: list([]), requests: null }),
        );
        expect(deepText(host)).not.toContain('Requests for a role');
        expect(deepText(host)).toContain('Nothing is waiting.');
    });
});
