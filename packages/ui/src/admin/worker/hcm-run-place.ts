/**
 * `<hcm-run-place>` (`docs/research/M7-local-worker.md` §3, §4.3, §7; behaviours A62, A63), on the page of an unfinished
 * version whose job holds no run (`queued`, `waiting_usgs`, `awaiting_gcps`): where the job runs and the switch to the
 * other place (`imagery.runOn` with the job). A cloud job waiting for the admin's OK past the free tier (`free-tier`)
 * shows the run's estimate and the month's use, with **Run in Google Cloud anyway** (the OK) and **Run on my computer**;
 * a job waiting for the computer (`worker`) says so and links the Jobs page, where the worker's command is.
 */
import type { JobStatus, RunPlace } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { WorkerJobPort, WorkerViewPort } from './worker-port.js';
import { count, meter, WorkerElement, workerStyles } from './worker-element.js';

export const HCM_RUN_PLACE_TAG = 'hcm-run-place';

/** The statuses of a job that holds no run, whose place may change. */
const PLACEABLE: ReadonlySet<JobStatus> = new Set<JobStatus>(['queued', 'waiting_usgs', 'awaiting_gcps']);

const PLACE_TEXT = { local: 'adminWorker.place.local', cloud: 'adminWorker.place.cloud' } as const;

/** Each button's words: on the computer; in the cloud; in the cloud with the OK past the free tier. */
const BUTTON_TEXT = { local: 'adminWorker.runLocal', cloud: 'adminWorker.runCloud', ok: 'adminWorker.runCloudAnyway' } as const;

/** The feed's job while its place may change, else null. */
function placeable(view: WorkerViewPort | null): WorkerJobPort | null {
    const job = view?.job ?? null;
    return job !== null && PLACEABLE.has(job.status) ? job : null;
}

export class HcmRunPlace extends WorkerElement {
    static override readonly properties = { ...WorkerElement.properties, job: { type: String } };

    static override readonly styles = workerStyles;

    /** The version's job id. */
    declare job: string;

    constructor() {
        super();
        this.job = '';
    }

    protected get jobId(): string | null {
        return this.job === '' ? null : this.job;
    }

    override render(): TemplateResult {
        const view = this.view;
        const job = placeable(view);
        if (view === null || job === null) {
            return html``;
        }
        return html`<section aria-labelledby="place-title" data-run-on=${job.runOn ?? 'auto'}>
            <h3 id="place-title">${this.t('adminWorker.place')}</h3>
            ${this.#body(view, job)} ${this.refusal(view)}
        </section>`;
    }

    #body(view: WorkerViewPort, job: WorkerJobPort): TemplateResult {
        if (job.waitReason === 'free-tier') {
            const estimate = { vcpu: count(this.locale, job.estimate.vcpuSeconds), gib: count(this.locale, job.estimate.gibSeconds) };
            return html`<p>${this.t('adminWorker.freeTier')}</p>
                <p>${this.t('adminWorker.estimate', estimate)}</p>
                ${meter(this.locale, view.usage)}
                <div class="actions">${this.#button(view, 'cloud', true)} ${this.#button(view, 'local', false)}</div>`;
        }
        if (job.waitReason === 'worker') {
            return html`<p>${this.t('adminWorker.waitWorker')}</p>
                <a class="external" href="#/jobs">${this.t('adminWorker.startWorker')}</a>
                <div class="actions">${this.#button(view, 'cloud', false)}</div>`;
        }
        const places: readonly RunPlace[] = (['local', 'cloud'] as const).filter((place) => place !== job.runOn);
        return html`<p>${this.t(job.runOn === null ? 'adminWorker.place.auto' : PLACE_TEXT[job.runOn])}</p>
            <div class="actions">${places.map((place) => this.#button(view, place, false))}</div>`;
    }

    /** Run on my computer, Run in Google Cloud, or Run in Google Cloud anyway (the OK past the free tier). */
    #button(view: WorkerViewPort, place: RunPlace, freeTierOk: boolean): TemplateResult {
        const label = BUTTON_TEXT[freeTierOk ? 'ok' : place];
        return html`<hcm-button
            variant=${freeTierOk ? 'filled' : 'tonal'}
            icon=${place === 'local' ? 'play_arrow' : 'cloud'}
            ?disabled=${view.acting}
            @click=${() => void this.feed?.intents.runJob(place, freeTierOk)}
            >${this.t(label)}</hcm-button
        >`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-run-place': HcmRunPlace;
    }
}
