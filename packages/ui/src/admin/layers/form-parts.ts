/**
 * The pieces the layer editor and the settings sections share (`docs/research/M2c-interfaces.md` §1.6, §1.3): a native
 * field with its label, help and error (the problem at the field: `aria-invalid`, `aria-describedby`, the validation
 * key's text), a 0–100 % slider row with its value, the editor's top row (title, save state, Save, Discard) and the
 * conflict and gone banners. Text only: every value is bound as a property or text, never as markup.
 */
import { translate, type AdminContentKey, type Locale, type ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';
import { live } from 'lit/directives/live.js';

import { contentText } from '../shell/text.js';

export interface FieldSpec {
    /** The input's id, unique in the page (the issue's path when it maps to one). */
    readonly id: string;
    readonly label: string;
    readonly value: string;
    /** The problem Save found at this field, or null. */
    readonly issue: ValidationIssue | null;
    readonly help?: string;
    readonly type?: 'text' | 'url' | 'date';
    /** `decimal` for coordinates and zooms (a numeric keyboard); `numeric` for a year. */
    readonly inputMode?: 'decimal' | 'numeric';
    readonly multiline?: boolean;
    readonly required?: boolean;
    readonly onInput: (text: string) => void;
}

function describedBy(spec: FieldSpec): string | typeof nothing {
    const ids = [spec.help === undefined ? '' : `${spec.id}-help`, spec.issue === null ? '' : `${spec.id}-error`].filter((id) => id !== '');
    return ids.length === 0 ? nothing : ids.join(' ');
}

function inputOf(spec: FieldSpec): TemplateResult {
    const input = (event: Event): void => {
        spec.onInput((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    };
    const invalid = spec.issue === null ? 'false' : 'true';
    if (spec.multiline === true) {
        return html`<textarea
            id=${spec.id}
            rows="5"
            .value=${live(spec.value)}
            ?required=${spec.required === true}
            aria-invalid=${invalid}
            aria-describedby=${describedBy(spec)}
            @input=${input}
        ></textarea>`;
    }
    return html`<input
        id=${spec.id}
        type=${spec.type ?? 'text'}
        inputmode=${spec.inputMode ?? nothing}
        .value=${live(spec.value)}
        ?required=${spec.required === true}
        aria-invalid=${invalid}
        aria-describedby=${describedBy(spec)}
        @input=${input}
    />`;
}

/** One labelled field; its problem, when Save found one, is said under it and named to assistive technology. */
export function field(locale: Locale, spec: FieldSpec): TemplateResult {
    const helpId = `${spec.id}-help`;
    const errorId = `${spec.id}-error`;
    return html`<div class="field" ?data-invalid=${spec.issue !== null}>
        <label for=${spec.id}>${spec.label}</label>
        ${inputOf(spec)} ${spec.help === undefined ? nothing : html`<span class="note" id=${helpId}>${spec.help}</span>`}
        ${spec.issue === null ? nothing : html`<span class="error" id=${errorId}>${translate(locale, spec.issue.code)}</span>`}
    </div>`;
}

/** The first issue at `path` or below it (`label` finds `label.ro`). */
export function issueAt(issues: readonly ValidationIssue[], path: string): ValidationIssue | null {
    return issues.find((issue) => issue.path === path || issue.path.startsWith(`${path}.`) || issue.path.startsWith(`${path}[`)) ?? null;
}

export interface SliderSpec {
    readonly label: string;
    readonly min: number;
    readonly max: number;
    readonly value: number;
    /** What the slider and its value say (`40 %`, `+20 %`). */
    readonly valueText: string;
    /** Every frame while it moves and on release. */
    readonly onValue: (value: number) => void;
    /** Once it settles (release, a key press): what to announce. */
    readonly onSettled: (value: number) => void;
}

function sliderValue(event: Event): number {
    event.stopPropagation();
    return (event as CustomEvent<{ value: number }>).detail.value;
}

/**
 * A labelled slider with its value beside it (the value is the slider's `aria-valuetext` too). The value is bound `live`:
 * a move the store refuses or clamps (the black level stopped at the white) is put back on the slider, which moved itself.
 */
export function sliderRow(spec: SliderSpec): TemplateResult {
    return html`<div class="slider-row">
        <span class="slider-label" aria-hidden="true">${spec.label}</span>
        <hcm-slider
            min=${spec.min}
            max=${spec.max}
            step="1"
            .value=${live(spec.value)}
            label=${spec.label}
            value-text=${spec.valueText}
            @hcm-input=${(event: Event) => {
                spec.onValue(sliderValue(event));
            }}
            @hcm-change=${(event: Event) => {
                const value = sliderValue(event);
                spec.onValue(value);
                spec.onSettled(value);
            }}
        ></hcm-slider>
        <span class="slider-value" aria-hidden="true">${spec.valueText}</span>
    </div>`;
}

export interface SaveTexts {
    readonly saved: AdminContentKey;
    readonly unsaved: AdminContentKey;
    readonly saving: AdminContentKey;
}

export interface SaveState {
    readonly dirty: boolean;
    readonly saving: boolean;
    /** A conflict to resolve, a deleted document or a problem in a field: Save is off. */
    readonly blocked: boolean;
}

/** The save row's state of a draft: Save is off while there is a conflict, the document is gone or a field has a problem. */
export function saveStateOf(draft: {
    readonly dirty: boolean;
    readonly saving: boolean;
    readonly conflict: unknown;
    readonly gone: boolean;
    readonly issues: readonly unknown[];
}): SaveState {
    return { dirty: draft.dirty, saving: draft.saving, blocked: draft.conflict !== null || draft.gone || draft.issues.length > 0 };
}

function stateKey(texts: SaveTexts, state: SaveState): AdminContentKey {
    if (state.saving) {
        return texts.saving;
    }
    return state.dirty ? texts.unsaved : texts.saved;
}

/** The save state ("Saved", "Unsaved changes", "Saving…") in a polite region, Save and Discard. */
export interface SaveHandlers {
    readonly save: () => void;
    readonly discard: () => void;
}

export function saveBar(locale: Locale, texts: SaveTexts, state: SaveState, handlers: SaveHandlers): TemplateResult {
    const canSave = state.dirty && !state.saving && !state.blocked;
    return html`<div class="save-bar">
        <p class="note save-state" role="status">${contentText(locale, stateKey(texts, state))}</p>
        <div class="actions">
            <hcm-button variant="text" ?disabled=${!state.dirty || state.saving} @click=${handlers.discard}
                >${contentText(locale, 'adminContent.common.discard')}</hcm-button
            >
            <hcm-button variant="filled" ?disabled=${!canSave} @click=${handlers.save}
                >${contentText(locale, 'adminContent.common.save')}</hcm-button
            >
        </div>
    </div>`;
}

export interface ConflictTexts {
    readonly conflict: AdminContentKey;
    readonly keepMine: AdminContentKey;
    readonly takeTheirs: AdminContentKey;
}

/** Another admin saved the same fields meanwhile: the admin keeps their own changes or takes the saved version. */
export function conflictBanner(
    locale: Locale,
    texts: ConflictTexts,
    conflict: { readonly fields: readonly string[] } | null,
    handlers: { readonly keepMine: () => void; readonly takeTheirs: () => void },
): TemplateResult | typeof nothing {
    return conflict === null
        ? nothing
        : html`<div class="alert" role="alert">
              <hcm-icon name="warning"></hcm-icon>
              <div class="alert-body">
                  <span>${contentText(locale, texts.conflict, { fields: conflict.fields.join(', ') })}</span>
                  <div class="actions">
                      <hcm-button variant="text" @click=${handlers.keepMine}>${contentText(locale, texts.keepMine)}</hcm-button>
                      <hcm-button variant="text" @click=${handlers.takeTheirs}>${contentText(locale, texts.takeTheirs)}</hcm-button>
                  </div>
              </div>
          </div>`;
}

/** A polite region that exists before its text, so the text is announced (a slider that settled, a reorder). */
export function announcer(text: string): TemplateResult {
    return html`<p class="visually-hidden" role="status" aria-live="polite">${text}</p>`;
}
