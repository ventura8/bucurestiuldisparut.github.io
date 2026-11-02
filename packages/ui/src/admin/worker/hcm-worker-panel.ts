/**
 * `<hcm-worker-panel>` (`docs/research/M7-local-worker.md` §1.1, §4.4, §7; behaviours A62, A63), on the Jobs page and the
 * pipeline card: whether the city's computer is connected (when it was last seen, the job it works on or how its last one
 * ended), the docker command that starts a worker with the pipeline's image by digest (Copy, said in a polite region; the
 * worker's local page; the work folder and the gcloud alternative), or, without a recorded digest, "update the imagery
 * pipeline first" and no command; the city's choice of where new jobs run; and this month's Cloud Run use.
 *
 * Findings 66–68 of 2026-11-02 ("make all of this automagic"): the command is one line that needs no preparation (a
 * Docker named volume, not a folder; detached, named, `--restart unless-stopped`; it first removes an older worker, so
 * the same line also updates it), written for the owner's system (Linux or macOS, Windows PowerShell), with a one-time
 * pairing code that signs the computer in (no browser sign-in), and "Docker is not installed? Get Docker". A connected
 * worker shows its job's step and progress live, says when its image is outdated, and has Disconnect this computer.
 */
import { PIPELINE_REPOSITORY, RUN_CHOICES, WORKER_CONTAINER, WORKER_PORT, type RunChoice } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { copyToClipboard } from '../setup/setup-body.js';
import { errorTemplate, formatWhen } from '../editing/states.js';
import type { WorkerSeenPort, WorkerViewPort } from './worker-port.js';
import { meter, WorkerElement, workerStyles } from './worker-element.js';

export const HCM_WORKER_PANEL_TAG = 'hcm-worker-panel';

/** The worker's local page, on the computer's loopback (`localhost`): its state, and the fallback sign-in. */
export const WORKER_PAGE = `http://localhost:${String(WORKER_PORT)}/`;
/** Docker's own page of installers for every system. */
export const GET_DOCKER_URL = 'https://docs.docker.com/get-started/get-docker/';

/** The shells the command is written for. */
const WORKER_SHELLS = ['posix', 'powershell'] as const;
export type WorkerShell = (typeof WORKER_SHELLS)[number];

/** Each shell's way to drop the old container's "no such container" quietly. */
const QUIET: Readonly<Record<WorkerShell, string>> = { posix: '2>&1 | true', powershell: '2>&1 | Out-Null' };

const SHELL_TEXT = { posix: 'adminWorker.shell.posix', powershell: 'adminWorker.shell.powershell' } as const;

/** The shell of the computer the admin is open on: PowerShell on Windows, else a POSIX shell. */
export function defaultShell(userAgent: string): WorkerShell {
    return /Windows/i.test(userAgent) ? 'powershell' : 'posix';
}

/** What the command names. */
export interface WorkerCommandInput {
    readonly project: string;
    readonly city: string;
    readonly digest: string;
    /** The one-time pairing code; null: the command carries none (the page's sign-in then). */
    readonly code: string | null;
    readonly shell: WorkerShell;
}

const CHOICE_TEXT = {
    auto: 'adminWorker.choice.auto',
    local: 'adminWorker.choice.local',
    cloud: 'adminWorker.choice.cloud',
} as const satisfies Readonly<Record<RunChoice, string>>;

/**
 * The one line that starts (or replaces) the city's worker with the pipeline's image by digest (§1.1, finding 66): the
 * old container removed, the new one detached, named, restarted with the computer, its page on the loopback only, its
 * work folder and paired session in the named volume `hcm-worker`, and (finding 67) the pairing code.
 */
export function workerCommand(input: WorkerCommandInput): string {
    const { project, city, digest, code, shell } = input;
    const image = `us-central1-docker.pkg.dev/${project}/${PIPELINE_REPOSITORY}/pipeline@${digest}`;
    const port = String(WORKER_PORT);
    const run = `docker run -d --name ${WORKER_CONTAINER} --restart unless-stopped -p 127.0.0.1:${port}:${port} -v ${WORKER_CONTAINER}:/work`;
    const pair = code === null ? '' : ` --pair ${code}`;
    return `docker rm -f ${WORKER_CONTAINER} ${QUIET[shell]}; ${run} ${image} worker --city ${city} --project ${project}${pair}`;
}

