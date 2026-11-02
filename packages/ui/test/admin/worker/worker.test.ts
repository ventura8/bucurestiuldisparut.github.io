// M7's elements (docs/research/M7-local-worker.md §7): the local worker's panel and a version's place, over a fake feed that
// a fake app's Jobs store hands out, as the admin's `JobsIntents.worker` does.
import { axeViolations } from '@hcm/test-support/axe';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { html, render, type LitElement } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { wordedWait, versionDetail } from '../../../src/admin/imagery/imagery-text.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { defineWorkerElements } from '../../../src/admin/worker/define.js';
import { workerCommand, WORKER_PAGE } from '../../../src/admin/worker/hcm-worker-panel.js';
import { loadWorkerElements } from '../../../src/admin/worker/load.js';
import type { WorkerFeedPort, WorkerHostPort, WorkerViewPort } from '../../../src/admin/worker/worker-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { setupView, stepView } from '../setup/fixtures.js';
import { installSliceView } from '../setup/install-fixtures.js';

defineWorkerElements();
defineWorkerElements();
defineHcmSetupPipeline();

const DIGEST = `sha256:${'b'.repeat(64)}`;

function view(changes: Partial<WorkerViewPort> = {}): WorkerViewPort {
    return {
        city: 'bucharest',
        status: 'ready',
        failure: null,
        worker: null,
        connected: false,
        choice: 'auto',
        image: DIGEST,
        usage: { vcpuSeconds: 12_345, gibSeconds: 45_678 },
        job: null,
        acting: false,
        refusal: null,
        ...changes,
    };
}

class FakeFeed implements WorkerFeedPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: WorkerViewPort) => void>();
    state: WorkerViewPort;

    constructor(state: WorkerViewPort) {
        this.state = state;
    }

    readonly intents = {
        setChoice: (choice: string): Promise<boolean> => this.#record(`setChoice ${choice}`),
        runJob: (place: string, ok: boolean): Promise<boolean> => this.#record(`runJob ${place} ${String(ok)}`),
        retry: (): void => {
            this.calls.push('retry');
        },
    };

    subscribe(listener: (state: WorkerViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    start(jobId: string | null): void {
        this.calls.push(`start ${String(jobId)}`);
    }

    stop(): void {
        this.calls.push('stop');
    }

    set(changes: Partial<WorkerViewPort>): void {
        this.state = { ...this.state, ...changes };
        for (const listener of this.#listeners) {
            listener(this.state);
        }
    }

    #record(call: string): Promise<boolean> {
        this.calls.push(call);
        return Promise.resolve(true);
    }
}

class FakeHost implements WorkerHostPort {
    readonly calls: string[] = [];
    readonly feeds: FakeFeed[] = [];
    fails = false;

    constructor(readonly state: WorkerViewPort = view()) {}

    readonly content = {
        jobs: {
            intents: {
                worker: (): Promise<FakeFeed> => {
                    const feed = new FakeFeed(this.state);
                    this.feeds.push(feed);
                    return Promise.resolve(feed);
                },
                workerElements: (): Promise<void> => {
                    this.calls.push('workerElements');
                    return Promise.resolve();
                },
            },
        },
    };

    loadPage(id: 'jobs'): Promise<unknown> {
        this.calls.push(`loadPage ${id}`);
        return this.fails ? Promise.reject(new Error('chunk lost')) : Promise.resolve('hcm-jobs-page');
    }

    get feed(): FakeFeed {
        const feed = this.feeds.at(-1);
        if (feed === undefined) {
            throw new Error('no feed yet');
        }
        return feed;
    }
}

function t(locale: 'ro' | 'en', key: AdminWorkerKey, params?: Readonly<Record<string, string>>): string {
    return translateAdminWorker(locale, key, params);
}

async function panel(host: WorkerHostPort | null, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(html`<hcm-worker-panel .app=${host} locale=${locale} project="demo-hcm"></hcm-worker-panel>`);
    await updated(element);
    return element;
}

