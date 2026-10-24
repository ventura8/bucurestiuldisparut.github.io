/**
 * A version's page (`#/imagery/version/<versionId>`, `docs/research/M3-interfaces.md` §2.2–§2.4, §10.2; behaviours A12,
 * A14, A17, A18, A42): its state, its job's progress and steps (live), why it waits, its error with what cures it (CR-M3-47:
 * **Try again** when a retry can, Setup's Mapbox step for a token or its scopes, **Upload another file** for an upload the
 * server refused, **Dismiss** for a failed version), the georeferencer, the approval card once it is rendered, the
 * preview's opacity on the map, the job's log as text, and **Cancel** while it runs (asked first; once Mapbox was asked
 * to publish, its processing cannot be stopped).
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, formatWhen, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { stepNameText, stepStateText } from '../jobs/job-text.js';
import { contentText, noticeOf } from '../shell/text.js';
import { approvalCard } from './approval-card.js';
import type { ImageryContext } from './context.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { JobLogLinePort, JobViewPort, VersionPagePort, VersionViewPort } from './imagery-port.js';
import { labelText, versionStateText, waitText } from './imagery-text.js';
import { when, withValue } from './when.js';

/** Setup's Mapbox step, where the secret token and its scopes are pasted again. */
const MAPBOX_SETUP_HREF = '#/setup/mapbox';

/** Versions the georeferencer opens: waiting for points, rendered, or published. */
const GEOREF_STATES: ReadonlySet<VersionViewPort['state']> = new Set(['needs_gcps', 'awaiting_approval', 'published']);

const TONES: Readonly<Partial<Record<VersionViewPort['state'], 'error' | 'good'>>> = {
    failed: 'error',
    rejected: 'error',
    published: 'good',
};

/** What the page shows: the version (null while only its job exists: an upload being checked) and its job. */
interface Shown {
    readonly context: ImageryContext;
    readonly page: VersionPagePort;
    readonly version: VersionViewPort | null;
    readonly job: JobViewPort | null;
}

function percentOf(job: JobViewPort): string | null {
    return job.progress === null ? null : String(Math.round(job.progress * 100));
}

function bar(locale: Locale, job: JobViewPort): TemplateResult {
    return withValue(
        percentOf(job),
        (percent) =>
            html`<hcm-progress
                .value=${job.progress}
                .label=${contentText(locale, 'adminContent.jobs.progress', { percent })}
            ></hcm-progress>`,
    );
}

function waiting(locale: Locale, job: JobViewPort): TemplateResult {
    return withValue(job.waitReason, (reason) => html`<p class="note" data-wait=${reason}>${waitText(locale, reason, job.retryAt)}</p>`);
}

function progress(locale: Locale, job: JobViewPort | null): TemplateResult {
    return withValue(job, (running) => when(!running.finished, () => html`${bar(locale, running)} ${waiting(locale, running)}`));
}

function steps(locale: Locale, job: JobViewPort | null): TemplateResult {
    return withValue(
        job,
        (shown) =>
            html`<h3>${contentText(locale, 'adminContent.jobs.steps')}</h3>
                <ol class="steps" aria-label=${contentText(locale, 'adminContent.jobs.steps')}>
                    ${shown.steps.map(
                        (step) =>
                            html`<li data-state=${step.status}>
                                <span>${stepNameText(locale, step.name)}</span>
                                <span class="note">${stepStateText(locale, step.status)}</span>
                            </li>`,
                    )}
                </ol>`,
    );
}

/** The job's error code as a notice, or null. */
function jobNotice(job: JobViewPort | null): AdminNoticeInputPort | null {
    return job?.error?.notice ?? null;
}

/** The version's error, else its job's. */
function errorNotice(version: VersionViewPort | null, job: JobViewPort | null): AdminNoticeInputPort | null {
    return version?.error ?? jobNotice(job);
}

/** The redacted technical detail of the job's error ('' for none). */
function errorDetail(job: JobViewPort | null): string {
    return job?.error?.message ?? '';
}

function failure({ context, version, job }: Shown): TemplateResult {
    const detail = errorDetail(job);
    return withValue(
        errorNotice(version, job),
        (notice) =>
            html`<div class="alert" role="alert" data-state="failed">
                <hcm-icon name="error"></hcm-icon>
                <div class="alert-body">
                    <p>${noticeOf(context.locale, notice)}</p>
                    ${when(detail !== '', () => html`<p class="detail">${detail}</p>`)}
                </div>
            </div>`,
    );
}

