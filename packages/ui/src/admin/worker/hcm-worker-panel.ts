/**
 * `<hcm-worker-panel>` (`docs/research/M7-local-worker.md` §1.1, §4.4, §7; behaviours A62, A63), on the Jobs page and the
 * pipeline card: whether the city's computer is connected (when it was last seen, the job it works on or how its last one
 * ended), the docker command that starts a worker with the pipeline's image by digest (Copy, said in a polite region; the
 * worker's local page; the work folder and the gcloud alternative), or, without a recorded digest, "update the imagery
 * pipeline first" and no command; the city's choice of where new jobs run; and this month's Cloud Run use.
 */
import { PIPELINE_REPOSITORY, RUN_CHOICES, WORKER_PORT, type RunChoice } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { copyToClipboard } from '../setup/setup-body.js';
import { errorTemplate, formatWhen } from '../editing/states.js';
import type { WorkerSeenPort, WorkerViewPort } from './worker-port.js';
import { meter, WorkerElement, workerStyles } from './worker-element.js';

export const HCM_WORKER_PANEL_TAG = 'hcm-worker-panel';

/** The worker's local page, on the computer's loopback (`localhost`: Firebase Auth authorizes it by default). */
export const WORKER_PAGE = `http://localhost:${String(WORKER_PORT)}/`;

const CHOICE_TEXT = {
    auto: 'adminWorker.choice.auto',
    local: 'adminWorker.choice.local',
    cloud: 'adminWorker.choice.cloud',
} as const satisfies Readonly<Record<RunChoice, string>>;

/** The command that starts a worker for `city` of `project` with the pipeline's image `digest` (§1.1). */
export function workerCommand(project: string, city: string, digest: string): string {
    const image = `us-central1-docker.pkg.dev/${project}/${PIPELINE_REPOSITORY}/pipeline@${digest}`;
    return `docker run --rm -p 127.0.0.1:${String(WORKER_PORT)}:${String(WORKER_PORT)} -v "$HOME/hcm-worker:/work" ${image} worker --city ${city} --project ${project}`;
}

export class HcmWorkerPanel extends WorkerElement {
    static override readonly properties = {
        ...WorkerElement.properties,
        project: { type: String },
        level: { type: Number },
        copied: { state: true },
    };

    static override readonly styles = workerStyles;

    /** The project the command names. */
    declare project: string;
    /** The panel's heading level (2 on the Jobs page, 3 in a Setup card). */
    declare level: number;
    /** Whether Copy worked (null: not asked yet). */
    declare copied: boolean | null;
    protected readonly jobId = null;

    constructor() {
        super();
        this.project = '';
        this.level = 2;
        this.copied = null;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        return html`<section aria-labelledby="worker-title" data-worker=${view.connected ? 'connected' : 'none'}>
            <div class="title" role="heading" aria-level=${this.level} id="worker-title">${this.t('adminWorker.title')}</div>
            ${this.#status(view)} ${this.#command(view)}
            <p id="choice">${this.t('adminWorker.choice')}</p>
            <hcm-segmented-button
                .label=${this.t('adminWorker.choice')}
                .options=${RUN_CHOICES.map((value) => ({ value, label: this.t(CHOICE_TEXT[value]) }))}
                .value=${view.choice}
                @hcm-change=${(event: CustomEvent<{ value: RunChoice }>) => void this.feed?.intents.setChoice(event.detail.value)}
            ></hcm-segmented-button>
            ${this.refusal(view)} ${meter(this.locale, view.usage)}
        </section>`;
    }

    #status(view: WorkerViewPort): TemplateResult {
        if (view.status === 'error') {
            return errorTemplate(this.locale, view.failure, () => this.feed?.intents.retry());
        }
        const worker = view.worker;
        if (worker === null) {
            return html`<p>${this.t('adminWorker.none')}</p>`;
        }
        const when = formatWhen(this.locale, worker.seenAt);
        const line = view.connected
            ? this.t('adminWorker.connected', { when })
            : `${this.t('adminWorker.none')} ${this.t('adminWorker.lastSeen', { when })}`;
        return html`<p>${line}</p>
            ${this.#job(worker)}`;
    }

    /** The job it works on (a link), else how its last one ended. */
    #job(worker: WorkerSeenPort): TemplateResult {
        if (worker.state === 'busy' && worker.jobId !== null) {
            const href = ['#/jobs', worker.jobId].join('/');
            return html`<p>${this.t('adminWorker.working')} <a href=${href}>${worker.jobId}</a></p>`;
        }
        const last = worker.lastJob;
        if (last === null) {
            return html``;
        }
        const key = last.outcome === 'done' ? 'adminWorker.lastDone' : 'adminWorker.lastFailed';
        return html`<p class="note">${this.t(key, { when: formatWhen(this.locale, last.at) })}</p>`;
    }

    #command(view: WorkerViewPort): TemplateResult {
        const image = view.image;
        if (image === undefined) {
            return html``;
        }
        if (image === null) {
            return html`<p>${this.t('adminWorker.noImage')}</p>
                <a class="external" href="#/setup/pipeline">${this.t('adminWorker.openSetup')}</a>`;
        }
        const command = workerCommand(this.project, view.city, image);
        return html`<p>${this.t('adminWorker.intro')}</p>
            <pre class="text" aria-label=${this.t('adminWorker.command')}>${command}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${() => void this.#copy(command)}
                    >${this.t('adminWorker.copy')}</hcm-button
                >
                <a class="external" href=${WORKER_PAGE} target="_blank" rel="noopener noreferrer">${this.t('adminWorker.open')}</a>
            </div>
            <p class="note" role="status">${this.#copiedText()}</p>
            <ul class="note">
                <li>${this.t('adminWorker.noteFolder')}</li>
                <li>${this.t('adminWorker.noteGcloud')}</li>
            </ul>`;
    }

    #copiedText(): string {
        if (this.copied === null) {
            return '';
        }
        return this.t(this.copied ? 'adminWorker.copied' : 'adminWorker.copyFailed');
    }

    async #copy(command: string): Promise<void> {
        this.copied = null;
        this.copied = await copyToClipboard(command, navigator.clipboard);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-panel': HcmWorkerPanel;
    }
}