async function place(host: WorkerHostPort, locale: 'ro' | 'en' = 'en'): Promise<LitElement> {
    const element = await fixture<LitElement>(html`<hcm-run-place .app=${host} locale=${locale} job="j1"></hcm-run-place>`);
    await updated(element);
    return element;
}

function button(element: Element, label: string): HTMLElement {
    const found = deepAll(element, 'hcm-button').find((candidate) => candidate.textContent.trim() === label);
    if (found === undefined) {
        throw new Error(`no button ${label}`);
    }
    return deep(found, 'button');
}

describe('<hcm-worker-panel>', () => {
    afterEach(cleanup);

    it('happyPath_aConnectedComputerItsLastJobTheCommandTheChoiceAndTheMeter', async () => {
        const seenAt = '2026-11-02T09:59:00.000Z';
        const host = new FakeHost(
            view({
                connected: true,
                worker: { id: 'w-1', state: 'idle', seenAt, jobId: null, lastJob: { id: 'j0', outcome: 'done', at: seenAt } },
            }),
        );
        const element = await panel(host);
        const text = deepText(element);

        expect(host.feed.calls).toEqual(['start null']);
        expect(text).toContain(t('en', 'adminWorker.connected', { when: '' }).split(' Seen')[0] ?? '');
        expect(text).toContain(t('en', 'adminWorker.lastDone', { when: '' }).slice(0, 10));
        const command = workerCommand('demo-hcm', 'bucharest', DIGEST);
        expect(command).toBe(
            `docker run --rm -p 127.0.0.1:8765:8765 -v "$HOME/hcm-worker:/work" us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@${DIGEST} worker --city bucharest --project demo-hcm`,
        );
        expect(deep(element, 'pre').textContent).toBe(command);
        expect(deep(element, `a[href="${WORKER_PAGE}"]`).getAttribute('rel')).toBe('noopener noreferrer');
        expect(text).toContain('12,345 of 180,000 vCPU-seconds · 45,678 of 360,000 GiB-seconds');
        // The bar shows the larger share: 45,678 of 360,000 GiB-seconds is more than 12,345 of 180,000 vCPU-seconds.
        expect((deep(element, 'hcm-progress') as LitElement & { value: number }).value).toBeCloseTo(45_678 / 360_000);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_copyPutsTheCommandOnTheClipboardAndSaysSoPolitely', async () => {
        const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const element = await panel(new FakeHost());
        button(element, t('en', 'adminWorker.copy')).click();
        await updated(element);

        expect(write).toHaveBeenCalledWith(workerCommand('demo-hcm', 'bucharest', DIGEST));
        expect(deep(element, 'p[role="status"]').textContent).toBe(t('en', 'adminWorker.copied'));

        write.mockRejectedValue(new Error('denied'));
        button(element, t('en', 'adminWorker.copy')).click();
        await updated(element);
        expect(deep(element, 'p[role="status"]').textContent).toBe(t('en', 'adminWorker.copyFailed'));
        write.mockRestore();
    });

    it('happyPath_theChoiceIsChangedFromTheSegmentedButton', async () => {
        const host = new FakeHost();
        const element = await panel(host, 'ro');
        const segments = deepAll(deep(element, 'hcm-segmented-button'), 'button');

        expect(segments.map((segment) => segment.textContent.trim())).toEqual([
            t('ro', 'adminWorker.choice.auto'),
            t('ro', 'adminWorker.choice.local'),
            t('ro', 'adminWorker.choice.cloud'),
        ]);
        segments[2]?.click();
        await updated(element);
        expect(host.feed.calls).toContain('setChoice cloud');
        expect(deepText(element)).toContain('12.345 din 180.000 vCPU-secunde');
    });

    it('badPath_noComputerAStaleOneABusyOneAndAFailedLastJob', async () => {
        const host = new FakeHost();
        const element = await panel(host);
        expect(deepText(element)).toContain(t('en', 'adminWorker.none'));

        const seenAt = '2026-11-02T09:00:00.000Z';
        host.feed.set({ worker: { id: 'w-1', state: 'busy', seenAt, jobId: 'j7', lastJob: null } });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.working'));
        expect(deep(element, 'a[href="#/jobs/j7"]').textContent).toBe('j7');

        // Busy without a job yet, and no job before: nothing about jobs.
        host.feed.set({ worker: { id: 'w-1', state: 'busy', seenAt, jobId: null, lastJob: null } });
        await updated(element);
        expect(deepAll(element, 'a[href^="#/jobs/"]')).toHaveLength(0);

        host.feed.set({ worker: { id: 'w-1', state: 'idle', seenAt, jobId: null, lastJob: { id: 'j7', outcome: 'failed', at: seenAt } } });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.lastFailed', { when: '' }).slice(0, 15));
        expect(deepText(element)).toContain(t('en', 'adminWorker.lastSeen', { when: '' }).slice(0, 9));
    });

    it('badPath_withoutTheImagesDigestNoCommandButTheWayToUpdateThePipeline', async () => {
        const host = new FakeHost(view({ image: null }));
        const element = await panel(host);

        expect(deepAll(element, 'pre')).toHaveLength(0);
        expect(deepText(element)).toContain(t('en', 'adminWorker.noImage'));
        expect(deep(element, 'a[href="#/setup/pipeline"]').textContent).toBe(t('en', 'adminWorker.openSetup'));

        host.feed.set({ image: undefined });
        await updated(element);
        expect(deepAll(element, 'a[href="#/setup/pipeline"]')).toHaveLength(0);
    });

    it('badPath_aRefusalIsAnnouncedAndAStoppedListenerOffersTryAgain', async () => {
        const host = new FakeHost(view({ refusal: { key: 'apiError.imagery.versionState' } }));
        const element = await panel(host);
        expect(deep(element, '[role="alert"]').textContent).not.toBe('');

        host.feed.set({ status: 'error', failure: { kind: 'failed', code: 'internal' } });
        await updated(element);
        deep(deepAll(element, 'hcm-button').at(0) ?? element, 'button').click();
        expect(host.feed.calls).toContain('retry');
    });

    it('badPath_noAppAChunkThatDoesNotLoadAndALeavingPanelShowNothingAndStopTheFeed', async () => {
        expect(deepText(await panel(null))).toBe('');
        const failing = new FakeHost();
        failing.fails = true;
        expect(deepText(await panel(failing))).toBe('');

        const host = new FakeHost();
        const element = await panel(host);
        const first = host.feed;
        element.remove();
        expect(first.calls).toEqual(['start null', 'stop']);
        document.body.append(element);
        await updated(element);
        expect(host.feeds).toHaveLength(2);

        // A new app while the first is still answering: only the last one's feed starts.
        const next = new FakeHost();
        (element as LitElement & { app: WorkerHostPort }).app = new FakeHost();
        await element.updateComplete;
        (element as LitElement & { app: WorkerHostPort }).app = next;
        await updated(element);
        expect(next.feed.calls).toEqual(['start null']);
    });
});

