/**
 * `<hcm-worker-machine>` (M26, `docs/research/M26-governor.md` §6; behaviour A90), the "This computer" card under the
 * worker panel's computer part once it is connected, in the lazy `worker-local` chunk: the computer's size, the owner's
 * choice (Automatic, Quiet, Full: posted to the worker, kept on that computer), the profile in force and why, the budget
 * the governor sets, and where the local AI runs (a line when no graphics card can be reached). A worker older than the
 * governor says nothing of it: the card asks to update it. The live lines are one polite region.
 */
import { DEFAULT_LOCALE, WORKER_PROFILE_CHOICES, type Locale, type WorkerMachine, type WorkerProfileChoice } from '@hcm/shared';
import { translateAdminWorkerLocal, type AdminWorkerLocalKey } from '@hcm/shared/admin-worker-local';
import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';

import { defineOnce } from '../../components/internal.js';
import { workerStyles } from './worker-element.js';
import type { LocalPort, MachineViewPort } from './worker-port.js';

export const HCM_WORKER_MACHINE_TAG = 'hcm-worker-machine';
const MB_PER_GB = 1024;

/** GB with one decimal under 10, whole above. */
function gigabytes(megabytes: number): string {
    const value = megabytes / MB_PER_GB;
    return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

export class HcmWorkerMachine extends LitElement {
    static override readonly properties = {
        local: { attribute: false },
        locale: { type: String },
        view: { state: true },
    };

    static override readonly styles = [
        ...workerStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            p {
                margin: 0;
            }
        `,
    ];

    declare local: LocalPort | null;
    declare locale: Locale;
    declare view: MachineViewPort;
    #unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.local = null;
        this.locale = DEFAULT_LOCALE;
        this.view = { kind: 'unknown' };
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

    /** Follows `local`'s machine (unknown without one). */
    #listen(local: LocalPort | null): void {
        this.#unsubscribe?.();
        this.#unsubscribe = null;
        this.view = local === null ? { kind: 'unknown' } : local.state.machine;
        if (local !== null) {
            this.#unsubscribe = local.subscribe((state) => {
                this.view = state.machine;
            });
        }
    }

    #t(key: AdminWorkerLocalKey, params?: Readonly<Record<string, string>>): string {
        return translateAdminWorkerLocal(this.locale, key, params);
    }

    override render(): TemplateResult {
        const view = this.view;
        const body = view.kind === 'known' ? this.#known(view.machine, view.failed) : this.#t(`adminWorkerLocal.machine.${view.kind}`);
        return html`<section aria-labelledby="machine-title">
            <h3 class="title" id="machine-title">${this.#t('adminWorkerLocal.machine.title')}</h3>
            ${body}
        </section>`;
    }

    #known(machine: WorkerMachine, failed: boolean): TemplateResult {
        const { budget, profile } = machine;
        const amounts = { threads: String(budget.threads), memory: gigabytes(budget.memoryMb) };
        const size = { cores: String(machine.cpu.cores), memory: gigabytes(machine.memory.totalMb) };
        return html`<p>${this.#t('adminWorkerLocal.machine.size', size)}</p>
            <hcm-segmented-button
                .label=${this.#t('adminWorkerLocal.machine.choice')}
                .options=${WORKER_PROFILE_CHOICES.map((value) => ({ value, label: this.#t(`adminWorkerLocal.machine.choice.${value}`) }))}
                .value=${profile.chosen}
                @hcm-change=${(event: CustomEvent<{ value: WorkerProfileChoice }>) => void this.local?.intents.profile(event.detail.value)}
            ></hcm-segmented-button>
            <div role="status" data-machine=${profile.active}>
                <p>
                    ${this.#t(`adminWorkerLocal.machine.active.${profile.active}`, amounts)}
                    ${this.#t(`adminWorkerLocal.machine.why.${profile.why}`)}
                </p>
                <p>${this.#t(`adminWorkerLocal.machine.matcher.${machine.backend.matcher}`)}</p>
                ${machine.backend.matcher === 'cpu' && machine.backend.why !== 'gpu-busy' ? html`<p>${this.#t('adminWorkerLocal.machine.noGpu')}</p>` : nothing}
                ${failed ? html`<p class="note">${this.#t('adminWorkerLocal.machine.failed')}</p>` : nothing}
            </div>`;
    }
}

/** Registers `<hcm-worker-machine>` (the `worker-local` chunk's `defineWorkerLocal` calls it); again, a no-op. */
export function defineWorkerMachine(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_WORKER_MACHINE_TAG, HcmWorkerMachine);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-worker-machine': HcmWorkerMachine;
    }
}
