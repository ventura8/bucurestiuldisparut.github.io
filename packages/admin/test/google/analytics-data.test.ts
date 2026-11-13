import { createLogger } from '@hcm/shared';
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createMeasurementReports } from '../../src/google/analytics-reports.js';
import { readStatistics, StatisticsProblem, type StatisticsDays } from '../../src/google/analytics-data.js';

/**
 * §203: the Statistics view's numbers against the fake Analytics Admin and Data APIs: the property found from the
 * measurement id, three `batchRunReports` per period, each report read into the view's numbers.
 */

const MEASUREMENT_ID = 'G-E2E0000000';

async function world(options: { readonly reports?: boolean; readonly sample?: boolean } = {}) {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-management.analyticsLinked');
    const transport = {
        fetch: fakes.fetch,
        token: () => GOOGLE_TOKENS.owner,
        sleep: () => Promise.resolve(),
        log: createLogger('test', { minLevel: 'error' }),
    };
    if (options.reports !== false) {
        await createMeasurementReports(transport, MEASUREMENT_ID);
    }
    if (options.sample !== false) {
        fakes.scenario('analytics-data.sample');
    }
    return { fakes, read: (days: StatisticsDays = 28, id = MEASUREMENT_ID) => readStatistics(transport, id, days) };
}

function urlOf(input: RequestInfo | URL): string {
    if (input instanceof Request) {
        return input.url;
    }
    return input instanceof URL ? input.href : input;
}

describe('readStatistics', () => {
    it('happyPath_theOverviewTheAppsAndTheWizardStepsOfThePeriod', async () => {
        const { fakes, read } = await world();

        const numbers = await read();

        expect(numbers).toMatchObject({ visitors: 120, sessions: 180 });
        expect(numbers.pages).toEqual([
            { name: '/', count: 300 },
            { name: '/admin/', count: 40 },
        ]);
        expect(numbers.screens[0]).toEqual({ name: 'home', count: 12 });
        expect(numbers.events.map((event) => event.name)).toEqual(['year_change', 'photo_open']);
        expect(numbers.devices[0]).toEqual({ name: 'desktop', count: 80 });
        expect(numbers.countries[0]).toEqual({ name: 'Romania', count: 90 });
        expect(numbers.surfaces[0]).toEqual({
            surface: 'viewer',
            visitors: 100,
            sessions: 150,
            daily: [
                { date: '20261111', visitors: 30, sessions: 40 },
                { date: '20261112', visitors: 50, sessions: 70 },
            ],
        });
        expect(numbers.steps).toEqual([
            { wizard: 'new_city', step: 'names', visitors: 10, averageMs: 30_000, errors: [] },
            {
                wizard: 'new_city',
                step: 'area',
                visitors: 7,
                averageMs: 150_000,
                errors: [
                    { name: 'apiError.invalidRequest', count: 2 },
                    { name: 'e2e_unknown_code', count: 1 },
                ],
            },
            { wizard: 'new_city', step: 'create', visitors: 5, averageMs: null, errors: [] },
        ]);
        expect(fakes.callsTo('analytics-data.batchRunReports')).toHaveLength(3);
        expect(new URL(fakes.callsTo('analytics-data.batchRunReports')[0]?.url ?? '').pathname).toBe(
            '/v1beta/properties/400000001:batchRunReports',
        );
    });

    it('happyPath_anotherPeriodAsksForItsOwnDays_andAnEmptyPropertyGivesZeros', async () => {
        const { fakes, read } = await world({ sample: false });

        const numbers = await read(7);

        expect(numbers).toMatchObject({ visitors: 0, sessions: 0, pages: [], surfaces: [], steps: [] });
        expect(fakes.state.analyticsData.periods.every((days) => days === 7)).toBe(true);
    });

    it('badPath_anUnregisteredMeasurementNameIsGooglesInvalidArgument', async () => {
        const { read } = await world({ reports: false });

        await expect(read()).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('badPath_noPropertyAtAllIsNoAccess_andAnotherPropertyIsNoProperty', async () => {
        const other = await world();
        other.fakes.scenario('analytics-admin.otherAccount');
        await expect(other.read()).rejects.toEqual(new StatisticsProblem('noAccess'));

        const unknown = await world();
        await expect(unknown.read(28, 'G-NOT0THERS')).rejects.toEqual(new StatisticsProblem('noProperty'));
        expect(unknown.fakes.callsTo('analytics-data.batchRunReports')).toHaveLength(0);
    });

    it('badPath_aDisabledDataApiNamesTheApi', async () => {
        const { fakes, read } = await world();
        fakes.fail('analytics-data', 'apiDisabled');

        await expect(read()).rejects.toMatchObject({ kind: 'forbidden', api: 'analyticsdata.googleapis.com' });
    });

    it('badPath_aPropertyTheAccountMayNotReadIsForbiddenWithoutAnApi', async () => {
        const { fakes, read } = await world();
        fakes.fail('analytics-data', 'forbidden');

        const refused = await read().catch((error: unknown) => error);

        expect(refused).toMatchObject({ kind: 'forbidden' });
        expect(refused).not.toHaveProperty('api');
    });

    it('badPath_aRowWithoutValuesCountsAsEmptyAndZero', async () => {
        const { fakes } = await world();
        const bare = {
            reports: [{ rows: [{}] }, { rows: [{ dimensionValues: [{ value: 'other' }], metricValues: [{ value: 'x' }] }] }, {}, {}, {}],
        };
        const fetcher: typeof fetch = (input, init) =>
            urlOf(input).includes('analyticsdata')
                ? Promise.resolve(new Response(JSON.stringify(bare), { status: 200, headers: { 'content-type': 'application/json' } }))
                : fakes.fetch(input, init);
        const options = {
            fetch: fetcher,
            token: () => GOOGLE_TOKENS.owner,
            sleep: () => Promise.resolve(),
            log: createLogger('test', { minLevel: 'error' }),
        };

        const numbers = await readStatistics(options, MEASUREMENT_ID, 28);

        expect(numbers.steps).toEqual([{ wizard: '', step: '', visitors: 0, averageMs: null, errors: [] }]);
        expect(numbers).toMatchObject({ visitors: 0, sessions: 0 });
    });
});
