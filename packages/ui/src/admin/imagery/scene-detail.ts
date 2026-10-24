/**
 * A scene's page (`#/imagery/scene/<entityId>`, `docs/research/M3-interfaces.md` §3.2–§3.4, §10.2; behaviours A11,
 * A12): its browse image (copied into our bucket first; unavailable says so with Try again), what USGS says of it, every
 * reason of its rank in plain words, and **Import** in one click for a free scene. A scene that must be bought, one
 * imported already, and a city whose USGS downloads are not approved yet each say why Import is not offered.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { loadingTemplate } from '../editing/states.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { SceneItemPort } from './imagery-port.js';
import { datasetText, dayText, numberText, reasonText } from './imagery-text.js';
import { when, withValue } from './when.js';

function browseImage(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale, intents } = context;
    const image = context.view.browse[scene.id] ?? { status: 'loading' };
    if (image.status === 'loading') {
        return html`<p class="note" role="status">${contentText(locale, 'adminContent.imagery.browseLoading')}</p>`;
    }
    if (image.status === 'failed') {
        return html`<p class="alert" role="alert" data-state="browse-unavailable">
                <hcm-icon name="broken_image"></hcm-icon><span>${noticeOf(locale, image.error)}</span>
            </p>
            <div class="actions">
                <hcm-button
                    variant="tonal"
                    icon="refresh"
                    @click=${() => {
                        intents?.retryBrowse(scene.id);
                    }}
                    >${contentText(locale, 'adminContent.common.retry')}</hcm-button
                >
            </div>`;
    }
    return html`<img
        class="browse"
        src=${image.url}
        alt=${contentText(locale, 'adminContent.imagery.browseAlt', { name: scene.displayId })}
    />`;
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
        ${fact(locale, 'adminContent.imagery.fact.resolution', `${numberText(locale, scene.resolutionM)} m`)}
        ${fact(locale, 'adminContent.imagery.fact.coverage', `${numberText(locale, scene.coverage * 100, 0)} %`)}
        ${fact(locale, 'adminContent.imagery.fact.id', scene.displayId)}
    </dl>`;
}

/** An imported scene's link: its version while it is unfinished, else its layer. */
function importedLink(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const version = context.view.versions.items.find((candidate) => candidate.layerId === scene.layerId);
    const href = version === undefined ? ['#/layers', scene.layerId ?? ''].join('/') : context.href(['version', version.id]);
    return html`<p><a href=${href}>${contentText(context.locale, 'adminContent.imagery.importedOpen')}</a></p>`;
}

/** Setup's USGS step, where the credentials are pasted and the M2M access is watched. */
export const USGS_SETUP_HREF = '#/setup/usgs';

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
                <p><a href=${USGS_SETUP_HREF}>${contentText(locale, 'adminContent.imagery.openUsgsSetup')}</a></p>
            </div>
        </div>`;
}

/** Why Import is not offered, or null when it is. */
function noImport(context: ImageryContext, scene: SceneItemPort): TemplateResult | null {
    if (scene.status === 'imported') {
        return importedLink(context, scene);
    }
    if (!scene.free) {
        return html`<p class="note" data-state="needs-order">${contentText(context.locale, 'adminContent.imagery.needsOrderNote')}</p>`;
    }
    return context.view.usgs === 'ok' ? null : downloadsPending(context);
}

/** Import offered: a free scene not imported yet, once USGS lets the city download (the list's cards and the scene). */
export function importable(context: ImageryContext, scene: SceneItemPort): boolean {
    return scene.free && scene.status !== 'imported' && context.view.usgs === 'ok';
}

async function importScene(context: ImageryContext, id: string): Promise<void> {
    const versionId = (await context.intents?.importScene(id)) ?? null;
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
    const refusal = context.view.importRefusal;
    return withValue(
        refusal?.id === scene.id ? refusal.notice : null,
        (notice) =>
            html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(context.locale, notice)}</span></p>`,
    );
}

function notFound(context: ImageryContext): TemplateResult {
    return html`<div class="pane">
        <h2 tabindex="-1" data-detail-heading>${contentText(context.locale, 'adminContent.imagery.sceneNotFound')}</h2>
        <p><a href=${context.href([])}>${contentText(context.locale, 'adminContent.imagery.backToList')}</a></p>
    </div>`;
}

function sceneBody(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale } = context;
    return html`<div class="pane" data-scene=${scene.id}>
        <h2 tabindex="-1" data-detail-heading>${scene.sensorName} · ${dayText(locale, scene.date)}</h2>
        <p>${contentText(locale, 'adminContent.imagery.score', { score: String(scene.score) })}</p>
        ${browseImage(context, scene)} ${noImport(context, scene) ?? importButton(context, scene)} ${importRefusal(context, scene)}
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
    return context.view.scenes.status === 'loading' ? loadingTemplate(context.locale) : notFound(context);
}