function retryButton({ context, page, job }: Shown): TemplateResult {
    const offered = job?.status === 'failed' && job.retryable;
    const busy = page.acting !== null || context.readOnly;
    return when(
        offered,
        () =>
            html`<hcm-button variant="tonal" icon="replay" ?disabled=${busy} @click=${() => void context.intents?.retryJob()}
                >${contentText(context.locale, 'adminContent.common.retry')}</hcm-button
            >`,
    );
}

/** An upload the server refused: the Upload view again, with nothing chosen. */
function uploadAnother({ context, job }: Shown): TemplateResult {
    const again = (): void => {
        context.intents?.resetUpload();
        context.intents?.setTab('upload');
        context.go([]);
    };
    return when(
        job?.refusedUpload === true,
        () =>
            html`<hcm-button variant="tonal" icon="upload_file" ?disabled=${context.readOnly} @click=${again}
                >${contentText(context.locale, 'adminContent.imagery.uploadAnother')}</hcm-button
            >`,
    );
}

/** A Mapbox token or scope failure: Setup's Mapbox step, where the token is pasted again. */
function mapboxSetupLink({ context, version, job }: Shown): TemplateResult {
    const key = errorNotice(version, job)?.key ?? '';
    return when(
        job?.status === 'failed' && key.startsWith('apiError.mapbox.'),
        () => html`<a href=${MAPBOX_SETUP_HREF}>${contentText(context.locale, 'adminContent.imagery.openMapboxSetup')}</a>`,
    );
}

/** A failed version leaves "Waiting for you" (`imagery.reject` dismisses it; asked first). */
function dismissButton({ context, page, version }: Shown): TemplateResult {
    return when(
        version?.state === 'failed',
        () =>
            html`<hcm-button
                variant="outlined"
                icon="close"
                ?disabled=${page.acting !== null || context.readOnly}
                @click=${() => {
                    context.ask('dismiss');
                }}
                >${contentText(context.locale, 'adminContent.imagery.dismiss')}</hcm-button
            >`,
    );
}

function georefLink({ context, version }: Shown): TemplateResult {
    const target = version !== null && version.hasScan && GEOREF_STATES.has(version.state) ? version : null;
    return withValue(
        target,
        (shown) =>
            html`<a class="external" href=${['#/georef', shown.id].join('/')}
                >${contentText(context.locale, 'adminContent.imagery.openGeoref')}</a
            >`,
    );
}

function opacity({ context, version }: Shown): TemplateResult {
    const { locale, view, intents } = context;
    const percent = Math.round(view.previewOpacity * 100);
    const label = contentText(locale, 'adminContent.imagery.previewOpacity');
    const valueText = contentText(locale, 'adminContent.layers.percent', { percent: String(percent) });
    const set = (event: Event): void => {
        intents?.setPreviewOpacity((event as CustomEvent<{ value: number }>).detail.value);
    };
    return withValue(
        version?.output ?? null,
        () =>
            html`<div class="slider-row">
                <span aria-hidden="true">${label}</span>
                <span aria-hidden="true">${valueText}</span>
                <hcm-slider
                    min="0"
                    max="100"
                    step="1"
                    .value=${percent}
                    label=${label}
                    value-text=${valueText}
                    @hcm-input=${set}
                    @hcm-change=${set}
                ></hcm-slider>
            </div>`,
    );
}

function line(locale: Locale, entry: JobLogLinePort): TemplateResult {
    const step = entry.step === null ? '' : `${stepNameText(locale, entry.step)}: `;
    return html`<li class="note" data-seq=${entry.seq}>${formatWhen(locale, entry.at)} · ${step}${entry.message}</li>`;
}

function logs(locale: Locale, lines: readonly JobLogLinePort[]): TemplateResult {
    if (lines.length === 0) {
        return html`<p class="note">${contentText(locale, 'adminContent.jobs.noLog')}</p>`;
    }
    return html`<ol class="rows log" aria-label=${contentText(locale, 'adminContent.jobs.log')}>
        ${lines.map((entry) => line(locale, entry))}
    </ol>`;
}

/** The job may be asked to stop: unfinished, and Mapbox not asked to publish yet (its processing cannot be stopped). */
function stoppable(job: JobViewPort | null): job is JobViewPort {
    return job !== null && !job.finished && !job.atMapbox;
}

