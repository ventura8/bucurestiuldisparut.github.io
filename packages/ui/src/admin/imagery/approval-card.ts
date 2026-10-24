/**
 * The approval card of a rendered version (`docs/research/M3-interfaces.md` §7, §10.2; behaviours A17, A42): the
 * checkpoint error against the city's threshold in words, the pairs it comes from, what publishing costs in Mapbox
 * compute units and what is left this month, then **Approve** (or Reject, asked first). A publish that does not fit the
 * month offers its three ways out with their consequences: the free Mapbox Studio upload (three steps), next month, or
 * pay about $X now (asked first). At the tileset cap neither money nor a month frees a place: the card says to delete a
 * layer (with the way to Layers) or use Studio; a file Mapbox refused as too large has only the Studio way (CR-M3-47).
 */
import { availableComputeUnits, MAX_TILESETS, nextMonthStart, type Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionPagePort, VersionViewPort } from './imagery-port.js';
import { dayText, numberText } from './imagery-text.js';
import { when, withValue } from './when.js';

/** Mapbox Studio's tilesets page: `links.json` → `mapbox.studioTilesets` (CR-M3-9; the weekly contract run probes it). */
const MAPBOX_STUDIO_TILESETS_URL = 'https://studio.mapbox.com/tilesets/';

type Guard = NonNullable<VersionViewPort['guard']>;

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

function rmseText(context: ImageryContext, version: VersionViewPort): TemplateResult {
    const rmse = version.georef?.checkpointRmseM ?? null;
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

function costText(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const { locale } = context;
    const available = Math.max(0, availableComputeUnits(page.usage ?? undefined, version.id));
    const estimate = numberText(locale, version.estimate ?? 0);
    return html`<p class="note" data-estimate>
        ${contentText(locale, 'adminContent.imagery.approval.cost', { estimate, available: numberText(locale, available) })}
    </p>`;
}

function decision(context: ImageryContext, page: VersionPagePort): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    return html`<div class="actions">
        <hcm-button variant="filled" icon="approval" ?disabled=${off} @click=${() => void intents?.approve()}
            >${contentText(locale, 'adminContent.imagery.approve')}</hcm-button
        >
        <hcm-button
            variant="outlined"
            icon="close"
            ?disabled=${off}
            @click=${() => {
                context.ask('reject');
            }}
            >${contentText(locale, 'adminContent.imagery.reject')}</hcm-button
        >
    </div>`;
}

function studioSteps(context: ImageryContext, page: VersionPagePort): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    return html`<ol class="steps" data-state="studio-steps">
            <li>
                <hcm-button variant="tonal" icon="download" ?disabled=${off} @click=${() => void intents?.download()}
                    >${contentText(locale, 'adminContent.imagery.studio.download')}</hcm-button
                >
                ${when(page.downloaded, () => html`<hcm-icon name="check_circle"></hcm-icon>`)}
            </li>
            <li>
                <a class="external" href=${MAPBOX_STUDIO_TILESETS_URL} target="_blank" rel="noopener noreferrer"
                    >${contentText(locale, 'adminContent.imagery.studio.open')}<hcm-icon name="open_in_new"></hcm-icon
                ></a>
            </li>
            <li>
                <hcm-button variant="filled" icon="check" ?disabled=${off} @click=${() => void intents?.studioDone()}
                    >${contentText(locale, 'adminContent.imagery.studio.done')}</hcm-button
                >
            </li>
        </ol>
        <p class="note">${contentText(locale, 'adminContent.imagery.studio.note')}</p>`;
}

/** The version's file for Mapbox in whole megabytes, as the refusal says it. */
function megabytesOf(version: VersionViewPort): string {
    return String(Math.ceil((version.output?.cogBytes ?? 0) / 1e6));
}

/** Why the publish waits: the month's compute units, the tileset cap, or a file Mapbox refused as too large. */
function overText(locale: Locale, guard: Guard, version: VersionViewPort): string {
    if (guard.verdict === 'tileset-limit') {
        return contentText(locale, 'adminContent.imagery.approval.tilesetLimit', { limit: String(MAX_TILESETS) });
    }
    if (guard.verdict === 'too-large') {
        return contentText(locale, 'adminContent.imagery.approval.tooLarge', { megabytes: megabytesOf(version) });
    }
    return contentText(locale, 'adminContent.imagery.approval.over', { available: numberText(locale, Math.max(0, guard.available)) });
}