export class HcmWorkerPanel extends WorkerElement {
    static override readonly properties = {
        ...WorkerElement.properties,
        project: { type: String },
        level: { type: Number },
        copied: { state: true },
        shell: { state: true },
    };

    static override readonly styles = workerStyles;

    /** The project the command names. */
    declare project: string;
    /** The panel's heading level (2 on the Jobs page, 3 in a Setup card). */
    declare level: number;
    /** Whether Copy worked (null: not asked yet). */
    declare copied: boolean | null;
    /** The shell the command is written for (the admin's own system's, until the owner picks the other). */
    declare shell: WorkerShell;
    protected readonly jobId = null;

    constructor() {
        super();
        this.project = '';
        this.level = 2;
        this.copied = null;
        this.shell = defaultShell(navigator.userAgent);
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
            ${this.#job(view, worker)} ${this.#outdated(view, worker)} ${this.#disconnect(view, worker)}`;
    }

    /** Finding 67: a connected worker whose image is not the installed one takes no job until the command runs again. */
    #outdated(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        return view.connected && worker.outdated ? html`<p class="alert" data-outdated>${this.t('adminWorker.outdated')}</p>` : html``;
    }

    /** Disconnect this computer (`worker.revoke`): for a worker not disconnected yet. */
    #disconnect(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        if (worker.revoked) {
            return html`<p class="note">${this.t('adminWorker.disconnected')}</p>`;
        }
        return html`<div class="actions">
            <hcm-button variant="text" icon="link_off" ?disabled=${view.acting} @click=${() => void this.feed?.intents.disconnect()}
                >${this.t('adminWorker.disconnect')}</hcm-button
            >
        </div>`;
    }

    /** The job it works on (a link, its step and progress live), else how its last one ended. */
    #job(view: WorkerViewPort, worker: WorkerSeenPort): TemplateResult {
        if (worker.state === 'busy' && worker.jobId !== null) {
            const href = ['#/jobs', worker.jobId].join('/');
            return html`<p>${this.t('adminWorker.working')} <a href=${href}>${worker.jobId}</a></p>
                ${this.#progress(view, worker.jobId)}`;
        }
        const last = worker.lastJob;
        if (last === null) {
            return html``;
        }
        const key = last.outcome === 'done' ? 'adminWorker.lastDone' : 'adminWorker.lastFailed';
        return html`<p class="note">${this.t(key, { when: formatWhen(this.locale, last.at) })}</p>`;
    }

    /** Finding 68: the connected worker's job as it runs: its step and how far it got. */
    #progress(view: WorkerViewPort, jobId: string): TemplateResult {
        const job = view.job;
        if (job?.id !== jobId || job.step === null) {
            return html``;
        }
        const progress = job.progress ?? 0;
        const said = this.t('adminWorker.progress', { step: job.step, percent: String(Math.round(progress * 100)) });
        return html`<hcm-progress .value=${progress} .label=${said}></hcm-progress>
            <p class="note" data-progress>${said}</p>`;
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
        const command = workerCommand({ project: this.project, city: view.city, digest: image, code: view.pairCode, shell: this.shell });
        return html`<p>${this.t('adminWorker.intro')}</p>
            <hcm-segmented-button
                .label=${this.t('adminWorker.shell')}
                .options=${WORKER_SHELLS.map((value) => ({ value, label: this.t(SHELL_TEXT[value]) }))}
                .value=${this.shell}
                @hcm-change=${(event: CustomEvent<{ value: WorkerShell }>) => {
                    this.shell = event.detail.value;
                }}
            ></hcm-segmented-button>
            <pre class="text" aria-label=${this.t('adminWorker.command')}>${command}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${() => void this.#copy(command)}
                    >${this.t('adminWorker.copy')}</hcm-button
                >
                <a class="external" href=${WORKER_PAGE} target="_blank" rel="noopener noreferrer">${this.t('adminWorker.open')}</a>
            </div>
            <p class="note" role="status">${this.#copiedText()}</p>
            <ul class="note">
                <li>${this.t(view.pairCode === null ? 'adminWorker.noteNoPair' : 'adminWorker.notePair')}</li>
                <li>${this.t('adminWorker.noteBackground')}</li>
                <li>
                    ${this.t('adminWorker.noDocker')}
                    <a class="external" href=${GET_DOCKER_URL} target="_blank" rel="noopener noreferrer"
                        >${this.t('adminWorker.getDocker')}</a
                    >
                </li>
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