function cancel({ context, page, job }: Shown): TemplateResult {
    if (!stoppable(job)) {
        return html``;
    }
    const label = job.cancelRequested ? 'adminContent.jobs.stopping' : 'adminContent.jobs.cancel';
    const off = job.cancelRequested || page.acting !== null || context.readOnly;
    return html`<div class="actions">
        <hcm-button
            variant="outlined"
            icon="cancel"
            ?disabled=${off}
            @click=${() => {
                context.ask('cancel');
            }}
            >${contentText(context.locale, label)}</hcm-button
        >
    </div>`;
}

function refusal({ context, page }: Shown): TemplateResult {
    return withValue(
        page.refusal,
        (notice) =>
            html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span></p>`,
    );
}

/**
 * The card waits for a decision: a rendered version before Approve, or an approved one (by the admin or by the policy)
 * whose publish the compute-unit guard stopped, which waits for one of its three choices (CR-M3-33).
 */
function awaitsDecision(version: VersionViewPort): boolean {
    const stopped = version.guard !== null && version.guard.verdict !== 'within';
    return version.state === 'awaiting_approval' || (version.state === 'approved' && stopped);
}

/** The approval card while it waits, the layer's link once published. */
function outcome(shown: Shown): TemplateResult {
    const { context, page, version } = shown;
    if (version !== null && awaitsDecision(version)) {
        return approvalCard(context, page, version);
    }
    return withValue(
        version?.state === 'published' ? version : null,
        (published) =>
            html`<p>
                <a href=${['#/layers', published.layerId].join('/')}>${contentText(context.locale, 'adminContent.imagery.openLayer')}</a>
            </p>`,
    );
}

/** The version's title: its label, and its year when the label does not say it already ("KH-4A Corona, 12 July 1966"). */
function titleOf(version: VersionViewPort, locale: Locale): string {
    const label = labelText(version.label, locale);
    const year = String(version.year);
    return label.includes(year) ? label : `${label} · ${year}`;
}

function heading({ context, version }: Shown): TemplateResult {
    const { locale } = context;
    if (version === null) {
        return html`<h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.imagery.versionChecking')}</h2>`;
    }
    return html`<h2 tabindex="-1" data-detail-heading>${titleOf(version, locale)}</h2>
        <div class="chips">
            <span class="tag" data-tone=${TONES[version.state] ?? 'wait'}>${versionStateText(locale, version.state)}</span>
        </div>`;
}

/** What the page is in: the version's state, else its job's status. */
function stateOf(version: VersionViewPort | null, job: JobViewPort | null): string {
    return version?.state ?? job?.status ?? '';
}

function body(shown: Shown): TemplateResult {
    const { context, page, version, job } = shown;
    const { locale } = context;
    const reconnecting = page.version.reconnecting || page.job.reconnecting;
    return html`<div class="pane" data-version=${page.id} data-state=${stateOf(version, job)}>
        ${heading(shown)} ${reconnectingStatus(locale, reconnecting)} ${progress(locale, job)} ${failure(shown)}
        <div class="actions">
            ${retryButton(shown)} ${uploadAnother(shown)} ${mapboxSetupLink(shown)} ${georefLink(shown)} ${dismissButton(shown)}
        </div>
        ${refusal(shown)} ${outcome(shown)} ${opacity(shown)} ${steps(locale, job)}
        <h3>${contentText(locale, 'adminContent.jobs.log')}</h3>
        ${logs(locale, page.logs.items)} ${cancel(shown)}
    </div>`;
}

function notFound(context: ImageryContext): TemplateResult {
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${contentText(context.locale, 'adminContent.imagery.versionNotFound')}</h2>
        <p><a href=${context.href([])}>${contentText(context.locale, 'adminContent.imagery.backToList')}</a></p>
    </div>`;
}

/** Read: the version's listener answered (or failed). */
function settled(page: VersionPagePort): boolean {
    return page.version.status !== 'loading' && page.job.status !== 'loading';
}

function shownOf(context: ImageryContext, page: VersionPagePort): Shown {
    return { context, page, version: page.version.doc?.data ?? null, job: page.job.doc?.data ?? null };
}

function readPage(context: ImageryContext, page: VersionPagePort): TemplateResult {
    if (page.version.status === 'error') {
        return errorTemplate(context.locale, page.version.failure, () => context.intents?.retry());
    }
    const shown = shownOf(context, page);
    return shown.version === null && shown.job === null ? notFound(context) : body(shown);
}

export function versionDetail(context: ImageryContext, page: VersionPagePort | null): TemplateResult {
    return page !== null && settled(page) ? readPage(context, page) : loadingTemplate(context.locale);
}
