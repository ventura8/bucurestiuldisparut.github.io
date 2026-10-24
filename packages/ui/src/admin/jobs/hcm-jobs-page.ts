/**
 * `<hcm-jobs-page>`: `#/jobs` and `#/jobs/<jobId>` (`docs/research/M2c-interfaces.md` §9.3; behaviour A18). The list of
 * the city's jobs, live, newest first, filtered by status chips; the open job's status, progress, steps, error and log
 * lines (text only), with **Cancel** while it runs (asked first). A job waiting for its date says when it may run. The
 * list and the job say "Reconnecting…" while their listener lost the server, and keep what they showed. From M3
 * (CR-M3-5, `raster-parts.ts`): why a raster job waits, Run it again on a failed one, the georeferencer on one awaiting
 * its points; while the budget guard pauses the raster work, the list pane says so with the spend and offers Resume
 * processing, asked first (CR-M3-47, `../imagery/guard-banner.ts`).
 */
import type { Locale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { current, errorTemplate, formatWhen, listBody, loadingTemplate, reconnectingStatus, whoText } from '../editing/states.js';
import { guardBanner } from '../imagery/guard-banner.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { FILTERS, jobStatusText, jobTypeText, levelText, percentOf, statusTone, stepNameText, stepStateText } from './job-text.js';
import type { JobFilterPort, JobItemPort, JobLogLinePort, JobsIntentsPort, JobsViewState } from './jobs-port.js';
import { rasterActions, waitLine } from './raster-parts.js';

export const HCM_JOBS_PAGE_TAG = 'hcm-jobs-page';

const FILTER_ORDER: readonly JobFilterPort[] = ['all', 'active', 'failed', 'done'];

/** The open job's listeners lost the server (the job's or its log's). */
function isReconnecting(detail: JobsViewState['detail']): boolean {
    return detail !== null && (detail.job.reconnecting || detail.logs.reconnecting);
}

export class HcmJobsPage extends AreaPage<JobsViewState, JobsIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, confirming: { state: true }, resumeAsked: { state: true } };

    static override readonly styles = editingStyles;

    protected readonly route: AdminRouteIdPort = 'jobs';
    /** The Cancel question is open. */
    declare confirming: boolean;
    /** The Resume processing question is open. */
    declare resumeAsked: boolean;

    constructor() {
        super();
        this.confirming = false;
        this.resumeAsked = false;
    }

    protected storeOf(content: ContentPort): AreaPort<JobsViewState, JobsIntentsPort> | null {
        return content.jobs;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const back = (): void => {
            this.go([]);
        };
        return html`<hcm-list-detail
                ?detail=${view.detail !== null}
                .detailKey=${view.detail?.id ?? ''}
                .listLabel=${contentText(locale, 'adminContent.jobs.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.jobs.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${back}
            >
                <div slot="list">${this.#list(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${this.#resumeQuestion(locale)}`;
    }

    /** Resume processing, asked first (it lets the raster work spend again this month). */
    #resumeQuestion(locale: Locale): TemplateResult {
        const close = (): void => {
            this.resumeAsked = false;
        };
        return html`<hcm-confirm-dialog
            .open=${this.resumeAsked}
            .headline=${contentText(locale, 'adminContent.imagery.confirm.resume')}
            .body=${contentText(locale, 'adminContent.imagery.confirm.resumeBody')}
            .confirmLabel=${contentText(locale, 'adminContent.imagery.guard.resume')}
            .cancelLabel=${contentText(locale, 'adminContent.common.cancel')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${() => {
                close();
                void this.intents?.resumeGuard();
            }}
            @hcm-cancel=${close}
        ></hcm-confirm-dialog>`;
    }

    #list(locale: Locale, view: JobsViewState): TemplateResult {
        const intents = this.intents;
        return html`<div class="list-head">
                <div class="chips" role="group" aria-label=${contentText(locale, 'adminContent.jobs.filterLabel')}>
                    ${FILTER_ORDER.map((filter) => this.#chip(locale, view.filter, filter))}
                </div>
                ${reconnectingStatus(locale, view.list.reconnecting)}
            </div>
            ${guardBanner(locale, view.guard, {
                off: view.resuming || this.readOnly,
                resume: () => {
                    this.resumeAsked = true;
                },
            })}
            ${listBody(
                locale,
                view.list,
                { empty: 'adminContent.jobs.empty', icon: 'pending_actions' },
                {
                    retry: () => intents?.retry(),
                    more: () => intents?.more(),
                    items: (items) =>
                        html`<ul class="rows">
                            ${items.map((job) => this.#row(locale, job, job.id === view.detail?.id))}
                        </ul>`,
                },
            )}`;
    }

    #chip(locale: Locale, selected: JobFilterPort, filter: JobFilterPort): TemplateResult {
        const choose = (event: Event): void => {
            // One filter at a time: pressing the pressed chip keeps it pressed.
            (event.currentTarget as HTMLElement & { selected: boolean }).selected = true;
            this.intents?.setFilter(filter);
        };
        return html`<hcm-chip
            .label=${contentText(locale, FILTERS[filter])}
            .selected=${filter === selected}
            @hcm-change=${choose}
        ></hcm-chip>`;
    }

    #row(locale: Locale, job: JobItemPort, selected: boolean): TemplateResult {
        const percent = percentOf(job);
        const status = jobStatusText(locale, job.status);
        const detail =
            percent === null || job.finished
                ? status
                : contentText(locale, 'adminContent.jobs.statusPercent', { status, percent: String(percent) });
        return html`<li>
            <a class="row" href=${this.href([job.id])} aria-current=${current(selected)}>
                <span class="row-title">${jobTypeText(locale, job.type)}</span>
                <span class="row-detail">${detail} · ${formatWhen(locale, job.createdAt)}</span>
            </a>
        </li>`;
    }

    #detail(locale: Locale, view: JobsViewState): TemplateResult {
        const detail = view.detail;
        if (detail === null) {
            return html`<hcm-empty-state
                icon="pending_actions"
                .text=${contentText(locale, 'adminContent.jobs.choose')}
            ></hcm-empty-state>`;
        }
        const job = detail.job;
        if (job.status === 'error') {
            return errorTemplate(locale, job.failure, () => this.intents?.retry());
        }
        if (job.doc === null) {
            return job.status === 'loading' ? loadingTemplate(locale) : this.#notFound(locale);
        }
        return this.#job(locale, view, job.doc.data, detail.logs);
    }

    #notFound(locale: Locale): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.jobs.notFound')}</h2>
            <p><a href=${this.href([])}>${contentText(locale, 'adminContent.jobs.backToList')}</a></p>
        </div>`;
    }

    #job(locale: Locale, view: JobsViewState, job: JobItemPort, logs: NonNullable<JobsViewState['detail']>['logs']): TemplateResult {
        const started = contentText(locale, 'adminContent.jobs.started', {
            who: whoText(locale, job.createdBy, this.#self()),
            date: formatWhen(locale, job.createdAt),
        });
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${jobTypeText(locale, job.type)}</h2>
            <div class="chips"><span class="tag" data-tone=${statusTone(job)}>${jobStatusText(locale, job.status)}</span></div>
            <p class="note">${started}</p>
            ${this.#waiting(locale, job)} ${waitLine(locale, job)} ${this.#progress(locale, job)} ${this.#error(locale, job)}
            ${this.#raster(locale, view, job)} ${this.#steps(locale, job)} ${reconnectingStatus(locale, isReconnecting(view.detail))}
            <h3>${contentText(locale, 'adminContent.jobs.log')}</h3>
            ${this.#logs(locale, logs.items)} ${this.#cancel(locale, view, job)}
        </div>`;
    }

    #raster(locale: Locale, view: JobsViewState, job: JobItemPort): TemplateResult {
        const retry = (): void => {
            void this.intents?.retryJob();
        };
        return rasterActions(locale, job, { retrying: view.retrying, readOnly: this.readOnly, retry });
    }

    #self(): string | null {
        return this.state?.user?.uid ?? null;
    }

    #waiting(locale: Locale, job: JobItemPort): TemplateResult {
        return job.dispatchAt === null || job.finished
            ? EMPTY
            : html`<p>${contentText(locale, 'adminContent.jobs.waiting', { date: formatWhen(locale, job.dispatchAt) })}</p>`;
    }

    #progress(locale: Locale, job: JobItemPort): TemplateResult {
        const percent = percentOf(job);
        if (percent === null || job.finished) {
            return EMPTY;
        }
        return html`<hcm-progress
            .value=${job.progress ?? 0}
            .label=${contentText(locale, 'adminContent.jobs.progress', { percent: String(percent) })}
        ></hcm-progress>`;
    }

    #error(locale: Locale, job: JobItemPort): TemplateResult {
        return job.error === null
            ? EMPTY
            : html`<p class="alert">
                  <hcm-icon name="error"></hcm-icon
                  ><span>${contentText(locale, 'adminContent.jobs.error', { message: job.error.message })}</span>
              </p>`;
    }

    #steps(locale: Locale, job: JobItemPort): TemplateResult {
        if (job.steps.length === 0) {
            return EMPTY;
        }
        return html`<h3>${contentText(locale, 'adminContent.jobs.steps')}</h3>
            <dl class="facts">
                ${job.steps.map(
                    (step) =>
                        html`<dt>${stepNameText(locale, step.name)}</dt>
                            <dd>${stepStateText(locale, step.status)}</dd>`,
                )}
            </dl>`;
    }

    #logs(locale: Locale, lines: readonly JobLogLinePort[]): TemplateResult {
        if (lines.length === 0) {
            return html`<p class="note">${contentText(locale, 'adminContent.jobs.noLog')}</p>`;
        }
        return html`<ol class="rows log" aria-label=${contentText(locale, 'adminContent.jobs.log')}>
            ${lines.map(
                (line) =>
                    html`<li class="note" data-seq=${line.seq}>
                        ${formatWhen(locale, line.at)} ·
                        ${levelText(locale, line.level)}${line.step === null ? nothing : html` · ${stepNameText(locale, line.step)}`}:
                        ${line.message}
                    </li>`,
            )}
        </ol>`;
    }

    #cancel(locale: Locale, view: JobsViewState, job: JobItemPort): TemplateResult {
        if (job.finished) {
            return EMPTY;
        }
        const ask = (): void => {
            this.confirming = true;
        };
        const confirm = (): void => {
            this.confirming = false;
            void this.intents?.cancel();
        };
        const dismiss = (): void => {
            this.confirming = false;
        };
        const label = job.cancelRequested ? 'adminContent.jobs.stopping' : 'adminContent.jobs.cancel';
        return html`<div class="actions">
                <hcm-button
                    variant="outlined"
                    icon="cancel"
                    ?disabled=${job.cancelRequested || view.cancelling || this.readOnly}
                    @click=${ask}
                    >${contentText(locale, label)}</hcm-button
                >
            </div>
            <hcm-confirm-dialog
                destructive
                .open=${this.confirming}
                .headline=${contentText(locale, 'adminContent.jobs.cancelConfirm')}
                .body=${contentText(locale, 'adminContent.jobs.cancelBody')}
                .confirmLabel=${contentText(locale, 'adminContent.jobs.cancel')}
                .cancelLabel=${contentText(locale, 'adminContent.jobs.keepRunning')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-confirm=${confirm}
                @hcm-cancel=${dismiss}
            ></hcm-confirm-dialog>`;
    }
}

/** Registers `<hcm-jobs-page>` (its kit elements are the editing kit's, `defineEditingElements`). */
export function defineHcmJobsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_JOBS_PAGE_TAG) === undefined) {
        registry.define(HCM_JOBS_PAGE_TAG, HcmJobsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-jobs-page': HcmJobsPage;
    }
}
