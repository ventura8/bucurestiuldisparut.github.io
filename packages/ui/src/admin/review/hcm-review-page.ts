/**
 * `<hcm-review-page>`: `#/review` (M13, `docs/research/M13-roles.md` §8; behaviours A90, A92, A93): what uploaders added, the
 * public's suggestions with the photo as it is and as proposed side by side on one map, and for the city's owners the requests
 * for a role. Text only: what strangers typed is shown through Lit's text bindings, and a source link must be https.
 */
import { pluralOf, type Locale, type SuggestionProposal } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { defineUiKit } from '../../components/define.js';
import { AreaPage } from '../editing/area-page.js';
import { defineEditingElements } from '../editing/define.js';
import { editingStyles } from '../editing/editing-styles.js';
import { reconnectingStatus } from '../editing/states.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, shellText } from '../shell/text.js';
import type { ListStatePort } from '../area-port.js';
import type { ReviewIntentsPort, ReviewItemPort, ReviewRequestPort, ReviewSuggestionPort, ReviewViewState } from './review-port.js';

export const HCM_REVIEW_PAGE_TAG = 'hcm-review-page';

const styles = css`
    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-block-end: 24px;
    }

    li.card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-surface-container, Canvas);
        overflow-wrap: anywhere;
    }

    img {
        max-inline-size: 160px;
        border-radius: var(--md-sys-shape-corner-small, 8px);
    }

    hcm-admin-map {
        display: block;
        block-size: 320px;
    }

    ul {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 0;
        list-style: none;
    }
`;

function yearsOf(year: number | undefined, yearEnd: number | undefined): string | null {
    if (year === undefined) {
        return null;
    }
    return yearEnd === undefined ? String(year) : `${String(year)}–${String(yearEnd)}`;
}

function placeOf({ location, bearing }: SuggestionProposal): readonly (string | null)[] {
    return [
        location === undefined ? null : `${String(location.lat)}, ${String(location.lng)}`,
        bearing === undefined ? null : `${String(bearing)}°`,
    ];
}

/** A proposal's or a photo's facts as one line: its place, its direction, its date. */
function factsOf(proposal: SuggestionProposal | null, none: string): string {
    const facts = proposal ?? {};
    const parts = [...placeOf(facts), yearsOf(facts.year, facts.yearEnd), facts.dateText ?? null].filter((part) => part !== null);
    return parts.length === 0 ? none : parts.join(' · ');
}

function nameIn(locale: Locale, title: { readonly ro: string; readonly en?: string | undefined }): string {
    return locale === 'en' ? (title.en ?? title.ro) : title.ro;
}

