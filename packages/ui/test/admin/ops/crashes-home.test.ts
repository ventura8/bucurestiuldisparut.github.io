import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { CrashesIntentsPort, CrashesViewState } from '../../../src/admin/crashes/crashes-port.js';
import { errorGroupUrl } from '../../../src/admin/crashes/hcm-crashes-list-page.js';
import { publicMapText } from '../../../src/admin/home/hcm-home-page.js';
import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { crashesState, homeState, page } from './fixtures.js';

describe('<hcm-crashes-list-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theGroupsOfAPeriodAndTheSelectedGroupsDetailWithTheConsoleLink', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ selected: 'g1', nextPageToken: 'next' }));
        const { element } = await page('crashes', crashes);

        const rows = deepAll(element, 'button.row');
        expect(rows.map((row) => row.getAttribute('aria-current'))).toEqual(['true', 'false']);
        expect(rows[0]?.textContent).toContain('TypeError: <b>x</b> is undefined');
        expect(deepAll(element, 'b')).toHaveLength(0);
        expect(deep(element, 'h2[data-detail-heading]').textContent).toBe('TypeError: <b>x</b> is undefined');
        expect(deepText(deep(element, '.facts'))).toContain('1,234');
        expect(deepText(deep(element, '.facts'))).toContain('admin 1.2.3');
        const link = deep(element, 'a.external');
        expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
            'https://console.cloud.google.com/errors/detail/g1?project=demo-hcm',
            '_blank',
            'noopener noreferrer',
        ]);
        rows[1]?.click();
        deep(deep(element, '.more'), 'hcm-button').click();
        expect(crashes.calls.filter((call) => !call.startsWith('open'))).toEqual(['select "g2"', 'more']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anotherPeriodAndThePhonesClose', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(crashesState({ selected: 'g2' }));
        const { element } = await page('crashes', crashes, { width: 360 });

        expect(deepText(deep(element, '.facts'))).toContain('viewer');
        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();
        deep(element, 'hcm-segmented-button').dispatchEvent(new CustomEvent('hcm-change', { detail: { value: '24' } }));

        expect(crashes.calls.filter((call) => !call.startsWith('open'))).toEqual(['select null', 'setPeriod 24']);
    });

    it('badPath_aDisabledApiIsExplainedWithTheWayToSetupAndOtherFailuresOfferTryAgain', async () => {
        const crashes = new FakeArea<CrashesViewState, CrashesIntentsPort>(
            crashesState({
                status: 'error',
                groups: [],
                apiDisabled: true,
                failure: { key: 'apiError.cloud.apiDisabled', params: { api: 'clouderrorreporting.googleapis.com' } },
            }),
        );
        const { element } = await page('crashes', crashes);
        expect(deep(element, '[role="alert"]').textContent).toContain('clouderrorreporting.googleapis.com');
        expect(deep(element, 'a[href="#/setup/analytics"]').textContent).toBe('Open the analytics setup');
        deep(element, '.pane .actions hcm-button').click();

        crashes.set({ apiDisabled: false, failure: { key: 'apiError.errorReporting.unavailable' } });
        await updated(element);
        expect(deepAll(element, 'a[href="#/setup/analytics"]')).toHaveLength(0);
        crashes.set({ status: 'loading', failure: null });
        await updated(element);
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(1);
        crashes.set({ status: 'ready' });
        await updated(element);

        expect(deepText(element)).toContain('No errors reported in this period.');
        expect(crashes.named('retry')).toEqual(['retry']);
        expect(errorGroupUrl('a b', 'C/1')).toBe('https://console.cloud.google.com/errors/detail/C%2F1?project=a%20b');
    });
});

describe('<hcm-home-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theCountsWhatWaitsTheServicesAndThePublicMap', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState(), { refresh: Promise.resolve() });
        const { element } = await page('home', home);

        const tiles = deepAll(element, 'a.tile').map((tile) => [
            tile.getAttribute('href'),
            tile.textContent.replace(/\s+/g, ' ').trim(),
            tile.hasAttribute('data-attention'),
        ]);
        expect(tiles).toEqual([
            ['#/photos', '45 Photos', false],
            ['#/pois', '3 Places', false],
            ['#/settings/categories', '2 Place categories', false],
            ['#/layers', '0 Historical layers', false],
            ['#/photos', '4 Photos to check for rights', true],
            ['#/photos', '0 Unpublished photos', false],
            ['#/jobs', '1 Jobs running', true],
            ['#/jobs', '— Failed jobs', false],
        ]);
        expect(deepAll(element, 'li.tag').map((chip) => [chip.dataset['tone'], chip.textContent.trim()])).toEqual([
            ['good', 'Billing: working'],
            ['good', 'Google Cloud: working'],
            ['error', 'Mapbox: needs attention (Mapbox refused the token: it is invalid or has been revoked.)'],
            ['wait', 'USGS: waiting'],
            ['none', 'Analytics: not set up'],
            ['error', 'Crash reports: not answering'],
        ]);
        expect(deepText(element)).toContain('The public map is up to date');
        expect(deepText(element)).toContain('Items not on the public map: 2');
        deep(element, '.pane > .actions hcm-button').click();
        expect(home.named('refresh')).toEqual(['refresh']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_countingAFailedServiceListenerAndThePublicMapsStates', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(
            homeState({
                countsStatus: 'loading',
                counts: null,
                health: { status: 'error', chips: [], reconnecting: false },
                publicMap: { status: 'loading', doc: null, reconnecting: true, failure: null },
            }),
        );
        const { element } = await page('home', home, { locale: 'ro' });

        expect(deep(element, 'a.tile .value').textContent).toBe('…');
        expect(deepText(element)).toContain('Se încarcă…');
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('Se reconectează…');
        deep(element, 'section .pane .actions hcm-button').click();
        expect(home.named('retry')).toEqual(['retry']);

        expect(publicMapText('en', null)).toBe('The public map has not been published yet.');
        expect(publicMapText('en', { status: 'building', builtAt: null, skipped: 0, error: null })).toBe('Updating the public map…');
        expect(publicMapText('en', { status: 'failed', builtAt: null, skipped: 0, error: { key: 'apiError.internal' } })).toContain(
            'The last update of the public map failed: ',
        );
    });
});
