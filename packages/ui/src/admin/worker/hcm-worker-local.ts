/**
 * `<hcm-worker-local>` (finding 72 of 2026-11-02, `docs/research/M7-local-worker.md` §1.5, §2.7; behaviour A62), the worker
 * panel's part about the computer the admin is open on, in the lazy `worker-local` chunk: the system (picked from the
 * browser's), **Use this computer** (the starter file is saved, then one sentence says how to open it), the auto-pair's
 * "Connecting this computer…" and "This computer is connected" in a polite region, "Docker is not installed? Get Docker",
 * **Stop using this computer** (the removal file; the computer's worker disconnected), and behind **Advanced** the
 * copyable command of finding 66 with its one-time code (Copy, the worker's page, the gcloud note).
 */
import { PIPELINE_REPOSITORY, WORKER_CONTAINER, WORKER_PORT, DEFAULT_LOCALE, type Locale } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { copyToClipboard } from '../setup/setup-body.js';
import { workerStyles } from './worker-element.js';
import type { LocalPort, LocalViewPort, StarterFilePort, WorkerOsPort } from './worker-port.js';

export const HCM_WORKER_LOCAL_TAG = 'hcm-worker-local';

/** The worker's local page, on the computer's loopback (`localhost`): its state, and the fallback sign-in. */
export const WORKER_PAGE = `http://localhost:${String(WORKER_PORT)}/`;
/** Docker's own page of installers for every system. */
export const GET_DOCKER_URL = 'https://docs.docker.com/get-started/get-docker/';

const OSES: readonly WorkerOsPort[] = ['linux', 'mac', 'windows'];

/** The words under the button, by phase (nothing before the first click). */
const PHASE_TEXT: Readonly<Partial<Record<LocalViewPort['phase'], AdminWorkerLocalKey>>> = {
    connecting: 'adminWorkerLocal.connecting',
    connected: 'adminWorkerLocal.connected',
    stopped: 'adminWorkerLocal.stopped',
    failed: 'adminWorkerLocal.failed',
};

/** What the command names. */
export interface WorkerCommandInput {
    readonly project: string;
    readonly city: string;
    readonly digest: string;
    /** The one-time pairing code; null: the command carries none (the page's sign-in then). */
    readonly code: string | null;
    readonly os: WorkerOsPort;
}

/**
 * The one line that starts (or replaces) the city's worker with the pipeline's image by digest (finding 66): the old
 * container removed (quietly: `2>&1 | true`, or `| Out-Null` in Windows PowerShell), the new one detached, named, restarted
 * with the computer, its page on the loopback only, its work folder and paired session in the named volume, the code.
 */
export function workerCommand(input: WorkerCommandInput): string {
    const { project, city, digest, code, os } = input;
    const image = `us-central1-docker.pkg.dev/${project}/${PIPELINE_REPOSITORY}/pipeline@${digest}`;
    const port = String(WORKER_PORT);
    const run = `docker run -d --name ${WORKER_CONTAINER} --restart unless-stopped -p 127.0.0.1:${port}:${port} -v ${WORKER_CONTAINER}:/work`;
    const quiet = os === 'windows' ? '2>&1 | Out-Null' : '2>&1 | true';
    const pair = code === null ? '' : ` --pair ${code}`;
    return `docker rm -f ${WORKER_CONTAINER} ${quiet}; ${run} ${image} worker --city ${city} --project ${project}${pair}`;
}

