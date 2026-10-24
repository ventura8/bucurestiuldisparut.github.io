/**
 * The Jobs page's raster parts (`docs/research/M3-interfaces.md` §10.6; CR-M3-5): why an unfinished job waits, in
 * words (with the date it tries again), **Run it again** on a failed pipeline or publish job with attempts left, and
 * the georeferencer on a job awaiting its points. Text only.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { waitText } from '../imagery/imagery-text.js';
import { when, withValue } from '../imagery/when.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { JobItemPort } from './jobs-port.js';

export interface RasterActions {
    readonly retrying: boolean;
    readonly readOnly: boolean;
    readonly retry: () => void;
}

/** Why the unfinished job is not running, or nothing. */
export function waitLine(locale: Locale, job: JobItemPort): TemplateResult {
    if (job.finished) {
        return EMPTY;
    }
    return withValue(job.waitReason, (reason) => html`<p data-wait=${reason}>${waitText(locale, reason, job.retryAt)}</p>`);
}

/** The version a job awaiting its points opens in the georeferencer, or null. */
function awaitingPoints(job: JobItemPort): string | null {
    return job.status === 'awaiting_gcps' ? job.versionId : null;
}

function retryButton(locale: Locale, actions: RasterActions): TemplateResult {
    return html`<hcm-button
        variant="tonal"
        icon="replay"
        ?disabled=${actions.retrying || actions.readOnly}
        @click=${() => {
            actions.retry();
        }}
        >${contentText(locale, actions.retrying ? 'adminContent.jobs.retrying' : 'adminContent.jobs.retry')}</hcm-button
    >`;
}

/** Retry on a failed raster job, the georeferencer on one awaiting points; nothing for the others. */
export function rasterActions(locale: Locale, job: JobItemPort, actions: RasterActions): TemplateResult {
    const versionId = awaitingPoints(job);
    return when(
        job.retryable || versionId !== null,
        () =>
            html`<div class="actions">
                ${when(job.retryable, () => retryButton(locale, actions))}
                ${withValue(
                    versionId,
                    // A 48 px target (the kit's a.external): a bare link was 19 px high (CR-M3-35 h).
                    (id) =>
                        html`<a class="external" href=${['#/georef', id].join('/')}
                            >${contentText(locale, 'adminContent.jobs.openGeoref')}</a
                        >`,
                )}
            </div>`,
    );
}
