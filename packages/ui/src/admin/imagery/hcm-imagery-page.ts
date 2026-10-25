/**
 * `<hcm-imagery-page>`: `#/imagery`, `#/imagery/scene/<entityId>` and `#/imagery/version/<versionId>`
 * (`docs/research/M3-interfaces.md` §10.2, §10.3; behaviours A11, A12, A14, A17, A42). The list pane has three views:
 * Find (the ranked scenes, their filters and the search), Work (the versions in progress and those waiting for the
 * admin) and Upload; the detail pane holds the page's one map (the footprints and the selected scene's browse image, or
 * a version's preview) above the open scene or version. While the budget guard pauses the raster work the list pane
 * says so, with the spend, and offers Resume processing (CR-M3-47). Reject, Dismiss, Pay, Cancel and Resume ask first.
 */
import type { Locale, PublishChoice } from '@hcm/shared';
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext, ImageryQuestion } from './context.js';
import { guardBanner } from './guard-banner.js';
import type { ImageryIntentsPort, ImageryTabPort, ImageryViewState } from './imagery-port.js';
import { imageryStyles } from './imagery-styles.js';
import { numberText } from './imagery-text.js';
import { ordersNeedingYou } from './orders/order-list.js';
import { orderStyles } from './orders/order-styles.js';
import { sceneDetail } from './scene-detail.js';
import { findView } from './scene-list.js';
import { uploadPanel } from './upload-panel.js';
import { versionDetail } from './version-detail.js';
import { workView } from './work-list.js';

export const HCM_IMAGERY_PAGE_TAG = 'hcm-imagery-page';

const TABS: readonly ImageryTabPort[] = ['find', 'work', 'upload'];

const QUESTIONS = {
    reject: {
        headline: 'adminContent.imagery.confirm.reject',
        body: 'adminContent.imagery.confirm.rejectBody',
        confirm: 'adminContent.imagery.reject',
    },
    dismiss: {
        headline: 'adminContent.imagery.confirm.dismiss',
        body: 'adminContent.imagery.confirm.dismissBody',
        confirm: 'adminContent.imagery.dismiss',
    },
    resume: {
        headline: 'adminContent.imagery.confirm.resume',
        body: 'adminContent.imagery.confirm.resumeBody',
        confirm: 'adminContent.imagery.guard.resume',
    },
    pay: {
        headline: 'adminContent.imagery.confirm.pay',
        body: 'adminContent.imagery.confirm.payBody',
        confirm: 'adminContent.imagery.confirm.payConfirm',
    },
    cancel: { headline: 'adminContent.jobs.cancelConfirm', body: 'adminContent.jobs.cancelBody', confirm: 'adminContent.jobs.cancel' },
} as const;