/** Saves `file` as the browser's download (a Blob behind a short-lived link). */
function save(file: StarterFilePort): void {
    const url = URL.createObjectURL(new Blob([file.text], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export class HcmWorkerLocal extends LitElement {
    static override readonly properties = {
        local: { attribute: false },
        locale: { type: String },
        project: { type: String },
        city: { type: String },
        image: { type: String },
        view: { state: true },
        copied: { state: true },
    };

    static override readonly styles = [
        ...workerStyles,
        css`
            /* The panel's own rhythm (its section's gap), so no touch target reaches the next line. */
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .advanced {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            details > summary {
                box-sizing: border-box;
                min-block-size: 48px;
                padding-block: 14px;
                cursor: pointer;
            }
        `,
    ];

    declare local: LocalPort | null;
    declare locale: Locale;
    declare project: string;
    declare city: string;
    /** The pipeline image's digest the command names. */
    declare image: string;
    declare view: LocalViewPort | null;
    /** Whether Copy worked (null: not asked yet). */
    declare copied: boolean | null;
    #unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.local = null;
        this.locale = DEFAULT_LOCALE;
        this.project = '';
        this.city = '';
        this.image = '';
        this.view = null;
        this.copied = null;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unsubscribe?.();
        this.#unsubscribe = null;
    }

    protected override willUpdate(changed: PropertyValues): void {
        if (changed.has('local')) {
            this.#listen(this.local);
        }
    }

    /** Follows `local`'s state (nothing without one). */
    #listen(local: LocalPort | null): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.view = local === null ? null : local.state;
        if (local !== null) {
            this.#unsubscribe = local.subscribe((state) => {
                this.view = state;
            });
        }
    }

    #t(key: AdminWorkerLocalKey): string {
        return translateAdminWorkerLocal(this.locale, key);
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return html``;
        }
        return html`<p>${this.#t('adminWorkerLocal.intro')}</p>
            <hcm-segmented-button
                .label=${this.#t('adminWorkerLocal.os')}
                .options=${OSES.map((value) => ({ value, label: this.#t(`adminWorkerLocal.os.${value}`) }))}
                .value=${view.os}
                @hcm-change=${(event: CustomEvent<{ value: WorkerOsPort }>) => {
                    this.local?.intents.setOs(event.detail.value);
                }}
            ></hcm-segmented-button>
            <div class="actions">
                <hcm-button variant="filled" icon="download" @click=${() => void this.#give(this.local?.intents.use())}
                    >${this.#t('adminWorkerLocal.use')}</hcm-button
                >
            </div>
            <p class="note" role="status" data-local=${view.phase}>${this.#phase(view)}</p>
            <ul class="note">
                <li>
                    ${this.#t('adminWorkerLocal.noDocker')}
                    <a class="external" href=${GET_DOCKER_URL} target="_blank" rel="noopener noreferrer"
                        >${this.#t('adminWorkerLocal.getDocker')}</a
                    >
                </li>
            </ul>
            <div class="actions">
                <hcm-button variant="text" icon="delete" @click=${() => void this.#give(this.local?.intents.stop())}
                    >${this.#t('adminWorkerLocal.stop')}</hcm-button
                >
            </div>
            <details
                @toggle=${(event: Event) => {
                    this.#advanced(event);
                }}
            >
                <summary>${this.#t('adminWorkerLocal.advanced')}</summary>
                <div class="advanced">${this.#command(view)}</div>
            </details>`;
    }

    /** The phase's words; after the file was given, how to open it on the chosen system. */
    #phase(view: LocalViewPort): string {
        const key = view.phase === 'downloaded' ? (`adminWorkerLocal.open.${view.os}` as const) : PHASE_TEXT[view.phase];
        return key === undefined ? '' : this.#t(key);
    }

    async #give(pending: Promise<StarterFilePort | null> | undefined): Promise<void> {
        const file = (await pending) ?? null;
        if (file !== null) {
            save(file);
        }
    }

    /** Opening Advanced asks for the command's one-time code. */
    #advanced(event: Event): void {
        const open = (event.target as HTMLDetailsElement).open;
        if (open && this.view?.code === null) {
            void this.local?.intents.command();
        }
    }

    #command(view: LocalViewPort): TemplateResult {
        const command = workerCommand({ project: this.project, city: this.city, digest: this.image, code: view.code, os: view.os });
        return html`<p>${this.#t('adminWorkerLocal.commandIntro')}</p>
            <pre class="text" aria-label=${this.#t('adminWorkerLocal.command')}>${command}</pre>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${() => void this.#copy(command)}
                    >${this.#t('adminWorkerLocal.copy')}</hcm-button
                >
                <a class="external" href=${WORKER_PAGE} target="_blank" rel="noopener noreferrer">${this.#t('adminWorkerLocal.page')}</a>
            </div>
            <p class="note" role="status">${this.#copiedText()}</p>
            <ul class="note">
                <li>${this.#t('adminWorkerLocal.notePair')}</li>
                <li>${this.#t('adminWorkerLocal.noteGcloud')}</li>
            </ul>`;
    }

    #copiedText(): string {
        if (this.copied === null) {
            return '';
        }
        return this.#t(this.copied ? 'adminWorkerLocal.copied' : 'adminWorkerLocal.copyFailed');
    }

    async #copy(command: string): Promise<void> {
        this.copied = null;
        this.copied = await copyToClipboard(command, navigator.clipboard);
    }
}

/** Registers `<hcm-worker-local>` (its kit elements are the panel's, registered with it); again, a no-op. */
export function defineWorkerLocal(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_WORKER_LOCAL_TAG, HcmWorkerLocal);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-local': HcmWorkerLocal;
    }
}
