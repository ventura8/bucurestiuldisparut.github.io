/**
 * `<hcm-admin-photo-editor>`: one photo's editor in the detail pane (`docs/research/M2c-interfaces.md` §6.3, §1.3, §5;
 * behaviours A09, A37, A38). Its top row is the photo's title (the heading that takes the focus), where the draft stands
 * (Saved, Unsaved changes, Saving…) and Save, disabled while the draft is clean or invalid (its description names the
 * first problem); History and Delete follow. The conflict and gone banners, then the sections: image, texts, date,
 * author and rights, links, place and direction, publishing. Every change is a draft the page's map previews; Save
 * writes it.
 */
import { translate, type Locale } from '@hcm/shared';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { creditsSection, datesSection, linksSection, publishingSection, textsSection, type SectionInput } from './editor-sections.js';
import { imageSection, placeSection } from './editor-place.js';
import { PHOTO_ACCEPT, photoFiles } from './hcm-admin-photo-list.js';
import { historyHref, localized, photoText } from './photo-text.js';
import { photoStyles } from './photo-styles.js';
import type { PhotoEditorPort, PhotosIntentsPort, PhotoValuePort } from './photos-port.js';

export const HCM_ADMIN_PHOTO_EDITOR_TAG = 'hcm-admin-photo-editor';

/** Whether Save may run: changes, no problem, no conflict, not saving, the photo still there. */
export function canSave(editor: PhotoEditorPort): boolean {
    const clean = editor.dirty.length === 0 || editor.issues.length > 0;
    return !clean && editor.conflict === null && !editor.saving && editor.status === 'ready';
}

function saveState(locale: Locale, editor: PhotoEditorPort): string {
    if (editor.saving) {
        return photoText(locale, 'adminContent.photos.editor.saving');
    }
    return photoText(locale, editor.dirty.length === 0 ? 'adminContent.photos.editor.saved' : 'adminContent.photos.editor.unsaved');
}

export class HcmAdminPhotoEditor extends LitElement {
    static override readonly properties = {
        editor: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        mapReady: { type: Boolean, attribute: 'map-ready' },
    };

    static override readonly styles = photoStyles;

    declare editor: PhotoEditorPort | null;
    declare intents: PhotosIntentsPort | null;
    declare locale: Locale;
    declare mapReady: boolean;
    /** The list-detail layout asked for the focus before the heading was there (the photo still loading). */
    #wantsFocus = false;

    constructor() {
        super();
        this.editor = null;
        this.intents = null;
        this.locale = 'ro';
        this.mapReady = false;
    }

    /**
     * The layout's `[data-detail-heading]` is this element: its heading (inside the shadow root) takes the focus, now or
     * once the photo has loaded.
     */
    override focus(options?: FocusOptions): void {
        this.#wantsFocus = !this.#focusHeading(options);
    }

    protected override updated(): void {
        if (this.#wantsFocus) {
            this.#wantsFocus = !this.#focusHeading();
        }
    }

