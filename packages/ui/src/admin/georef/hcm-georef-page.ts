/**
 * `<hcm-georef-page>`: the georeferencer, `#/georef/<versionId>` (`docs/research/M3-interfaces.md` §10.4; behaviour
 * A16). The scan and the reference map side by side (a Scan | Map switch on compact windows), **Add pairs** (then a click
 * on each, in either order; Esc drops the half pair) or **Add at the centres** from the keyboard, the transform as a
 * radio group (one without enough pairs is disabled with the count missing), the fit's errors and the warning over the
 * city's threshold, the live warped preview and its opacity, the residual table, and **Save**, which queues the job and
 * opens the version's page. A version that takes no points shows them read-only.
 */
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { MAPBOX_GL_CSS_URL } from '../../map/mapbox-loader.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { labelText } from '../imagery/imagery-text.js';
import { when } from '../imagery/when.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { panes } from './georef-panes.js';
import { previewControls, summary, tools, transforms, type GeorefContext } from './georef-parts.js';
import type { GeorefIntentsPort, GeorefVersionPort, GeorefViewState } from './georef-port.js';
import { georefStyles } from './georef-styles.js';
import type { HcmScanViewer } from './hcm-scan-viewer.js';
import { residualTable, type ResidualSort } from './residual-table.js';
import { SUGGESTIONS_HEADING_ID, suggestionsPanel, suggestionsStyles, type SuggestionDecision } from './suggestions-panel.js';

export const HCM_GEOREF_PAGE_TAG = 'hcm-georef-page';

class HcmGeorefPage extends AreaPage<GeorefViewState, GeorefIntentsPort> {
    static override readonly fillsPage: boolean = true;

    static override readonly properties = { ...AreaPage.properties, sort: { state: true }, mapCss: { attribute: false } };

    static override readonly styles = [...georefStyles, suggestionsStyles];

    protected readonly route: AdminRouteIdPort = 'georef';
    declare sort: ResidualSort;
    /** mapbox-gl.css of the pinned release ('' in tests: no network). */
    declare mapCss: string;
    /** The saved version the page opened. */
    #opened: string | null = null;

    constructor() {
        super();
        this.sort = 'pair';
        this.mapCss = MAPBOX_GL_CSS_URL;
        // Esc anywhere on the page: the half pair goes, else the selected pair is let go. The scan pane handles its own
        // (and marks it handled), so one press never does both.
        this.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
                this.intents?.cancelHalf();
            }
        });
    }

    protected storeOf(content: ContentPort): AreaPort<GeorefViewState, GeorefIntentsPort> | null {
        return content.georef;
    }

    protected override updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        const saved = this.#newlySaved();
        if (saved !== null) {
            this.#opened = saved;
            this.app?.intents.navigate({ id: 'imagery', params: ['version', saved] });
        }
    }

    /** The version a Save just queued, once (the page then opens it). */
    #newlySaved(): string | null {
        const saved = this.view?.saved ?? null;
        return saved === this.#opened ? null : saved;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        if (view.doc.status === 'error') {
            return errorTemplate(this.locale, view.doc.failure, () => this.intents?.retry());
        }
        return view.notFound ? this.#notFound() : this.#read(view);
    }

    #notFound(): TemplateResult {
        return html`<div class="page">
            <h2 tabindex="-1" data-detail-heading>${contentText(this.locale, 'adminContent.georef.notFound')}</h2>
            <p><a href="#/imagery">${contentText(this.locale, 'adminContent.georef.backToImagery')}</a></p>
        </div>`;
    }

    #read(view: GeorefViewState): TemplateResult {
        const version = view.version;
        return version === null ? loadingTemplate(this.locale) : this.#page(this.#context(view, version), version);
    }

    #context(view: GeorefViewState, version: GeorefVersionPort): GeorefContext {
        return {
            ...{ locale: this.locale, view, intents: this.intents, locked: this.readOnly || !version.editable },
            ...{ compact: this.state?.windowClass === 'compact', mapCss: this.mapCss, sort: this.sort },
            setSort: (sort) => {
                this.sort = sort;
            },
            addAtCentres: () => {
                this.#addAtCentres();
            },
        };
    }

    #page(context: GeorefContext, version: GeorefVersionPort): TemplateResult {
        const { locale, view, intents } = context;
        const title = `${contentText(locale, 'adminContent.georef.title')} · ${labelText(version.label, locale)}`;
        const readOnlyNote = when(
            !version.editable,
            () => html`<p class="note" data-state="read-only">${contentText(locale, 'adminContent.georef.notEditable')}</p>`,
        );
        return html`<div class="page" data-state=${view.adding ? 'adding' : 'editing'}>
            <h2 tabindex="-1" data-detail-heading>${title}</h2>
            ${reconnectingStatus(locale, view.doc.reconnecting)} ${readOnlyNote} ${summary(context)} ${transforms(context)}
            ${tools(context)} ${panes(context)} ${previewControls(context)} ${this.#suggestions(context)}
            <h3>${contentText(locale, 'adminContent.georef.pairs')}</h3>
            ${residualTable({
                ...{ locale, pairs: view.pairs, residuals: view.fit.residuals, selected: view.selected, sort: context.sort },
                readOnly: context.locked,
                onSort: context.setSort,
                onSelect: (id) => intents?.select(id),
                onToggle: (id) => intents?.toggle(id),
                onRemove: (id) => intents?.remove(id),
            })}
        </div>`;
    }

    /** The matcher's suggestions (M4 §2.5), above the pairs they join. */
    #suggestions(context: GeorefContext): TemplateResult {
        const { locale, view, intents } = context;
        return suggestionsPanel({
            ...{ locale, view: view.suggestions, locked: context.locked },
            onDecide: (decision, id, index) => {
                void this.#decide(decision, id, index);
            },
            onAcceptAll: () => {
                void this.#acceptAll();
            },
            onSelect: (id) => intents?.selectSuggestion(id),
        });
    }

    /** Accept or Reject, then the keyboard stays in the list: on the row that took this one's place, else the heading. */
    async #decide(decision: SuggestionDecision, id: string, index: number): Promise<void> {
        if (decision === 'accept') {
            this.intents?.acceptSuggestion(id);
        } else {
            this.intents?.rejectSuggestion(id);
        }
        await this.updateComplete;
        this.#focusSuggestion(index);
    }

    /** Accept all, then the keyboard lands on the panel's heading: the list it was in is replaced by "all decided". */
    async #acceptAll(): Promise<void> {
        this.intents?.acceptAllSuggestions();
        await this.updateComplete;
        this.renderRoot.querySelector<HTMLElement>(`#${SUGGESTIONS_HEADING_ID}`)?.focus();
    }

    #focusSuggestion(index: number): void {
        const rows = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('button.suggestion')];
        const next = rows[Math.min(index, rows.length - 1)] ?? this.renderRoot.querySelector<HTMLElement>(`#${SUGGESTIONS_HEADING_ID}`);
        next?.focus();
    }

    #addAtCentres(): void {
        const viewer = this.renderRoot.querySelector<HcmScanViewer>('hcm-scan-viewer');
        if (viewer !== null) {
            this.intents?.addAtCentres(viewer.centre);
        }
    }
}

export function defineHcmGeorefPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_GEOREF_PAGE_TAG) === undefined) {
        registry.define(HCM_GEOREF_PAGE_TAG, HcmGeorefPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-georef-page': HcmGeorefPage;
    }
}
