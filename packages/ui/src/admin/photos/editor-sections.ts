/**
 * The photo editor's sections (`docs/research/M2c-interfaces.md` §6.3): the texts in Romanian and English (English
 * optional, the visitor then reads Romanian), the date, author and rights, links (at most five, https only) and
 * publishing (Published, with why it cannot be switched on yet, and Rights to check). Each change is a patch of the
 * draft; nothing is written until Save.
 */
import type { FirestoreLicense, Locale, ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { FieldsLeft } from '../editing/number-fields.js';
import { areaField, numberField, numberOf, selectField, textField, textOf } from './editor-fields.js';
import { LICENSE_ORDER, blockText, fieldIssue, licenseText, partId, photoText } from './photo-text.js';
import type { LocalizedPort, PhotoEditorPort, PhotoPatchPort, PhotoValuePort } from './photos-port.js';

/** Links per photo (the rules allow 5). */
const MAX_PHOTO_LINKS = 5;

export interface SectionInput {
    readonly locale: Locale;
    readonly value: PhotoValuePort;
    readonly issues: readonly ValidationIssue[];
    readonly edit: (patch: PhotoPatchPort) => void;
    /** The number fields left since the photo opened: only they say their problem. */
    readonly left: FieldsLeft;
}

/** Romanian and English as stored: absent when both are empty (an optional text). */
function compactText(ro: string, en: string | undefined): LocalizedPort | undefined {
    if (textOf(ro) === undefined && en === undefined) {
        return undefined;
    }
    return en === undefined ? { ro } : { ro, en };
}

/** A localized text with one language changed (Romanian as typed, an empty English left out). */
export function withLanguage(text: LocalizedPort | undefined, language: 'ro' | 'en', typed: string): LocalizedPort | undefined {
    const current = text ?? { ro: '' };
    const ro = language === 'ro' ? typed : current.ro;
    const en = language === 'en' ? textOf(typed) : current.en;
    return compactText(ro, en);
}

function localizedPair(
    input: SectionInput,
    field: 'description' | 'dateText',
    keys: { ro: 'descriptionRo' | 'dateTextRo'; en: 'descriptionEn' | 'dateTextEn' },
    max: number,
): TemplateResult {
    const { locale, value, issues, edit } = input;
    const text = value[field];
    const make = (language: 'ro' | 'en', key: 'descriptionRo' | 'dateTextRo' | 'descriptionEn' | 'dateTextEn'): TemplateResult => {
        const options = {
            id: `photo-${field}-${language}`,
            label: photoText(locale, `adminContent.photos.field.${key}`),
            value: text?.[language] ?? '',
            error: fieldIssue(locale, issues, `${field}.${language}`),
            maxlength: max,
        };
        const changed = (typed: string): void => {
            edit({ [field]: withLanguage(text, language, typed) });
        };
        return max > 200 ? areaField(options, changed) : textField(options, changed);
    };
    return html`${make('ro', keys.ro)} ${make('en', keys.en)}`;
}

export function textsSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const title = value.title;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.texts')}</legend>
        ${textField(
            {
                id: 'photo-title-ro',
                label: photoText(locale, 'adminContent.photos.field.titleRo'),
                value: title.ro,
                error: fieldIssue(locale, issues, 'title.ro'),
            },
            (typed) => {
                edit({ title: title.en === undefined ? { ro: typed } : { ro: typed, en: title.en } });
            },
        )}
        ${textField(
            {
                id: 'photo-title-en',
                label: photoText(locale, 'adminContent.photos.field.titleEn'),
                value: title.en ?? '',
                error: fieldIssue(locale, issues, 'title.en'),
                hint: photoText(locale, 'adminContent.photos.field.englishFallback'),
            },
            (typed) => {
                const en = textOf(typed);
                edit({ title: en === undefined ? { ro: title.ro } : { ro: title.ro, en } });
            },
        )}
        ${localizedPair(input, 'description', { ro: 'descriptionRo', en: 'descriptionEn' }, 5000)}
    </fieldset>`;
}

export function datesSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const year = (field: 'year' | 'yearEnd', key: 'year' | 'yearEnd'): TemplateResult =>
        numberField(
            {
                id: `photo-${field}`,
                label: photoText(locale, `adminContent.photos.field.${key}`),
                value: value[field] === undefined ? '' : String(value[field]),
                error: fieldIssue(locale, issues, field),
                min: 1800,
                max: 2100,
                step: '1',
            },
            (typed) => {
                edit({ [field]: numberOf(typed) });
            },
            input.left,
        );
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.dates')}</legend>
        <div class="pair">${year('year', 'year')} ${year('yearEnd', 'yearEnd')}</div>
        ${localizedPair(input, 'dateText', { ro: 'dateTextRo', en: 'dateTextEn' }, 100)}
    </fieldset>`;
}

type CreditField = 'author' | 'rightsHolder' | 'sourceLabel' | 'sourceUrl' | 'permissionNote';

