import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { JobsIntentsPort, JobsViewState } from '../../../src/admin/jobs/jobs-port.js';
import { jobStatusText, jobTypeText, percentOf, statusTone, stepStateText } from '../../../src/admin/jobs/job-text.js';
import { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { jobItem, jobsState, LOADING, nth, page, ready, route } from './fixtures.js';

function area(state: JobsViewState = jobsState()): FakeArea<JobsViewState, JobsIntentsPort> {
    return new FakeArea<JobsViewState, JobsIntentsPort>(state, { cancel: Promise.resolve({ ok: true }) });
}

function detail(job = jobItem()): NonNullable<JobsViewState['detail']> {
    return {
        id: job.id,
        job: {
            status: 'ready',
            reconnecting: false,
            failure: null,
            doc: { id: job.id, path: `cities/bucharest/jobs/${job.id}`, version: '', pending: false, data: job },
        },
        logs: ready([
            { seq: 1, level: 'info', step: 'fetch', message: 'fetching the scene', at: '2026-10-17T09:01:00.000Z' },
            { seq: 2, level: 'error', step: null, message: '<b>not bold</b>', at: '2026-10-17T09:02:00.000Z' },
        ]),
    };
}

describe('<hcm-jobs-page>', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theListOfJobsWithTheirStatusAndTheOpenJobsStepsAndLog', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        const rows = deepAll(element, 'a.row');
        expect(rows.map((row) => row.getAttribute('href'))).toEqual(['#/jobs/b', '#/jobs/a']);
        expect(rows[0]?.getAttribute('aria-current')).toBe('page');
        expect(rows[0]?.textContent).toContain('Running, 42 %');
        expect(deep(element, 'h2').textContent).toBe('USGS import');
        expect(
            deep(element, 'hcm-progress').getAttribute('aria-label') ??
                (deep(element, 'hcm-progress') as HTMLElement & { label: string }).label,
        ).toBe('Progress: 42 %');
        expect(deepAll(element, '.log li').map((line) => line.textContent.replace(/\s+/g, ' ').trim())).toEqual([
            expect.stringContaining('Info · fetch: fetching the scene'),
            expect.stringContaining('Error: <b>not bold</b>'),
        ]);
        expect(deepAll(element, 'b')).toHaveLength(0);
        expect(jobs.named('open')).toEqual(['open ["b"]']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theFilterChipsAndMore', async () => {
        const jobs = area(jobsState({ list: ready([jobItem()], { hasMore: true }) }));
        const { element } = await page('jobs', jobs);

        const chips = deepAll(element, 'hcm-chip');
        deep(nth(chips, 2), 'button').click();
        deep(nth(chips, 0), 'button').click();
        deep(deep(element, '.more'), 'hcm-button').click();

        expect(jobs.calls.filter((call) => !call.startsWith('open'))).toEqual(['setFilter "failed"', 'setFilter "all"', 'more']);
        expect((chips[0] as HTMLElement & { selected: boolean }).selected).toBe(true);
        expect(deepText(element)).toContain('Choose a job to see its steps and log.');
    });

    it('happyPath_cancelAsksFirstThenAsksTheJobToStop', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element } = await page('jobs', jobs, { params: ['b'] });

        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean };
        expect(dialog.open).toBe(true);
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(jobs.named('cancel')).toEqual(['cancel']);
        expect(dialog.open).toBe(false);
    });

    it('badPath_keepingTheJobRunningCancelsNothingAndAStoppingJobsButtonIsOff', async () => {
        const jobs = area(jobsState({ detail: detail() }));
        const { element, app } = await page('jobs', jobs, { params: ['b'] });
        deep(element, '.pane .actions hcm-button').click();
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.cancel').click();
        await updated(element);

        jobs.set({ detail: detail(jobItem({ cancelRequested: true })) });
        await updated(element);

        expect(jobs.named('cancel')).toEqual([]);
        const button = deep(element, '.pane .actions hcm-button') as HTMLElement & { disabled: boolean };
        expect([button.disabled, button.textContent.trim()]).toEqual([true, 'Stopping…']);
        expect(app.named('navigate')).toEqual([]);
    });
});

