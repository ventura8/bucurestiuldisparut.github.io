/**
 * A scene's page (`#/imagery/scene/<entityId>`, `docs/research/M3-interfaces.md` §3.2–§3.4, §10.2; behaviours A11,
 * A12): its browse image (copied into our bucket first; unavailable says so with Try again), what USGS says of it, every
 * reason of its rank in plain words, and **Import** in one click for a free scene. A scene imported already, and a city
 * whose USGS downloads are not approved yet each say why Import is not offered. M4 (A13): a scene that must be bought has
 * the order card instead (`orders/order-card.ts`, a chunk fetched on first need: `orders/lazy-card.ts`), and so has one
 * USGS just delivered (the server imports it). M8: a frame that leaves part of the city out is offered its date's others.
 * The owner's report of 2026-11-13: a frame probably cloudy over the city says so before Import or Buy, and Not useful sets a
 * scene aside (`scene-unusable.ts`).
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort } from './imagery-port.js';
import { datasetText, dayText, numberText, reasonText } from './imagery-text.js';
import { lazyJoin } from './join/lazy-card.js';
import { lazyOrderCard } from './orders/lazy-card.js';
import { notFoundPane } from './not-found.js';
import { sceneRefusal, usgsSetupLink } from './scene-refusal.js';
import { cloudyWarning, unusableSection } from './scene-unusable.js';
import { when } from './when.js';

/** Why there is no image, with Try again; a preview that could not be made too: the row's small crop is not the browse image. */
function browseFailure(context: ImageryContext, scene: SceneItemPort, error: AdminNoticeInputPort | undefined): TemplateResult {
    return html`<p class="alert" role="alert" data-state="browse-unavailable">
            <hcm-icon name="broken_image"></hcm-icon><span>${noticeOf(context.locale, error ?? null)}</span>
        </p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="refresh"
                @click=${() => {
                    context.intents?.retryBrowse(scene.id);
                }}
                >${contentText(context.locale, 'adminContent.common.retry')}</hcm-button
            >
        </div>`;
}

/** The page's picture, the row's until it is made. */
function largest(image: { readonly url: string; readonly preview?: string | null }): string {
    return image.preview ?? image.url;
}

function browseImage(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const image = context.view.browse[scene.id] ?? { status: 'loading' };
    if (image.status === 'loading') {
        return html`<p class="note" role="status">${contentText(context.locale, 'adminContent.imagery.browseLoading')}</p>`;
    }
    return image.status === 'ready' && image.error === undefined
        ? html`<img
              class="browse"
              src=${largest(image)}
              alt=${contentText(context.locale, 'adminContent.imagery.browseAlt', { name: scene.displayId })}
          />`
        : browseFailure(context, scene, image.error);
}

function fact(locale: Locale, key: Parameters<typeof contentText>[1], value: string): TemplateResult {
    return html`<dt>${contentText(locale, key)}</dt>
        <dd>${value}</dd>`;
}

function facts(locale: Locale, scene: SceneItemPort): TemplateResult {
    const cloud =
        scene.cloudCover === null
            ? contentText(locale, 'adminContent.imagery.cloudUnknown')
            : `${numberText(locale, scene.cloudCover, 0)} %`;
    return html`<dl class="facts">
        ${fact(locale, 'adminContent.imagery.fact.dataset', datasetText(locale, scene.dataset))}
        ${fact(locale, 'adminContent.imagery.fact.camera', scene.sensorName)}
        ${fact(locale, 'adminContent.imagery.fact.date', dayText(locale, scene.date))}
        ${fact(locale, 'adminContent.imagery.fact.cloud', cloud)}
        ${when(scene.cloudCity !== null, () =>
            fact(locale, 'adminContent.imagery.fact.cloudCity', `${numberText(locale, scene.cloudCity ?? 0, 0)} %`),
        )}
        ${fact(locale, 'adminContent.imagery.fact.resolution', `${numberText(locale, scene.resolutionM)} m`)}
        ${fact(locale, 'adminContent.imagery.fact.coverage', `${numberText(locale, scene.coverage * 100, 0)} %`)}
        ${fact(locale, 'adminContent.imagery.fact.id', scene.displayId)}
    </dl>`;
}

/** An imported scene's link: its version while it is unfinished, else its layer; and, while it is free, Import again. */
function importedLink(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const version = context.view.versions.items.find((candidate) => candidate.layerId === scene.layerId);
    const href = version === undefined ? ['#/layers', scene.layerId ?? ''].join('/') : context.href(['version', version.id]);
    return html`<p><a href=${href}>${contentText(context.locale, 'adminContent.imagery.importedOpen')}</a></p>
        ${when(scene.free && scene.layerId !== null && context.view.usgs === 'ok', () => importAgainButton(context, scene))}`;
}