class HcmImageryPage extends AreaPage<ImageryViewState, ImageryIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, question: { state: true }, mapCss: { attribute: false } };

    static override readonly styles = [...imageryStyles, orderStyles];

    protected readonly route: AdminRouteIdPort = 'imagery';
    /** The open question (Reject, Pay, Cancel), or null. */
    declare question: ImageryQuestion | null;
    /** mapbox-gl.css of the pinned release ('' in tests: no network). */
    declare mapCss: string;
    /** The footprint click the page followed last. */
    #picked = 0;
    /** The upload whose version the page opened. */
    #opened: string | null = null;

    constructor() {
        super();
        this.question = null;
        this.mapCss = MAPBOX_GL_CSS_URL;
    }

    protected storeOf(content: ContentPort): AreaPort<ImageryViewState, ImageryIntentsPort> | null {
        return content.imagery;
    }

    protected override updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        this.#follow();
    }

    /** A footprint clicked on the map opens its scene; a finished upload opens its version. */
    #follow(): void {
        const view = this.view;
        if (view !== null) {
            this.#followPick(view.pickedScene);
            this.#followUpload(view.upload);
        }
    }

    #followPick(picked: ImageryViewState['pickedScene']): void {
        if (picked !== null && picked.seq !== this.#picked) {
            this.#picked = picked.seq;
            this.go(['scene', picked.id]);
        }
    }

    #followUpload(upload: ImageryViewState['upload']): void {
        const jobId = upload.phase === 'done' ? upload.jobId : null;
        if (jobId !== null && jobId !== this.#opened) {
            this.#opened = jobId;
            this.go(['version', jobId]);
        }
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const context = this.#context(view);
        const locale = this.locale;
        return html`<hcm-list-detail
                ?detail=${view.detail !== null}
                .detailKey=${view.detail === null ? '' : `${view.detail.kind}/${view.detail.id}`}
                .listLabel=${contentText(locale, 'adminContent.imagery.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.imagery.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.go([]);
                }}
            >
                <div slot="list">${this.#list(context)}</div>
                <div slot="detail">${this.#map(context)} ${this.#detail(context)}</div>
            </hcm-list-detail>
            ${this.#dialog(context)}`;
    }

    #context(view: ImageryViewState): ImageryContext {
        return {
            ...{ locale: this.locale, view, intents: this.intents, readOnly: this.readOnly },
            href: (params) => this.href(params),
            go: (params) => {
                this.go(params);
            },
            ask: (question) => {
                this.question = question;
            },
            refresh: () => {
                this.requestUpdate();
            },
            focusDetail: () => {
                void this.updateComplete.then(() => this.renderRoot.querySelector<HTMLElement>('[data-detail-heading]')?.focus());
            },
        };
    }

    #list(context: ImageryContext): TemplateResult {
        const { locale, view, intents } = context;
        const waiting = view.versions.items.filter((version) => version.needsYou).length + ordersNeedingYou(view);
        const options = TABS.map((tab) => ({
            value: tab,
            label: contentText(locale, `adminContent.imagery.tab.${tab}`, { count: String(waiting) }),
        }));
        return html`<div class="list-head">
                <h2>${contentText(locale, 'adminContent.imagery.title')}</h2>
                <hcm-segmented-button
                    .options=${options}
                    .value=${view.tab}
                    .label=${contentText(locale, 'adminContent.imagery.tabsLabel')}
                    @hcm-change=${(event: Event) => intents?.setTab((event as CustomEvent<{ value: ImageryTabPort }>).detail.value)}
                ></hcm-segmented-button>
            </div>
            ${guardBanner(locale, view.guard, {
                off: view.resuming || context.readOnly,
                resume: () => {
                    context.ask('resume');
                },
            })}
            ${this.#tab(context)}`;
    }

    #tab(context: ImageryContext): TemplateResult {
        const { view, intents } = context;
        if (view.tab === 'find') {
            return findView(context);
        }
        if (view.tab === 'work') {
            return workView(context);
        }
        return uploadPanel(
            context.locale,
            { ...view.upload, layerId: view.upload.layerId ?? view.replaceLayer },
            {
                ...{ choose: (file) => void intents?.chooseFile(file), setYear: (text) => intents?.setYear(text) },
                ...{ start: () => intents?.startUpload(), cancel: () => intents?.cancelUpload(), reset: () => intents?.resetUpload() },
                readOnly: context.readOnly,
            },
        );
    }

    /** The page's one map, always first in the detail pane so it stays the same element. */
    #map(context: ImageryContext): TemplateResult {
        const { intents } = context;
        return html`<hcm-admin-map
            class="imagery-map"
            .status=${context.view.map}
            .locale=${context.locale}
            .cssUrl=${this.mapCss}
            @hcm-map-host=${(event: Event) => {
                intents?.attachMap((event as CustomEvent<{ container: HTMLElement }>).detail.container);
            }}
            @hcm-zoom=${(event: Event) => {
                intents?.zoomBy((event as CustomEvent<{ delta: number }>).detail.delta);
            }}
        ></hcm-admin-map>`;
    }

    #detail(context: ImageryContext): TemplateResult {
        const { locale, view } = context;
        const detail = view.detail;
        if (detail === null) {
            return html`<hcm-empty-state
                icon="satellite_alt"
                .text=${contentText(locale, 'adminContent.imagery.choose')}
            ></hcm-empty-state>`;
        }
        if (detail.kind === 'scene') {
            // M4: an ordered scene the filters hide (Free only) opens too, from Work's orders or a notification's link.
            const scenes = [...view.scenes.items, ...view.orders.items];
            return sceneDetail(context, scenes.find((scene) => scene.id === detail.id) ?? null);
        }
        return versionDetail(context, view.version);
    }

    #dialog(context: ImageryContext): TemplateResult {
        const question = this.question;
        const texts = QUESTIONS[question ?? 'reject'];
        const { locale } = context;
        const usd = usdOf(context.view, locale);
        const actions = answers(context.intents);
        return html`<hcm-confirm-dialog
            ?destructive=${question !== 'pay' && question !== 'resume'}
            .open=${question !== null}
            .headline=${contentText(locale, texts.headline)}
            .body=${contentText(locale, texts.body, { usd })}
            .confirmLabel=${contentText(locale, texts.confirm, { usd })}
            .cancelLabel=${contentText(locale, 'adminContent.common.cancel')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${() => {
                this.question = null;
                if (question !== null) {
                    actions[question]();
                }
            }}
            @hcm-cancel=${() => {
                this.question = null;
            }}
        ></hcm-confirm-dialog>`;
    }
}

/** The open version's overage cost in dollars, for the Pay question, as the Pay button writes it. */
function usdOf(view: ImageryViewState, locale: Locale): string {
    return numberText(locale, view.version?.version.doc?.data.guard?.overageUsd ?? 0, 2);
}

/** What each question does once confirmed. */
function answers(intents: ImageryIntentsPort | null): Readonly<Record<ImageryQuestion, () => void>> {
    return {
        reject: () => void intents?.reject(),
        dismiss: () => void intents?.reject(),
        pay: () => void intents?.choose('pay' satisfies PublishChoice),
        cancel: () => void intents?.cancelJob(),
        resume: () => void intents?.resumeGuard(),
    };
}

/** Registers `<hcm-imagery-page>` (its kit elements are the editing kit's and the admin map's). */
export function defineHcmImageryPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_IMAGERY_PAGE_TAG) === undefined) {
        registry.define(HCM_IMAGERY_PAGE_TAG, HcmImageryPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-imagery-page': HcmImageryPage;
    }
}