describe('<hcm-jobs-page>: waiting, finished and failing jobs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aWaitingJobSaysWhenAndAFinishedOneOffersNoCancelButShowsItsError', async () => {
        const waiting = jobItem({
            id: 'w',
            type: 'layer-delete',
            status: 'queued',
            progress: null,
            steps: [],
            dispatchAt: '2026-10-24T09:00:00.000Z',
        });
        const jobs = area(jobsState({ list: ready([waiting]), detail: detail(waiting) }));
        const { element, app } = await page('jobs', jobs, { params: ['w'] });
        expect(deepText(element)).toContain('Runs after Oct 24, 2026');
        expect(deep(element, 'h2').textContent).toBe("Deleting a layer's tiles");

        const failed = jobItem({ status: 'failed', finished: true, error: { code: 'usgs.down', message: 'USGS did not answer' } });
        jobs.set({ detail: detail(failed) });
        await route(app, element, ['b']);

        expect(deepAll(element, '.pane .actions hcm-button')).toHaveLength(0);
        expect(deep(element, '.alert').textContent).toContain('Error: USGS did not answer');
        jobs.set({ detail: { ...detail(failed), logs: ready([]) } });
        await updated(element);
        expect(deepText(element)).toContain('No log lines yet.');
        expect(deep(element, '.tag').dataset['tone']).toBe('error');
    });

    it('badPath_loadingErrorNotFoundEmptyAndReconnecting', async () => {
        const jobs = area(
            jobsState({
                list: LOADING,
                detail: { id: 'x', job: { status: 'loading', doc: null, reconnecting: false, failure: null }, logs: LOADING },
            }),
        );
        const { element, app } = await page('jobs', jobs, { params: ['x'], width: 1300 });
        expect(deepAll(element, 'hcm-loading-indicator')).toHaveLength(2);

        jobs.set({ detail: { id: 'x', job: { status: 'ready', doc: null, reconnecting: false, failure: null }, logs: ready([]) } });
        await updated(element);
        expect(deep(element, 'h2').textContent).toBe('This job does not exist.');

        jobs.set({
            list: { ...ready([]), status: 'error', failure: { kind: 'denied', code: 'permission-denied' } },
            detail: {
                id: 'x',
                job: { status: 'error', doc: null, reconnecting: false, failure: { kind: 'failed', code: 'internal' } },
                logs: ready([]),
            },
        });
        await updated(element);
        const alerts = deepAll(element, '[role="alert"]').map((alert) => alert.textContent.trim());
        expect(alerts).toEqual(['Access was refused. Check that you are still an admin.', 'This could not be read (internal). Try again.']);
        deepAll(element, '.actions hcm-button')[0]?.click();
        expect(jobs.named('retry')).toHaveLength(1);

        jobs.set({ list: ready([], { reconnecting: true }), detail: null });
        await route(app, element, []);
        expect(deepAll(element, '[role="status"]').map((status) => status.textContent.trim())).toContain('Reconnecting…');
        expect(deepText(element)).toContain('No jobs yet.');
    });

    it('happyPath_onAPhoneTheOpenJobReplacesTheListAndCloseGoesBack', async () => {
        const jobs = area(jobsState({ detail: detail(jobItem({ steps: [], progress: null })) }));
        const { element, app } = await page('jobs', jobs, { params: ['b'], width: 360 });

        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();

        expect(app.named('navigate')).toEqual(['navigate {"id":"jobs","params":[]}']);
        expect(deepAll(element, 'hcm-progress')).toHaveLength(0);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutAStoreThePageIsEmptyAndDisconnectingCloses', async () => {
        const { element } = await page('jobs', null);
        expect(element.shadowRoot?.childElementCount).toBe(0);

        const jobs = area();
        const second = await page('jobs', jobs);
        second.element.remove();

        expect(jobs.named('close')).toEqual(['close']);
        expect(jobs.listening).toBe(0);
    });

    it('happyPath_theWordsOfJobsInRomanian', () => {
        expect([
            jobTypeText('ro', 'something-new'),
            jobStatusText('ro', 'waiting_usgs'),
            stepStateText('ro', 'odd'),
            stepStateText('ro', 'done'),
        ]).toEqual(['Procesare', 'Așteaptă USGS', 'în așteptare', 'gata']);
        expect([
            statusTone({ status: 'cancelled', finished: true }),
            statusTone({ status: 'queued', finished: false }),
            percentOf({ progress: null }),
        ]).toEqual(['good', 'wait', null]);
    });
});