/** Import again (lesson 645): the scene downloaded and processed once more, a new version that replaces the old one once approved. */
function importAgainButton(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="refresh"
                ?disabled=${context.view.importing !== null || context.readOnly}
                @click=${() => void importScene(context, scene.id, true)}
                >${contentText(locale, 'adminContent.imagery.importAgain')}</hcm-button
            >
        </div>
        <p>${contentText(locale, 'adminContent.imagery.importAgainHint')}</p>`;
}

/**
 * USGS has not approved the account's downloads yet: Import stays off, with why (`apiError.usgs.accessPending`) and the
 * way to Setup's USGS step (S-A11-BAD-DOWNLOAD-NOT-APPROVED).
 */
function downloadsPending(context: ImageryContext): TemplateResult {
    const { locale } = context;
    return html`<div class="actions">
            <hcm-button variant="filled" icon="download" disabled>${contentText(locale, 'adminContent.imagery.import')}</hcm-button>
        </div>
        <div class="alert" role="alert" data-state="downloads-pending">
            <hcm-icon name="schedule"></hcm-icon>
            <div class="alert-body">
                <p>${noticeOf(locale, { key: 'apiError.usgs.accessPending' })}</p>
                ${usgsSetupLink(locale)}
            </div>
        </div>`;
}

/** Why Import is not offered, or null when it is. */
function noImport(context: ImageryContext, scene: SceneItemPort): TemplateResult | null {
    if (scene.status === 'imported') {
        return importedLink(context, scene);
    }
    return context.view.usgs === 'ok' ? null : downloadsPending(context);
}

/** M4: an order USGS delivered is imported by the server, and its card says so and links to the import. */
const ORDER_IMPORTS: readonly SceneItemPort['acquisition'][] = ['delivered', 'importing'];

/** M4: a free scene, or an imported one, whose order (if any) is not the server's to import; one to buy has its card. */
function importShown(scene: SceneItemPort): boolean {
    return (scene.free || scene.status === 'imported') && !ORDER_IMPORTS.includes(scene.acquisition);
}

/** Import offered: a free scene not imported yet, once USGS lets the city download (the list's cards and the scene). */
export function importable(context: ImageryContext, scene: SceneItemPort): boolean {
    return importShown(scene) && scene.status !== 'imported' && context.view.usgs === 'ok';
}

async function importScene(context: ImageryContext, id: string, again = false): Promise<void> {
    const intents = context.intents;
    if (intents === null) {
        return;
    }
    const versionId = again ? await intents.importScene(id, true) : await intents.importScene(id);
    if (versionId !== null) {
        context.go(['version', versionId]);
    }
}

/** **Import** (one click, `importScene`); `named` adds the scene's name for the list, where every card has one. */
export function importButton(context: ImageryContext, scene: SceneItemPort, named = ''): TemplateResult {
    const importing = context.view.importing === scene.id;
    const key = importing ? 'adminContent.imagery.importing' : 'adminContent.imagery.import';
    return html`<div class="actions">
        <hcm-button
            variant=${named === '' ? 'filled' : 'tonal'}
            icon="download"
            ?disabled=${context.view.importing !== null || context.readOnly}
            @click=${() => void importScene(context, scene.id)}
            >${contentText(context.locale, key)}${when(named !== '', () => html`<span class="visually-hidden"> ${named}</span>`)}</hcm-button
        >
    </div>`;
}

export function importRefusal(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    return sceneRefusal(context, context.view.importRefusal, scene);
}

function notFound(context: ImageryContext): TemplateResult {
    return notFoundPane(context, 'adminContent.imagery.sceneNotFound');
}

function sceneBody(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return html`<div class="pane" data-scene=${scene.id}>
        <h2 tabindex="-1" data-detail-heading>${scene.sensorName} · ${dayText(locale, scene.date)}</h2>
        <p>${contentText(locale, 'adminContent.imagery.score', { score: String(scene.score) })}</p>
        ${browseImage(context, scene)} ${cloudyWarning(locale, scene)} ${lazyOrderCard(context, scene)}
        ${when(importShown(scene), () => noImport(context, scene) ?? importButton(context, scene))} ${importRefusal(context, scene)}
        ${lazyJoin(context, null, (chunk) => chunk.sceneOffer(context, scene))} ${unusableSection(context, scene)}
        <h3>${contentText(locale, 'adminContent.imagery.why')}</h3>
        <ul class="reasons">
            ${scene.reasons.map((reason) => html`<li>${reasonText(locale, reason)}</li>`)}
        </ul>
        ${facts(locale, scene)}
    </div>`;
}

export function sceneDetail(context: ImageryContext, scene: SceneItemPort | null): TemplateResult {
    if (scene !== null) {
        return sceneBody(context, scene);
    }
    const { locale, view, intents } = context;
    if (view.scenes.status === 'loading' || view.named.loading) {
        return loadingTemplate(locale);
    }
    return view.named.failure === null ? notFound(context) : errorTemplate(locale, view.named.failure, () => intents?.retry());
}
