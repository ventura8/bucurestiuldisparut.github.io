/**
 * Find, the Imagery area's first view (`docs/research/M3-interfaces.md` §3, §10.2; behaviour A11): the USGS search and
 * how it went, the filters (free only by default, datasets, years, hide rejected), and the scenes ranked for the city,
 * each with its browse thumbnail, its score and first reasons in plain words, and its chips (Free or Needs ordering,
 * Imported). Without USGS set up the view says so with the way to Setup's USGS card.
 */
import { USGS_DATASETS, type Locale, type UsgsDataset } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { current, errorTemplate, loadingTemplate } from '../editing/states.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort } from './imagery-port.js';
import { datasetText, dayText, reasonText } from './imagery-text.js';
import { orderTag } from './orders/order-list.js';
import { importable, importButton, importRefusal } from './scene-detail.js';
import { USGS_SETUP_HREF } from './scene-refusal.js';
import { when } from './when.js';

/** The reasons a row shows (the rest on its page). */
const ROW_REASONS = 3;

function chip(label: string, selected: boolean, change: (selected: boolean) => void): TemplateResult {
    return html`<hcm-chip
        .label=${label}
        .selected=${selected}
        @hcm-change=${(event: Event) => {
            change((event as CustomEvent<{ selected: boolean }>).detail.selected);
        }}
    ></hcm-chip>`;
}

function datasetChips(context: ImageryContext): TemplateResult[] {
    const { locale, view, intents } = context;
    const chosen = view.filters.datasets;
    const toggle = (dataset: UsgsDataset, on: boolean): readonly UsgsDataset[] =>
        on ? [...chosen, dataset] : chosen.filter((candidate) => candidate !== dataset);
    return USGS_DATASETS.map((dataset) =>
        chip(datasetText(locale, dataset), chosen.includes(dataset), (on) => {
            intents?.setFilters({ datasets: toggle(dataset, on) });
        }),
    );
}

/** A year field's text as the filter takes it: empty (or not a whole number) is no limit. */
export function yearFilter(text: string): number | null {
    const trimmed = text.trim();
    const year = Number(trimmed);
    return trimmed !== '' && Number.isInteger(year) ? year : null;
}

function yearField(context: ImageryContext, name: 'fromYear' | 'toYear'): TemplateResult {
    const value = context.view.filters[name];
    const id = ['imagery', name].join('-');
    const set = (event: Event): void => {
        context.intents?.setFilters({ [name]: yearFilter((event.target as HTMLInputElement).value) });
    };
    return html`<div class="field">
        <label for=${id}>${contentText(context.locale, `adminContent.imagery.filter.${name}`)}</label>
        <input id=${id} inputmode="numeric" .value=${value === null ? '' : String(value)} @change=${set} />
    </div>`;
}

function filters(context: ImageryContext): TemplateResult {
    const { locale, view, intents } = context;
    return html`<div class="filters" role="group" aria-label=${contentText(locale, 'adminContent.imagery.filter.label')}>
        ${chip(contentText(locale, 'adminContent.imagery.filter.freeOnly'), view.filters.freeOnly, (on) => {
            intents?.setFilters({ freeOnly: on });
        })}
        ${chip(contentText(locale, 'adminContent.imagery.filter.hideRejected'), view.filters.hideRejected, (on) => {
            intents?.setFilters({ hideRejected: on });
        })}
        ${datasetChips(context)}
        <div class="years">${yearField(context, 'fromYear')} ${yearField(context, 'toYear')}</div>
    </div>`;
}

/** The search's state in words: searching, or what it found. */
function searchLine(locale: Locale, search: ImageryContext['view']['search']): string {
    if (search.phase === 'searching') {
        return contentText(locale, 'adminContent.imagery.searching');
    }
    return search.phase === 'done'
        ? contentText(locale, 'adminContent.imagery.searched', { found: String(search.found), added: String(search.added) })
        : '';
}

function failedDatasets(locale: Locale, search: ImageryContext['view']['search']): TemplateResult {
    const failed = search.failedDatasets.map((dataset) => datasetText(locale, dataset)).join(', ');
    return when(
        failed !== '',
        () =>
            html`<p class="note" data-failed-datasets>
                ${contentText(locale, 'adminContent.imagery.datasetsFailed', { datasets: failed })}
            </p>`,
    );
}

/** Search errors whose cure is in Setup's USGS step: the token, the account's access, or no USGS at all. */
const SETUP_ERRORS: ReadonlySet<string> = new Set([
    'apiError.usgs.credentials',
    'apiError.usgs.accessPending',
    'apiError.usgs.notConfigured',
]);