function creditField(input: SectionInput, field: CreditField, type: 'text' | 'url' = 'text'): TemplateResult {
    const { locale, value, issues, edit } = input;
    const max = field === 'permissionNote' ? 2000 : 200;
    const options = {
        id: `photo-${field}`,
        label: photoText(locale, `adminContent.photos.field.${field}`),
        value: value[field] ?? '',
        error: fieldIssue(locale, issues, field),
        maxlength: max,
    };
    const changed = (typed: string): void => {
        edit({ [field]: textOf(typed) });
    };
    return field === 'permissionNote' ? areaField(options, changed) : textField({ ...options, type }, changed);
}

export function creditsSection(input: SectionInput): TemplateResult {
    const { locale, value, issues, edit } = input;
    const options = LICENSE_ORDER.map((license) => ({ value: license, label: licenseText(locale, license) }));
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.credits')}</legend>
        ${creditField(input, 'author')}
        ${selectField(
            {
                id: 'photo-license',
                label: photoText(locale, 'adminContent.photos.field.license'),
                value: value.license,
                error: fieldIssue(locale, issues, 'license'),
                options,
            },
            (chosen) => {
                edit({ license: chosen as FirestoreLicense });
            },
        )}
        ${creditField(input, 'rightsHolder')} ${creditField(input, 'sourceLabel')} ${creditField(input, 'sourceUrl', 'url')}
        ${creditField(input, 'permissionNote')}
    </fieldset>`;
}

interface Link {
    readonly url: string;
    readonly label: string;
}

/** One link: its text, its address, Remove. */
function linkRow(input: SectionInput, links: readonly Link[], index: number, set: (next: readonly Link[]) => void): TemplateResult {
    const { locale, issues } = input;
    const link = links[index] ?? { url: '', label: '' };
    const n = { n: String(index + 1) };
    const at = (part: 'label' | 'url'): string => ['links[', String(index), '].', part].join('');
    const change = (patch: Partial<Link>): void => {
        set(links.map((other, position) => (position === index ? { ...other, ...patch } : other)));
    };
    return html`<div class="link-row">
        ${textField(
            {
                id: partId('photo-link-label', String(index)),
                label: photoText(locale, 'adminContent.photos.links.label', n),
                value: link.label,
                error: fieldIssue(locale, issues, at('label')),
            },
            (label) => {
                change({ label });
            },
        )}
        ${textField(
            {
                id: partId('photo-link-url', String(index)),
                label: photoText(locale, 'adminContent.photos.links.url', n),
                value: link.url,
                error: fieldIssue(locale, issues, at('url')),
                type: 'url',
                maxlength: 2048,
            },
            (url) => {
                change({ url });
            },
        )}
        <hcm-icon-button
            icon="delete"
            .label=${photoText(locale, 'adminContent.photos.links.remove', n)}
            @click=${() => {
                set(links.filter((_link, position) => position !== index));
            }}
        ></hcm-icon-button>
    </div>`;
}

export function linksSection(input: SectionInput): TemplateResult {
    const { locale, value, edit } = input;
    const links = value.links ?? [];
    const set = (next: readonly Link[]): void => {
        edit({ links: next.length === 0 ? undefined : next });
    };
    const full = links.length >= MAX_PHOTO_LINKS;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.links')}</legend>
        ${links.map((_link, index) => linkRow(input, links, index, set))}
        <div class="actions">
            <hcm-button
                variant="text"
                icon="add"
                ?disabled=${full}
                @click=${() => {
                    set([...links, { url: 'https://', label: '' }]);
                }}
                >${photoText(locale, 'adminContent.photos.links.add')}</hcm-button
            >
            ${full ? html`<span class="note">${photoText(locale, 'adminContent.photos.links.max')}</span>` : nothing}
        </div>
    </fieldset>`;
}

export function publishingSection(input: SectionInput, editor: PhotoEditorPort): TemplateResult {
    const { locale, value, edit } = input;
    const blocked = editor.block !== null && !value.published;
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.publishing')}</legend>
        <div class="switch-row">
            <span id="published-label">${photoText(locale, 'adminContent.photos.field.published')}</span>
            <hcm-switch
                .checked=${value.published}
                ?disabled=${blocked}
                .label=${photoText(locale, 'adminContent.photos.field.published')}
                @hcm-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    edit({ published: event.detail.checked });
                }}
            ></hcm-switch>
        </div>
        ${editor.block === null ? nothing : html`<p class="note">${blockText(locale, editor.block)}</p>`}
        <div class="switch-row">
            <span>${photoText(locale, 'adminContent.photos.field.rightsReview')}</span>
            <hcm-switch
                .checked=${value.rightsReview === true}
                .label=${photoText(locale, 'adminContent.photos.field.rightsReview')}
                @hcm-change=${(event: CustomEvent<{ checked: boolean }>) => {
                    edit({ rightsReview: event.detail.checked });
                }}
            ></hcm-switch>
        </div>
    </fieldset>`;
}