describe('<hcm-run-place>', () => {
    afterEach(cleanup);

    function job(changes: Partial<NonNullable<WorkerViewPort['job']>> = {}): WorkerViewPort['job'] {
        return {
            id: 'j1',
            status: 'queued',
            runOn: 'cloud',
            waitReason: null,
            estimate: { vcpuSeconds: 12_600, gibSeconds: 50_400 },
            ...changes,
        };
    }

    it('happyPath_aCloudJobOffersTheComputerAndALocalOneTheCloud', async () => {
        const host = new FakeHost(view({ job: job() }));
        const element = await place(host);

        expect(host.feed.calls).toEqual(['start j1']);
        expect(deepText(element)).toContain(t('en', 'adminWorker.place.cloud'));
        button(element, t('en', 'adminWorker.runLocal')).click();
        expect(host.feed.calls).toContain('runJob local false');

        host.feed.set({ job: job({ runOn: 'local' }) });
        await updated(element);
        button(element, t('en', 'adminWorker.runCloud')).click();
        expect(host.feed.calls).toContain('runJob cloud false');

        host.feed.set({ job: job({ runOn: null }) });
        await updated(element);
        expect(deepText(element)).toContain(t('en', 'adminWorker.place.auto'));
        expect(deepAll(element, 'hcm-button')).toHaveLength(2);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_pastTheFreeTierItShowsTheEstimateAndTheMonthAndAsksForTheOk', async () => {
        const host = new FakeHost(view({ job: job({ waitReason: 'free-tier' }) }));
        const element = await place(host, 'ro');

        expect(deepText(element)).toContain(t('ro', 'adminWorker.estimate', { vcpu: '12.600', gib: '50.400' }));
        expect(deepText(element)).toContain(t('ro', 'adminWorker.meter'));
        button(element, t('ro', 'adminWorker.runCloudAnyway')).click();
        button(element, t('ro', 'adminWorker.runLocal')).click();
        expect(host.feed.calls).toEqual(['start j1', 'runJob cloud true', 'runJob local false']);
    });

    it('badPath_waitingForTheComputerLinksTheJobsPageAndTheCloudIsOneClickAway', async () => {
        const host = new FakeHost(view({ job: job({ runOn: 'local', waitReason: 'worker' }), acting: true }));
        const element = await place(host);

        expect(deepText(element)).toContain(t('en', 'adminWorker.waitWorker'));
        expect(deep(element, 'a[href="#/jobs"]').textContent).toBe(t('en', 'adminWorker.startWorker'));
        expect(button(element, t('en', 'adminWorker.runCloud')).hasAttribute('disabled')).toBe(true);
    });

    it('badPath_aRunningJobOrNoneShowsNothing', async () => {
        const host = new FakeHost(view({ job: job({ status: 'running' }) }));
        expect(deepText(await place(host))).toBe('');
        expect(deepText(await place(new FakeHost(view())))).toBe('');
        const empty = await fixture<LitElement & { job: string }>(html`<hcm-run-place .app=${new FakeHost()}></hcm-run-place>`);
        await updated(empty);
        expect(deepText(empty)).toBe('');
    });
});