/** Search errors a later try cures: USGS in maintenance, not answering, or asked too often (CR-M3-47). */
const TRY_AGAIN_ERRORS: ReadonlySet<string> = new Set(['apiError.usgs.unavailable', 'apiError.usgs.maintenance', 'apiError.rateLimited']);

/** What the admin can do about a failed search: Setup's USGS step, or Try again when USGS did not answer. */
function searchCure(context: ImageryContext, key: string): TemplateResult {
    if (SETUP_ERRORS.has(key)) {
        return html`<p><a href=${USGS_SETUP_HREF}>${contentText(context.locale, 'adminContent.imagery.openUsgsSetup')}</a></p>`;
    }
    return when(
        TRY_AGAIN_ERRORS.has(key),
        () =>
            html`<div class="actions">
                <hcm-button variant="text" icon="refresh" ?disabled=${context.readOnly} @click=${() => void context.intents?.search()}
                    >${contentText(context.locale, 'adminContent.common.retry')}</hcm-button
                >
            </div>`,
    );
}

/** The search's state in one line (or its error as an alert, with what to do about it: S-A11-BAD-M2M-ERROR). */
function searchStatus(context: ImageryContext): TemplateResult {
    const { locale, view } = context;
    const search = view.search;
    if (search.phase === 'failed') {
        return html`<div class="alert" role="alert" data-state="search-error">
            <hcm-icon name="error"></hcm-icon>
            <div class="alert-body">
                <p>${noticeOf(locale, search.error)}</p>
                ${searchCure(context, search.error?.key ?? '')}
            </div>
        </div>`;
    }
    return html`<p class="note status" role="status">${searchLine(locale, search)}</p>
        ${failedDatasets(locale, search)}`;
}

function sceneTags(locale: Locale, scene: SceneItemPort): TemplateResult {
    const free = scene.free ? 'adminContent.imagery.tag.free' : 'adminContent.imagery.tag.needsOrder';
    return html`<span class="chips">
        <span class="tag" data-tone=${scene.free ? 'good' : 'wait'}>${contentText(locale, free)}</span>
        ${when(scene.status === 'imported', () => html`<span class="tag">${contentText(locale, 'adminContent.imagery.tag.imported')}</span>`)}
        ${orderTag(locale, scene)}
    </span>`;
}

function thumbnail(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const image = context.view.browse[scene.id];
    return image?.status === 'ready'
        ? html`<img class="thumb" src=${image.url} alt="" />`
        : html`<span class="thumb" aria-hidden="true"><hcm-icon name="satellite_alt"></hcm-icon></span>`;
}

/** A card's **Import** (§10.2: the one click of `importScene`), named after its scene, and why it was refused. */
function cardImport(context: ImageryContext, scene: SceneItemPort, title: string): TemplateResult {
    return when(
        importable(context, scene),
        () => html`<div class="card-import">${importButton(context, scene, title)} ${importRefusal(context, scene)}</div>`,
    );
}

function sceneRow(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale, view } = context;
    const selected = view.detail?.kind === 'scene' && view.detail.id === scene.id;
    const reasons = scene.reasons.slice(0, ROW_REASONS).map((reason) => reasonText(locale, reason));
    const score = contentText(locale, 'adminContent.imagery.score', { score: String(scene.score) });
    const title = `${scene.sensorName} · ${dayText(locale, scene.date)}`;
    return html`<li class="scene-card" data-scene=${scene.id}>
        <a class="row scene" href=${context.href(['scene', scene.id])} aria-current=${current(selected)}>
            ${thumbnail(context, scene)}
            <span>
                <span class="row-title">${title}</span>
                <span class="row-detail">${[score, ...reasons].join(' · ')}</span>
                ${sceneTags(locale, scene)}
            </span>
        </a>
        ${cardImport(context, scene, title)}
    </li>`;
}

function moreButton(context: ImageryContext): TemplateResult {
    return when(
        context.view.scenes.hasMore,
        () =>
            html`<div class="actions more">
                <hcm-button variant="text" icon="expand_more" @click=${() => context.intents?.more()}
                    >${contentText(context.locale, 'adminContent.common.more')}</hcm-button
                >
            </div>`,
    );
}

/** Every year: the year fields cleared (offered while either holds a year). */
function everyYear(context: ImageryContext): TemplateResult {
    const { filters } = context.view;
    return when(
        filters.fromYear !== null || filters.toYear !== null,
        () =>
            html`<hcm-button variant="text" icon="schedule" @click=${() => context.intents?.setFilters({ fromYear: null, toYear: null })}
                >${contentText(context.locale, 'adminContent.imagery.zero.everyYear')}</hcm-button
            >`,
    );
}

