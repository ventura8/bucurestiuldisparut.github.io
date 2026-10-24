/**
 * The imagery section (`docs/research/M3-interfaces.md` §10.7; CR-M3-8): whether a georeferenced scene goes to the
 * public map on its own when its checkpoint error is under the threshold, that threshold in metres (1–200), and the
 * years the search ranks first (at most 20), each removable; saved on their own (`cities/{city}.imagery`) with the
 * section's own draft and Save. A value the city document refuses is said at its field on Save.
 */
import {
    imagerySettingsOf,
    MAX_TARGET_YEARS,
    RMSE_THRESHOLD_RANGE,
    type CityDoc,
    type CityImagery,
    type ValidationIssue,
} from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { when } from '../imagery/when.js';
import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';

const YEAR = /^(?:18|19|20)\d\d$/;
const NEW_YEAR_ID = 'imagery-new-year';

/** The threshold as typed: a number, or NaN for an empty field (the document refuses it on Save). */
function thresholdOf(text: string): number {
    return text.trim() === '' ? Number.NaN : Number(text.replace(',', '.'));
}

function shown(value: number): string {
    return Number.isNaN(value) ? '' : String(value);
}

function edit(context: SectionContext, imagery: CityImagery | undefined, patch: Partial<CityImagery>): void {
    context.intents?.editCity({ imagery: { ...imagery, ...patch } });
}

function autoPublishRow(context: SectionContext, city: CityDoc): TemplateResult {
    const label = contentText(context.locale, 'adminContent.imagery.settings.autoPublish');
    return html`<div class="switch-row">
        <span aria-hidden="true">${label}</span>
        <hcm-switch
            .checked=${imagerySettingsOf(city.imagery).autoPublish}
            ?disabled=${context.readOnly}
            label=${label}
            @hcm-change=${(event: Event) => {
                edit(context, city.imagery, { autoPublish: (event as CustomEvent<{ checked: boolean }>).detail.checked });
            }}
        ></hcm-switch>
    </div>`;
}

function thresholdField(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const range = { min: String(RMSE_THRESHOLD_RANGE.min), max: String(RMSE_THRESHOLD_RANGE.max) };
    return field(locale, {
        id: 'imagery-threshold',
        label: contentText(locale, 'adminContent.imagery.settings.threshold'),
        value: shown(imagerySettingsOf(city.imagery).rmseThresholdM),
        issue: issueAt(issues, 'imagery.rmseThresholdM'),
        help: contentText(locale, 'adminContent.imagery.settings.thresholdHelp', range),
        inputMode: 'decimal',
        readOnly: context.readOnly,
        onInput: (text) => {
            edit(context, city.imagery, { rmseThresholdM: thresholdOf(text) });
        },
    });
}

/** The typed year when the list takes it (from 1800 to 2099, not in the list yet, room left), else null. */
function acceptedYear(text: string, years: readonly number[]): number | null {
    const year = Number(text);
    return YEAR.test(text) && !years.includes(year) && years.length < MAX_TARGET_YEARS ? year : null;
}

/** Adds the year typed in the field, or says why it cannot. */
function addYear(context: SectionContext, city: CityDoc, input: HTMLInputElement): void {
    const years = imagerySettingsOf(city.imagery).targetYears;
    const year = acceptedYear(input.value.trim(), years);
    if (year === null) {
        context.announce(contentText(context.locale, 'adminContent.imagery.settings.yearRefused', { max: String(MAX_TARGET_YEARS) }));
        return;
    }
    edit(context, city.imagery, { targetYears: [...years, year].sort((a, b) => a - b) });
    input.value = '';
}

function yearRow(context: SectionContext, city: CityDoc, year: number): TemplateResult {
    const years = imagerySettingsOf(city.imagery).targetYears;
    return html`<li class="year-row">
        <span>${String(year)}</span>
        <hcm-icon-button
            icon="delete"
            label=${contentText(context.locale, 'adminContent.imagery.settings.removeYear', { year: String(year) })}
            ?disabled=${context.readOnly}
            @click=${() => {
                edit(context, city.imagery, { targetYears: years.filter((candidate) => candidate !== year) });
            }}
        ></hcm-icon-button>
    </li>`;
}

function yearsGroup(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const years = imagerySettingsOf(city.imagery).targetYears;
    const issue = issueAt(issues, 'imagery.targetYears');
    const add = (event: Event): void => {
        // The field is this page's one with its id, in the same shadow root as the button.
        const input = ((event.currentTarget as HTMLElement).getRootNode() as ParentNode).querySelector(`#${NEW_YEAR_ID}`);
        if (input instanceof HTMLInputElement) {
            addYear(context, city, input);
        }
    };
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.imagery.settings.years')}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.yearsHelp', { max: String(MAX_TARGET_YEARS) })}</p>
        ${when(
            years.length === 0,
            () => html`<p class="note" data-state="no-years">${contentText(locale, 'adminContent.imagery.settings.noYears')}</p>`,
        )}
        <ul class="rows years">
            ${years.map((year) => yearRow(context, city, year))}
        </ul>
        ${when(issue !== null, () => html`<p class="error" role="alert">${contentText(locale, 'adminContent.imagery.settings.yearsInvalid')}</p>`)}
        <div class="field">
            <label for=${NEW_YEAR_ID}>${contentText(locale, 'adminContent.imagery.settings.newYear')}</label>
            <input id=${NEW_YEAR_ID} inputmode="numeric" ?readonly=${context.readOnly} />
        </div>
        <div class="actions">
            <hcm-button variant="tonal" icon="add" ?disabled=${context.readOnly} @click=${add}
                >${contentText(locale, 'adminContent.imagery.settings.addYear')}</hcm-button
            >
        </div>
    </section>`;
}

export function imagerySection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    const head = cityHead(context, sectionTitle(locale, 'imagery'));
    if (city === null) {
        return head;
    }
    const issues = context.view.citySection.draft.issues;
    return html`${head}
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.note')}</p>
        <section class="group">
            <h3>${contentText(locale, 'adminContent.imagery.settings.publishing')}</h3>
            ${autoPublishRow(context, city)} ${thresholdField(context, city, issues)}
        </section>
        ${yearsGroup(context, city, issues)}`;
}