describe('the worker chunk around its elements', () => {
    afterEach(cleanup);

    it('happyPath_aPageHasTheElementsRegisteredThroughTheJobsStore', async () => {
        const host = new FakeHost();
        loadWorkerElements(host);
        loadWorkerElements(null);
        await updated(document.body);
        expect(host.calls).toEqual(['loadPage jobs', 'workerElements']);

        const failing = new FakeHost();
        failing.fails = true;
        loadWorkerElements(failing);
        await updated(document.body);
        expect(failing.calls).toEqual(['loadPage jobs']);
    });

    it('happyPath_thePipelineCardShowsThePanelOnceAPipelineIsInstalled', async () => {
        const base = setupView({ install: installSliceView({ pipeline: { state: 'installed', installedRelease: '1.0.0' } }) });
        const state = { ...base, steps: { ...base.steps, pipeline: stepView('pipeline'), site: stepView('site') } };
        const host = new FakeHost();
        const card = await fixture<LitElement>(html`<hcm-setup-pipeline .view=${state} .app=${host} locale="en"></hcm-setup-pipeline>`);
        await updated(card);
        expect(deep(card, 'hcm-worker-panel').getAttribute('level')).toBe('3');
        expect(host.calls).toContain('workerElements');

        const none = setupView({ install: installSliceView() });
        render(
            html`<hcm-setup-pipeline .view=${{ ...none, steps: { ...none.steps, pipeline: stepView('pipeline') } }}></hcm-setup-pipeline>`,
            card.parentElement ?? document.body,
        );
        await updated(card);
    });

    it('happyPath_aWaitForTheComputerOrTheOkHasNoLineOfItsOwn', () => {
        expect(wordedWait('worker')).toBeNull();
        expect(wordedWait('free-tier')).toBeNull();
        expect(wordedWait(null)).toBeNull();
        expect(wordedWait('capacity')).toBe('capacity');
        const version = { state: 'processing' } as Parameters<typeof versionDetail>[1];
        expect(
            versionDetail('en', version, { waitReason: 'worker', retryAt: null, progress: null } as Parameters<typeof versionDetail>[2]),
        ).toBe('Processing');
    });
});