/** Next month and paying: only when the month's compute units are what stops the publish. */
function laterOrPay(context: ImageryContext, page: VersionPagePort, guard: Guard): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    const next = dayText(locale, nextMonthStart(new Date()).toISOString());
    const usd = numberText(locale, guard.overageUsd ?? 0, 2);
    return when(
        guard.verdict === 'over',
        () =>
            html`<hcm-button variant="tonal" icon="pending" ?disabled=${off} @click=${() => void intents?.choose('defer')}
                    >${contentText(locale, 'adminContent.imagery.choice.defer', { date: next })}</hcm-button
                >
                <hcm-button
                    variant="outlined"
                    icon="credit_card"
                    ?disabled=${off}
                    @click=${() => {
                        context.ask('pay');
                    }}
                    >${contentText(locale, 'adminContent.imagery.choice.pay', { usd })}</hcm-button
                >`,
    );
}

/** At the tileset cap a layer must go: the way to Layers. */
function layersLink(locale: Locale, guard: Guard): TemplateResult {
    return when(
        guard.verdict === 'tileset-limit',
        () => html`<a href="#/layers">${contentText(locale, 'adminContent.imagery.openLayers')}</a>`,
    );
}

const CHOICE_STATES: Readonly<Record<Exclude<Guard['verdict'], 'within'>, string>> = {
    over: 'over-budget',
    'tileset-limit': 'tileset-limit',
    'too-large': 'too-large',
};

/** The ways out of a publish the guard stopped: Studio always; next month or paying only over the month's units. */
function choices(context: ImageryContext, page: VersionPagePort, guard: Guard, version: VersionViewPort): TemplateResult {
    const { locale, intents } = context;
    const off = busy(context, page);
    return html`<div class="choices" data-state=${CHOICE_STATES[guard.verdict as Exclude<Guard['verdict'], 'within'>]}>
        <p class="alert" role="alert"><hcm-icon name="info"></hcm-icon><span>${overText(locale, guard, version)}</span></p>
        ${layersLink(locale, guard)}
        <hcm-button variant="filled" icon="upload_file" ?disabled=${off} @click=${() => void intents?.choose('studio')}
            >${contentText(locale, 'adminContent.imagery.choice.studio')}</hcm-button
        >
        ${laterOrPay(context, page, guard)}
    </div>`;
}

function deferred(locale: Locale, deferUntil: string): TemplateResult {
    return html`<p class="note" data-state="deferred">
        ${contentText(locale, 'adminContent.imagery.wait.deferred', { date: dayText(locale, deferUntil) })}
    </p>`;
}

/** What the card offers once the guard spoke: the Studio steps, the deferral's date, or the choices. */
function guarded(context: ImageryContext, page: VersionPagePort, guard: Guard, version: VersionViewPort): TemplateResult {
    if (guard.choice === 'studio') {
        return studioSteps(context, page);
    }
    if (guard.choice === 'defer' && guard.deferUntil !== null) {
        return deferred(context.locale, guard.deferUntil);
    }
    return choices(context, page, guard, version);
}

/** The guard's verdict when it stopped the publish (null: within, or not checked yet). */
function stopped(version: VersionViewPort): Guard | null {
    const guard = version.guard;
    return guard === null || guard.verdict === 'within' ? null : guard;
}

export function approvalCard(context: ImageryContext, page: VersionPagePort, version: VersionViewPort): TemplateResult {
    const guard = stopped(version);
    return html`<section class="card" aria-labelledby="approval-title" data-state=${guard === null ? 'approval' : 'guard'}>
        <h3 id="approval-title">${contentText(context.locale, 'adminContent.imagery.approval.title')}</h3>
        ${rmseText(context, version)} ${pairsText(context.locale, version)} ${costText(context, page, version)}
        ${guard === null ? decision(context, page) : guarded(context, page, guard, version)}
    </section>`;
}