/** Every collection: the dataset chips cleared, so all three are searched (offered while some are chosen). */
function everyDataset(context: ImageryContext): TemplateResult {
    return when(
        context.view.filters.datasets.length > 0,
        () =>
            html`<hcm-button variant="text" icon="select_all" @click=${() => context.intents?.setFilters({ datasets: [] })}
                >${contentText(context.locale, 'adminContent.imagery.zero.everyDataset')}</hcm-button
            >`,
    );
}

/**
 * Nothing found, or nothing the filters keep: what to try (S-A11-BAD-ZERO-RESULTS): every year, all three collections,
 * scenes to order too, and the city's area in Settings (the search covers only that area).
 */
function guidance(context: ImageryContext, key: 'adminContent.imagery.zero.none' | 'adminContent.imagery.noMatch'): TemplateResult {
    const { locale, view, intents } = context;
    const freeOnly = when(
        view.filters.freeOnly,
        () =>
            html`<hcm-button variant="text" icon="filter_alt" @click=${() => intents?.setFilters({ freeOnly: false })}
                >${contentText(locale, 'adminContent.imagery.zero.toOrder')}</hcm-button
            >`,
    );
    return html`<div class="pane" data-state="zero-results">
        <hcm-empty-state icon="travel_explore" .text=${contentText(locale, key)}></hcm-empty-state>
        <p>${contentText(locale, 'adminContent.imagery.zero.try')}</p>
        <div class="actions">${everyYear(context)} ${everyDataset(context)} ${freeOnly}</div>
        <p><a href="#/settings/area">${contentText(locale, 'adminContent.imagery.zero.area')}</a></p>
    </div>`;
}

/** No scene to show: still reading, none harvested yet, or none found or kept by the filters (with what to try). */
function noScenes(context: ImageryContext): TemplateResult {
    const { locale, view } = context;
    if (view.scenes.status === 'loading') {
        return loadingTemplate(locale);
    }
    if (view.scenes.items.length > 0) {
        return guidance(context, 'adminContent.imagery.noMatch');
    }
    return view.search.phase === 'done'
        ? guidance(context, 'adminContent.imagery.zero.none')
        : html`<hcm-empty-state icon="travel_explore" .text=${contentText(locale, 'adminContent.imagery.noScenes')}></hcm-empty-state>`;
}

function sceneRows(context: ImageryContext): TemplateResult {
    const { locale, view, intents } = context;
    if (view.scenes.status === 'error') {
        return errorTemplate(locale, view.scenes.failure, () => intents?.retry());
    }
    if (view.visible.length === 0) {
        return noScenes(context);
    }
    return html`<ul class="rows" aria-label=${contentText(locale, 'adminContent.imagery.scenesLabel')}>
            ${view.visible.map((scene) => sceneRow(context, scene))}
        </ul>
        ${moreButton(context)}`;
}

/** USGS is not set up (or its token was refused): nothing to search with. */
function usgsMissing(context: ImageryContext): TemplateResult {
    return html`<div class="pane" data-state="usgs-missing">
        <hcm-empty-state icon="satellite_alt" .text=${contentText(context.locale, 'adminContent.imagery.usgsMissing')}></hcm-empty-state>
        <p><a href=${USGS_SETUP_HREF}>${contentText(context.locale, 'adminContent.imagery.openUsgsSetup')}</a></p>
    </div>`;
}

function searchButton(context: ImageryContext): TemplateResult {
    const { locale, view, intents } = context;
    const searching = view.search.phase === 'searching';
    const off = searching || context.readOnly || view.usgs === null;
    const bar = when(
        searching,
        () => html`<hcm-progress indeterminate .label=${contentText(locale, 'adminContent.imagery.searching')}></hcm-progress>`,
    );
    return html`<div class="actions">
            <hcm-button variant="tonal" icon="travel_explore" ?disabled=${off} @click=${() => void intents?.search()}
                >${contentText(locale, searching ? 'adminContent.imagery.searchingButton' : 'adminContent.imagery.search')}</hcm-button
            >
        </div>
        ${bar}`;
}

function downloadsPending(context: ImageryContext): TemplateResult {
    return when(
        context.view.usgs === 'pending',
        () =>
            html`<p class="note" data-state="downloads-pending">
                ${contentText(context.locale, 'adminContent.imagery.downloadsPending')}
            </p>`,
    );
}

export function findView(context: ImageryContext): TemplateResult {
    const usgs = context.view.usgs;
    if (usgs === 'missing' || usgs === 'invalid') {
        return usgsMissing(context);
    }
    return html`<div class="pane" data-view="find">
            ${searchButton(context)} ${searchStatus(context)} ${downloadsPending(context)} ${filters(context)}
        </div>
        ${sceneRows(context)}`;
}