class HcmReviewPage extends AreaPage<ReviewViewState, ReviewIntentsPort> {
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, styles];

    protected readonly route: AdminRouteIdPort = 'review';

    protected storeOf(content: ContentPort): AreaPort<ReviewViewState, ReviewIntentsPort> | null {
        return content.review;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="pane">
            <h2>${contentText(locale, 'adminContent.review.title')}</h2>
            ${reconnectingStatus(locale, view.suggestions.reconnecting)}
            ${this.#section(locale, 'adminContent.review.uploads', [...view.photos.items, ...view.places.items], (item) => this.#item(locale, view, item))}
            ${this.#section(locale, 'adminContent.review.suggestions', view.suggestions.items, (row) => this.#suggestion(locale, view, row))}
            ${this.#map(locale, view)}
            ${this.#section(locale, 'adminContent.review.decided', view.decided.items, (row) => this.#decided(locale, row))}
            ${view.requests === null ? nothing : this.#requests(locale, view.requests)}
        </div>`;
    }

    #section<Item>(
        locale: Locale,
        title: Parameters<typeof contentText>[1],
        items: readonly Item[],
        row: (item: Item) => TemplateResult,
    ): TemplateResult {
        return html`<section aria-label=${contentText(locale, title)}>
            <h3>${contentText(locale, title)}</h3>
            ${
                items.length === 0
                    ? html`<p class="note">${contentText(locale, 'adminContent.review.empty')}</p>`
                    : html`<ul>
                          ${items.map(row)}
                      </ul>`
            }
        </section>`;
    }

    #requests(locale: Locale, list: ListStatePort<ReviewRequestPort>): TemplateResult {
        return this.#section(locale, 'adminContent.review.requests', list.items, (row) => this.#request(locale, row));
    }

    #note(id: string, locale: Locale): TemplateResult {
        const field = `note-${id}`;
        return html`<div class="field">
            <label for=${field}>${contentText(locale, 'adminContent.review.note')}</label>
            <input id=${field} maxlength="500" />
        </div>`;
    }

    /** The note typed beside the button that was pressed. */
    #noteOf(id: string): string {
        return this.renderRoot.querySelector<HTMLInputElement>(`#note-${id}`)?.value ?? '';
    }

    #button(label: string, icon: string, act: () => void): TemplateResult {
        return html`<hcm-button variant="tonal" icon=${icon} ?disabled=${this.view?.busy === true || this.readOnly} @click=${act}
            >${label}</hcm-button
        >`;
    }

    #item(locale: Locale, view: ReviewViewState, item: ReviewItemPort): TemplateResult {
        const title = nameIn(locale, item.title);
        const picture = item.thumbPath === null ? undefined : view.pictures[item.thumbPath];
        const href = item.entity === 'photo' ? `#/photos/${item.id}` : `#/pois/${item.id}`;
        const key = `${item.entity}-${item.id}`;
        return html`<li class="card">
            <strong>${contentText(locale, `adminContent.review.entity.${item.entity}`)}: ${title}</strong>
            ${picture === undefined ? nothing : html`<img src=${picture} alt=${contentText(locale, 'adminContent.review.picture', { title })} />`}
            ${item.credit === null ? nothing : html`<span>${contentText(locale, 'adminContent.review.credit', { name: item.credit })}</span>`}
            <a href=${href}>${contentText(locale, 'adminContent.review.open')}</a>
            ${this.#note(key, locale)}
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', () => void this.intents?.decideItem(item, 'approve', this.#noteOf(key)))}
                ${this.#button(contentText(locale, 'adminContent.review.refuse'), 'close', () => void this.intents?.decideItem(item, 'refuse', this.#noteOf(key)))}
            </div>
        </li>`;
    }

    #voice(locale: Locale, voice: ReviewSuggestionPort['voices'][number]): TemplateResult {
        return html`<div>
            ${voice.reason === null ? nothing : html`<p>${voice.reason}</p>`}
            ${voice.sourceUrl === null ? nothing : html`<p><a href=${voice.sourceUrl} target="_blank" rel="noopener noreferrer nofollow ugc">${contentText(locale, 'adminContent.review.source')}</a></p>`}
            ${voice.credit === null ? nothing : html`<p>${contentText(locale, 'adminContent.review.credit', { name: voice.credit })}</p>`}
            ${this.#button(contentText(locale, 'adminContent.review.block'), 'block', () => void this.intents?.block(voice.uid))}
        </div>`;
    }

    #suggestion(locale: Locale, view: ReviewViewState, row: ReviewSuggestionPort): TemplateResult {
        const shown = view.selected === row.id;
        const none = contentText(locale, 'adminContent.review.noPlace');
        const count = contentText(locale, `adminContent.review.count.${pluralOf(locale, row.count)}`, { count: String(row.count) });
        return html`<li class="card">
            <strong>${nameIn(locale, row.title)}</strong>
            <img src=${row.thumb} alt=${contentText(locale, 'adminContent.review.picture', { title: nameIn(locale, row.title) })} />
            <span>${contentText(locale, `adminContent.review.kind.${row.kind}`)} · ${count}</span>
            ${shown ? html`<span>${contentText(locale, 'adminContent.review.current', { value: factsOf(view.current, none) })}</span>` : nothing}
            <span
                >${contentText(locale, 'adminContent.review.proposed', { value: factsOf(shown ? (view.adjusted ?? row.proposal) : row.proposal, none) })}</span
            >
            ${row.voices.map((voice) => this.#voice(locale, voice))} ${this.#note(row.id, locale)}
            <div class="actions">
                ${shown ? this.#decisions(locale, view, row) : this.#button(contentText(locale, 'adminContent.review.compare'), 'compare', () => this.intents?.select(row.id))}
            </div>
        </li>`;
    }

    #decisions(locale: Locale, view: ReviewViewState, row: ReviewSuggestionPort): TemplateResult {
        const decide = (decision: 'approve' | 'adjust' | 'reject') => () =>
            void this.intents?.decideSuggestion(row.id, decision, this.#noteOf(row.id));
        return html`${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', decide('approve'))}
        ${
            view.adjusted === null
                ? this.#button(contentText(locale, 'adminContent.review.adjust'), 'edit', () => this.intents?.startAdjusting())
                : this.#button(contentText(locale, 'adminContent.review.apply'), 'edit', decide('adjust'))
        }
        ${this.#button(contentText(locale, 'adminContent.review.reject'), 'close', decide('reject'))}`;
    }

    #decided(locale: Locale, row: ReviewSuggestionPort): TemplateResult {
        return html`<li class="card">
            <strong>${nameIn(locale, row.title)}</strong>
            <span>${factsOf(row.proposal, '')}</span>
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.revert'), 'undo', () => void this.intents?.revert(row))}
            </div>
        </li>`;
    }

    #request(locale: Locale, row: ReviewRequestPort): TemplateResult {
        const role = shellText(locale, `adminShell.city.role.${row.role}`);
        const decide = (decision: 'approve' | 'refuse') => () => void this.intents?.decideRequest(row.uid, decision, this.#noteOf(row.uid));
        return html`<li class="card">
            <strong>${contentText(locale, 'adminContent.review.who', { name: row.name, email: row.email })}</strong>
            <span>${contentText(locale, 'adminContent.review.asks', { role })}</span>
            <p>${row.reason}</p>
            ${row.credit === null ? nothing : html`<span>${contentText(locale, 'adminContent.review.credit', { name: row.credit })}</span>`}
            ${this.#note(row.uid, locale)}
            <div class="actions">
                ${this.#button(contentText(locale, 'adminContent.review.approve'), 'check', decide('approve'))}
                ${this.#button(contentText(locale, 'adminContent.review.refuse'), 'close', decide('refuse'))}
            </div>
        </li>`;
    }

    #map(locale: Locale, view: ReviewViewState): TemplateResult {
        if (view.selected === null) {
            return EMPTY;
        }
        const adjusting = html`<p role="status">${contentText(locale, 'adminContent.review.adjusting')}</p>`;
        return html`<hcm-admin-map
                .status=${view.map}
                .locale=${locale}
                @hcm-map-host=${(event: CustomEvent<{ readonly container: HTMLElement }>) => this.intents?.attachMap(event.detail.container)}
                @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
            ></hcm-admin-map>
            ${view.adjusted === null ? nothing : adjusting}`;
    }
}

/** Registers `<hcm-review-page>` and what it renders; idempotent per registry. */
export function defineHcmReviewPage(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineHcmAdminMap(registry);
    if (registry.get(HCM_REVIEW_PAGE_TAG) === undefined) {
        registry.define(HCM_REVIEW_PAGE_TAG, HcmReviewPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-review-page': HcmReviewPage;
    }
}
