/**
 * The approval card of a rendered version (`docs/research/M3-interfaces.md` §7, §10.2; behaviours A17, A42, A73): the checkpoint error
 * against the city's threshold in words, the pairs it comes from, what publishing costs, then **Approve** (or Reject, asked first). M12
 * (`docs/research/M12-own-tiles.md`): by default a layer's tiles go to the city's own public bucket, and the card says what that costs in
 * the owner's words (`image-view.ts`): no compute units, Studio steps or choices. A city that publishes through Mapbox sees those from
 * the `mapbox-choices` chunk. M8: a join's section says what it measured (`join/join-card.ts`), and M9 there too: why a frame under the
 * threshold still waits.
 */
import { recalibrationVerdict, type Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionPagePort, VersionViewPort } from './imagery-port.js';
import { ownCost } from './image-view.js';
import { numberText } from './imagery-text.js';
import { lazyJoin } from './join/lazy-card.js';
import { lazyMapboxChoices } from './lazy-approval.js';
import type { Guard } from './mapbox-choices.js';
import { withValue } from './when.js';

/** The page is busy with another action, or nothing may be written. */
function busy(context: ImageryContext, page: VersionPagePort): boolean {
    return page.acting !== null || context.readOnly;
}

function measured(context: ImageryContext, rmse: number): TemplateResult {
    const { locale, view } = context;
    const over = rmse > view.settings.rmseThresholdM;
    const key = over ? 'adminContent.imagery.approval.rmseOver' : 'adminContent.imagery.approval.rmseUnder';
    const text = contentText(locale, key, { rmse: numberText(locale, rmse), threshold: numberText(locale, view.settings.rmseThresholdM) });
    return over ? html`<p class="alert" data-rmse="over">${text}</p>` : html`<p data-rmse="under">${text}</p>`;
}

/** The checkpoint error. M8: a join has no georeference of its own; its figure is its worst frame's. */
function checkpointOf(version: VersionViewPort): number | null {
    return version.georef?.checkpointRmseM ?? version.join?.checkpointRmseM ?? null;
}

function rmseText(context: ImageryContext, version: VersionViewPort): TemplateResult {
    const rmse = checkpointOf(version);
    return rmse === null
        ? html`<p class="note" data-rmse="unmeasured">${contentText(context.locale, 'adminContent.imagery.approval.unmeasured')}</p>`
        : measured(context, rmse);
}

function pairsText(locale: Locale, version: VersionViewPort): TemplateResult {
    return withValue(
        version.georef,
        (georef) =>
            html`<p class="note">
                ${contentText(locale, 'adminContent.imagery.approval.pairs', {
                    pairs: String(georef.pairs),
                    checks: String(georef.checkpointCount ?? 0),
                })}
            </p>`,
    );
}

/** Delete this image? (`imagery.reject`): waiting for approval, and (M18 item 5) approved but stopped at the guard. */
function deleteButton(context: ImageryContext, page: VersionPagePort): TemplateResult {
    return html`<hcm-button
        variant="outlined"
        icon="close"
        ?disabled=${busy(context, page)}
        @click=${() => {
            context.ask('reject');
        }}
        >${contentText(context.locale, 'adminContent.imagery.reject')}</hcm-button
    >`;
}

/** M16 (`docs/research/M16-recalibrate.md` §4): a recalibration not shown better replaces the current one only by the owner's choice. */
function approve(context: ImageryContext, version: VersionViewPort): void {
    const { recalibration } = version;
    if (recalibration !== null && recalibrationVerdict(recalibration) !== 'better') {
        context.ask('approveWorse');
        return;
    }
    void context.intents?.approve();
}

function decision(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    return html`<div class="actions">
        <hcm-button
            variant="filled"
            icon="approval"
            ?disabled=${busy(context, page)}
            @click=${() => {
                approve(context, version);
            }}
            >${contentText(locale, 'adminContent.imagery.approve')}</hcm-button
        >
        ${deleteButton(context, page)}
    </div>`;
}

/** The guard's verdict when it stopped the publish (null: within, or not checked yet). */
function stopped(version: VersionViewPort): Guard | null {
    const guard = version.guard;
    return guard === null || guard.verdict === 'within' ? null : guard;
}

/**
 * M12: this version publishes from the city's own bucket: the city's choice, or a version with no COG for Mapbox to take (as
 * `functions/src/imagery/publish-own.ts` decides). Its old guard means nothing then: the sweep clears it.
 */
function publishesOwn(context: ImageryContext, version: VersionViewPort): boolean {
    return !context.view.settings.publishThroughMapbox || version.output?.cogBytes === 0;
}

/** The guard's stop, for a version that goes through Mapbox (null: none). */
export function guardStop(context: ImageryContext, version: VersionViewPort): Guard | null {
    return publishesOwn(context, version) ? null : stopped(version);
}

function costText(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    return publishesOwn(context, version)
        ? ownCost(context.locale, version)
        : lazyMapboxChoices(context, (chunk) => chunk.costText(context, page, version));
}

export function approvalCard(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const guard = guardStop(context, version);
    return html`<section class="card" aria-labelledby="approval-title" data-state=${guard === null ? 'approval' : 'guard'}>
        <h3 id="approval-title">${contentText(context.locale, 'adminContent.imagery.approval.title')}</h3>
        ${lazyJoin(context, version, (chunk) => chunk.joinReport(context, version))} ${rmseText(context, version)}
        ${pairsText(context.locale, version)} ${costText(context, page, version)}
        ${
            guard === null
                ? decision(context, page, version)
                : html`${lazyMapboxChoices(context, (chunk) => chunk.guarded(context, page, guard, version))}
                      <div class="actions">${deleteButton(context, page)}</div>`
        }
    </section>`;
}