    #focusHeading(options?: FocusOptions): boolean {
        const heading = this.renderRoot.querySelector<HTMLElement>('[data-detail-heading]');
        heading?.focus(options);
        return heading !== null;
    }

    override render(): TemplateResult {
        const editor = this.editor;
        if (editor === null) {
            return EMPTY;
        }
        const locale = this.locale;
        if (editor.status === 'loading') {
            return loadingTemplate(locale);
        }
        if (editor.status === 'error') {
            return errorTemplate(locale, editor.failure, () => this.intents?.retryPhoto());
        }
        return editor.value === null ? this.#notFound(locale, editor) : this.#form(locale, editor, editor.value);
    }

    #notFound(locale: Locale, editor: PhotoEditorPort): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${photoText(locale, 'adminContent.photos.editor.notFound')}</h2>
            <p><a href=${historyHref(editor.id)}>${photoText(locale, 'adminContent.photos.editor.seeHistory')}</a></p>
        </div>`;
    }

    #form(locale: Locale, editor: PhotoEditorPort, value: PhotoValuePort): TemplateResult {
        const input: SectionInput = {
            locale,
            value,
            issues: editor.issues,
            edit: (patch) => {
                this.intents?.edit(patch);
            },
        };
        const place = { locale, editor, value, issues: editor.issues, intents: this.intents, mapReady: this.mapReady };
        return html`<div class="pane form">
            ${this.#head(locale, editor, value)} ${this.#banners(locale, editor)} ${reconnectingStatus(locale, editor.reconnecting)}
            ${imageSection(place, this.#choose)} ${textsSection(input)} ${datesSection(input)} ${creditsSection(input)}
            ${linksSection(input)} ${placeSection(place)} ${publishingSection(input, editor)}
            <input class="file-input" type="file" accept=${PHOTO_ACCEPT} hidden @change=${this.#chosen} />
        </div>`;
    }

    #head(locale: Locale, editor: PhotoEditorPort, value: PhotoValuePort): TemplateResult {
        const first = editor.issues[0];
        const why =
            first === undefined
                ? null
                : photoText(locale, 'adminContent.photos.editor.firstIssue', { field: translate(locale, first.code) });
        const save = async (): Promise<void> => {
            await this.intents?.save();
        };
        return html`<div class="editor-head">
                <h2 tabindex="-1" data-detail-heading>
                    ${photoText(locale, 'adminContent.photos.editor.title', { title: localized(locale, value.title) })}
                </h2>
                <span class="note" role="status">${saveState(locale, editor)}</span>
                <hcm-button
                    variant="filled"
                    icon="check"
                    ?disabled=${!canSave(editor)}
                    aria-describedby=${why === null ? nothing : 'save-why'}
                    @click=${save}
                    >${photoText(locale, 'adminContent.photos.editor.save')}</hcm-button
                >
            </div>
            ${why === null ? nothing : html`<p class="note" id="save-why">${why}</p>`}
            <div class="actions">
                <a class="external" href=${historyHref(editor.id)}
                    ><hcm-icon name="history"></hcm-icon>${photoText(locale, 'adminContent.photos.editor.history')}</a
                >
                ${editor.touched ? html`<hcm-button variant="text" icon="undo" @click=${() => this.intents?.discard()}>${photoText(locale, 'adminContent.photos.editor.discard')}</hcm-button>` : nothing}
                <hcm-button variant="text" icon="delete" @click=${() => this.intents?.requestDelete()}
                    >${photoText(locale, 'adminContent.photos.editor.delete')}</hcm-button
                >
            </div>`;
    }

    #banners(locale: Locale, editor: PhotoEditorPort): TemplateResult {
        if (editor.status === 'gone') {
            return html`<p class="alert" role="alert">${photoText(locale, 'adminContent.photos.editor.gone')}</p>`;
        }
        const conflict = editor.conflict;
        if (conflict === null) {
            return EMPTY;
        }
        return html`<div class="banner" role="alert">
            <p>${photoText(locale, 'adminContent.photos.editor.conflict', { fields: conflict.fields.join(', ') })}</p>
            <div class="actions">
                <hcm-button variant="tonal" @click=${() => this.intents?.keepMine()}
                    >${photoText(locale, 'adminContent.photos.editor.keepMine')}</hcm-button
                >
                <hcm-button variant="text" @click=${() => this.intents?.takeTheirs()}
                    >${photoText(locale, 'adminContent.photos.editor.takeTheirs')}</hcm-button
                >
            </div>
        </div>`;
    }

    readonly #choose = (): void => {
        this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
    };

    readonly #chosen = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        const [file] = photoFiles(input.files);
        input.value = '';
        if (file !== undefined) {
            this.intents?.replaceImage(file);
        }
    };
}

/** Registers `<hcm-admin-photo-editor>` once; calling it again is a no-op. */
export function defineHcmAdminPhotoEditor(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_PHOTO_EDITOR_TAG) === undefined) {
        registry.define(HCM_ADMIN_PHOTO_EDITOR_TAG, HcmAdminPhotoEditor);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-photo-editor': HcmAdminPhotoEditor;
    }
}
