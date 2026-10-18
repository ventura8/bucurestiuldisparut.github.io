/**
 * `<hcm-admin-photo-list>`: the photos page's list pane (`docs/research/M2c-interfaces.md` §6.1, §6.2, §1.5; behaviours A08,
 * A10). Add photos (a file chooser) and the drop zone over the whole pane, the uploads, the filters (one query each),
 * the search over the loaded photos (title or author, a span of years), the bulk bar while photos are selected
 * (Publish, Unpublish, Author, source and licence, Confirm rights, Delete), and one row per photo: its check box, a link
 * to its editor with the thumbnail, title, years and author, its chips (unpublished, processing, refused with the
 * reason, rights to check, check the place) and its one-click actions (Confirm place, Confirm rights, the photo a
 * duplicate repeats). Rows far from the visible part of the pane are not rendered (`content-visibility`).
 */
import type { Locale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { emit } from '../../components/internal.js';
import { current, errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { FILTER_ORDER, bulkActionText, filterText, localized, messageText, partId, photoHref, photoText, yearsText } from './photo-text.js';
import { photoStyles } from './photo-styles.js';
import type { PhotoFilePort, PhotoFilterPort, PhotoRowPort, PhotosIntentsPort, PhotosViewState } from './photos-port.js';
import { uploadPanel } from './upload-panel.js';

export const HCM_ADMIN_PHOTO_LIST_TAG = 'hcm-admin-photo-list';

/** What the file chooser offers (HEIC too: the server's message explains it). */
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.tif,.tiff,.heic,.heif,image/jpeg,image/png,image/webp,image/tiff,image/heic,image/heif';

/** The files of a chooser or a drop, as the area takes them. */
export function photoFiles(files: FileList | null): PhotoFilePort[] {
    return [...(files ?? [])].map((file) => ({ name: file.name, size: file.size, data: file }));
}

/** A year typed in a search field, or null for an empty or impossible one. */
export function yearOf(text: string): number | null {
    const year = Number.parseInt(text, 10);
    return Number.isInteger(year) && year >= 1000 && year <= 9999 ? year : null;
}

/** A chip of a row: its tone and text. */
function tag(tone: string, text: string): TemplateResult {
    return html`<span class="tag" data-tone=${tone}>${text}</span>`;
}

export class HcmAdminPhotoList extends LitElement {
    static override readonly properties = {
        view: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        selected: { type: String },
        over: { state: true },
    };

    static override readonly styles = photoStyles;

    declare view: PhotosViewState | null;
    declare intents: PhotosIntentsPort | null;
    declare locale: Locale;
    /** The photo open in the editor (`aria-current`), or ''. */
    declare selected: string;
    /** Files are dragged over the pane. */
    declare over: boolean;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'ro';
        this.selected = '';
        this.over = false;
        this.addEventListener('dragover', this.#onDragOver);
        this.addEventListener('dragleave', this.#onDragLeave);
        this.addEventListener('drop', this.#onDrop);
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<div class="pane">
            <div class="toolbar">
                <h2>${photoText(locale, 'adminContent.photos.title')}</h2>
                <hcm-button variant="filled" icon="add_photo_alternate" @click=${this.#choose}
                    >${photoText(locale, 'adminContent.photos.add')}</hcm-button
                >
                <input class="file-input" type="file" multiple accept=${PHOTO_ACCEPT} hidden @change=${this.#chosen} />
            </div>
            <div class="drop" ?data-over=${this.over}>
                <p class="note">${photoText(locale, this.over ? 'adminContent.photos.dropActive' : 'adminContent.photos.dropHint')}</p>
                ${uploadPanel({ locale, items: view.uploads, sticky: view.sticky, intents: this.intents, href: photoHref })}
            </div>
            ${this.#filters(locale, view)} ${this.#search(locale, view)} ${this.#bulk(locale, view)}
            ${reconnectingStatus(locale, view.list.reconnecting)} ${this.#body(locale, view)}
        </div>`;
    }

    #filters(locale: Locale, view: PhotosViewState): TemplateResult {
        return html`<div class="chips filters" role="group" aria-label=${photoText(locale, 'adminContent.photos.filters')}>
            ${FILTER_ORDER.map((filter) => this.#chip(locale, view.list.filter, filter))}
        </div>`;
    }

    #chip(locale: Locale, selected: PhotoFilterPort, filter: PhotoFilterPort): TemplateResult {
        const choose = (event: Event): void => {
            // One filter at a time: pressing the pressed chip keeps it pressed.
            (event.currentTarget as HTMLElement & { selected: boolean }).selected = true;
            this.intents?.setFilter(filter);
        };
        return html`<hcm-chip .label=${filterText(locale, filter)} .selected=${filter === selected} @hcm-change=${choose}></hcm-chip>`;
    }

    #search(locale: Locale, view: PhotosViewState): TemplateResult {
        const search = view.list.search;
        const changed = (): void => {
            const value = (name: string): string => this.renderRoot.querySelector<HTMLInputElement>(`[name="${name}"]`)?.value ?? '';
            this.intents?.search({ text: value('text'), yearFrom: yearOf(value('yearFrom')), yearTo: yearOf(value('yearTo')) });
        };
        return html`<div class="search">
            <div class="field">
                <label for="search-text">${photoText(locale, 'adminContent.photos.search')}</label>
                <input id="search-text" name="text" type="search" .value=${search.text} @input=${changed} />
            </div>
            <div class="years">
                ${this.#yearField('yearFrom', photoText(locale, 'adminContent.photos.yearFrom'), search.yearFrom, changed)}
                ${this.#yearField('yearTo', photoText(locale, 'adminContent.photos.yearTo'), search.yearTo, changed)}
            </div>
        </div>`;
    }

    #yearField(name: string, label: string, value: number | null, changed: () => void): TemplateResult {
        return html`<div class="field">
            <label for=${partId('search', name)}>${label}</label>
            <input
                id=${partId('search', name)}
                name=${name}
                type="number"
                inputmode="numeric"
                min="1800"
                max="2100"
                .value=${value === null ? '' : String(value)}
                @input=${changed}
            />
        </div>`;
    }

    #bulk(locale: Locale, view: PhotosViewState): TemplateResult {
        const selection = view.list.selection;
        if (selection.length === 0) {
            return this.#selectAll(locale, view);
        }
        const intents = this.intents;
        const disabled = view.busy;
        return html`<section class="bulk" aria-label=${photoText(locale, 'adminContent.photos.bulk.actions')}>
            <p role="status">${photoText(locale, 'adminContent.photos.bulk.selected', { count: String(selection.length) })}</p>
            <div class="actions">
                <hcm-button variant="text" icon="select_all" @click=${() => intents?.selectAll()}
                    >${photoText(locale, 'adminContent.photos.bulk.selectAll')}</hcm-button
                >
                <hcm-button variant="text" icon="deselect" @click=${() => intents?.clearSelection()}
                    >${photoText(locale, 'adminContent.photos.bulk.clear')}</hcm-button
                >
            </div>
            <div class="actions">
                <hcm-button variant="filled" icon="publish" ?disabled=${disabled} @click=${() => void intents?.bulk({ kind: 'publish' })}
                    >${bulkActionText(locale, 'publish')}</hcm-button
                >
                <hcm-button
                    variant="tonal"
                    icon="unpublished"
                    ?disabled=${disabled}
                    @click=${() => void intents?.bulk({ kind: 'unpublish' })}
                    >${bulkActionText(locale, 'unpublish')}</hcm-button
                >
                <hcm-button
                    variant="tonal"
                    icon="edit"
                    ?disabled=${disabled}
                    @click=${() => {
                        emit(this, 'hcm-set-fields');
                    }}
                    >${bulkActionText(locale, 'setFields')}</hcm-button
                >
                <hcm-button variant="tonal" icon="check" ?disabled=${disabled} @click=${() => void intents?.bulk({ kind: 'confirmRights' })}
                    >${bulkActionText(locale, 'confirmRights')}</hcm-button
                >
                <hcm-button variant="tonal" icon="delete" ?disabled=${disabled} @click=${() => intents?.requestDelete(selection)}
                    >${photoText(locale, 'adminContent.photos.bulk.deleteAction')}</hcm-button
                >
            </div>
        </section>`;
    }

    /**
     * Select all before anything is selected: a batch just added is published in three inputs (the files, Select all,
     * Publish: `CONTENT_INPUT_BUDGETS.photoBatch`, `S-A30-HAPPY-CONTENT`), never one row's check box first.
     */
    #selectAll(locale: Locale, view: PhotosViewState): TemplateResult {
        if (view.list.rows.length === 0) {
            return EMPTY;
        }
        return html`<div class="actions">
            <hcm-button variant="text" icon="select_all" @click=${() => this.intents?.selectAll()}
                >${photoText(locale, 'adminContent.photos.bulk.selectAll')}</hcm-button
            >
        </div>`;
    }

    #body(locale: Locale, view: PhotosViewState): TemplateResult {
        const list = view.list;
        if (list.status === 'error') {
            return errorTemplate(locale, list.failure, () => this.intents?.retry());
        }
        if (list.rows.length === 0) {
            return this.#none(locale, view);
        }
        const selection = new Set(list.selection);
        return html`<p class="note">${photoText(locale, 'adminContent.photos.count', { count: String(list.rows.length) })}</p>
            <ul class="rows" aria-label=${photoText(locale, 'adminContent.photos.list')}>
                ${list.rows.map((row) => this.#row(locale, row, selection.has(row.id)))}
            </ul>
            ${
                list.hasMore
                    ? html`<div class="actions">
                          <hcm-button variant="text" icon="expand_more" @click=${() => this.intents?.more()}
                              >${photoText(locale, 'adminContent.photos.more')}</hcm-button
                          >
                      </div>`
                    : EMPTY
            }`;
    }

    /** Loading, no photo at all (the drop zone is the action), or no loaded photo matching the search. */
    #none(locale: Locale, view: PhotosViewState): TemplateResult {
        if (view.list.status === 'loading') {
            return loadingTemplate(locale);
        }
        const key = view.list.loaded === 0 ? 'adminContent.photos.empty' : 'adminContent.photos.noMatch';
        return html`<hcm-empty-state icon="photo_library" .text=${photoText(locale, key)}></hcm-empty-state>`;
    }

    #row(locale: Locale, row: PhotoRowPort, selected: boolean): TemplateResult {
        const title = localized(locale, row.title);
        const detail = [yearsText(locale, row.year, row.yearEnd), row.author].filter((part): part is string => part !== null).join(' · ');
        return html`<li class="photo-row">
            <span class="select">
                <input
                    class="touch-target"
                    type="checkbox"
                    .checked=${selected}
                    aria-label=${photoText(locale, 'adminContent.photos.select', { title })}
                    @change=${() => this.intents?.toggleSelected(row.id)}
                />
            </span>
            <a class="photo" href=${photoHref(row.id)} aria-current=${current(row.id === this.selected)}>
                ${row.thumb === null ? html`<span class="thumb"><hcm-icon name="image"></hcm-icon></span>` : html`<img class="thumb" src=${row.thumb} alt="" loading="lazy" />`}
                <span class="row-text"><span class="row-title">${title}</span><span class="row-detail">${detail}</span></span>
            </a>
            ${this.#chips(locale, row)} ${this.#actions(locale, row)}
        </li>`;
    }

    #chips(locale: Locale, row: PhotoRowPort): TemplateResult {
        const tags = [...this.#stateChips(locale, row), ...this.#reviewChips(locale, row)];
        return tags.length === 0 ? EMPTY : html`<div class="row-chips">${tags}</div>`;
    }

    /** Processing, refused (with the reason), unpublished. */
    #stateChips(locale: Locale, row: PhotoRowPort): TemplateResult[] {
        const tags: TemplateResult[] = [];
        if (row.processing === 'pending') {
            tags.push(tag('wait', photoText(locale, 'adminContent.photos.chip.processing')));
        }
        if (row.error !== null) {
            tags.push(tag('error', messageText(locale, row.error)));
        }
        if (!row.published && row.processing === 'done') {
            tags.push(tag('neutral', photoText(locale, 'adminContent.photos.chip.unpublished')));
        }
        return tags;
    }

    /** Rights to check, the place to check. */
    #reviewChips(locale: Locale, row: PhotoRowPort): TemplateResult[] {
        const tags: TemplateResult[] = [];
        if (row.rightsReview) {
            tags.push(tag('wait', photoText(locale, 'adminContent.photos.chip.rightsReview')));
        }
        if (row.checkPlace) {
            tags.push(tag('wait', photoText(locale, 'adminContent.photos.chip.checkPlace')));
        }
        return tags;
    }

    #actions(locale: Locale, row: PhotoRowPort): TemplateResult {
        const actions = [...this.#reviewActions(locale, row), ...this.#refusalActions(locale, row)];
        return actions.length === 0 ? EMPTY : html`<div class="row-actions">${actions}</div>`;
    }

    /** One click: the fallback pin is right; the rights are confirmed. */
    #reviewActions(locale: Locale, row: PhotoRowPort): TemplateResult[] {
        const intents = this.intents;
        const actions: TemplateResult[] = [];
        if (row.checkPlace) {
            actions.push(
                html`<hcm-button variant="text" icon="place" @click=${() => intents?.confirmPlace(row.id)}
                    >${photoText(locale, 'adminContent.photos.confirmPlace')}</hcm-button
                >`,
            );
        }
        if (row.rightsReview) {
            actions.push(
                html`<hcm-button variant="text" icon="check" @click=${() => void intents?.confirmRights(row.id)}
                    >${photoText(locale, 'adminContent.photos.confirmRights')}</hcm-button
                >`,
            );
        }
        return actions;
    }

    /** A refused file: the photo it repeats, and Delete. */
    #refusalActions(locale: Locale, row: PhotoRowPort): TemplateResult[] {
        const actions: TemplateResult[] = [];
        if (row.duplicateOf !== null) {
            actions.push(
                html`<a class="external" href=${photoHref(row.duplicateOf)}>${photoText(locale, 'adminContent.photos.openDuplicate')}</a>`,
            );
        }
        if (row.error !== null) {
            const title = localized(locale, row.title);
            actions.push(
                html`<hcm-button variant="text" icon="delete" @click=${() => this.intents?.requestDelete([row.id])}
                    >${photoText(locale, 'adminContent.photos.deleteOne', { title })}</hcm-button
                >`,
            );
        }
        return actions;
    }

    readonly #choose = (): void => {
        this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
    };

    readonly #chosen = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        this.#upload(input.files);
        input.value = '';
    };

    #upload(files: FileList | null): void {
        const chosen = photoFiles(files);
        if (chosen.length > 0) {
            this.intents?.upload(chosen);
        }
    }

    readonly #onDragOver = (event: DragEvent): void => {
        if (event.dataTransfer?.types.includes('Files') === true) {
            event.preventDefault();
            this.over = true;
        }
    };

    readonly #onDragLeave = (event: DragEvent): void => {
        if (event.relatedTarget === null || !this.contains(event.relatedTarget as Node)) {
            this.over = false;
        }
    };

    readonly #onDrop = (event: DragEvent): void => {
        event.preventDefault();
        this.over = false;
        this.#upload(event.dataTransfer?.files ?? null);
    };
}

/** Registers `<hcm-admin-photo-list>` once; calling it again is a no-op. */
export function defineHcmAdminPhotoList(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_PHOTO_LIST_TAG) === undefined) {
        registry.define(HCM_ADMIN_PHOTO_LIST_TAG, HcmAdminPhotoList);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-photo-list': HcmAdminPhotoList;
    }
}
