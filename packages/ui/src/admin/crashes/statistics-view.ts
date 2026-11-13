/**
 * The Statistics view (`#/crashes/statistics`, the owner's request of 2026-11-13; `docs/ARCHITECTURE.md` → *Wizard
 * funnels*, `docs/ADMIN_GUIDE.en.md` → *Where people get stuck*): every wizard with its steps in order and their codes,
 * the way to its funnel in Google Analytics (a funnel exploration of `step_view`, the errors of `step_error`, the time
 * between steps), and a plain note when analytics is not set up. Since §203 the numbers show here too: **Show the numbers
 * here** asks Google for the owner's read-only Analytics permission and reads the GA4 Data API (`statistics-numbers.ts`),
 * and Error Reporting's groups follow the same period (`statistics-crashes.ts`).
 */
import type { Locale } from '@hcm/shared';
import { WIZARD_IDS, type WizardId } from '@hcm/shared/funnels';
import { css, html, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { CrashesIntentsPort, CrashesViewState } from './crashes-port.js';
import { crashesSection } from './statistics-crashes.js';
import { numbersSection } from './statistics-numbers.js';

/** Google Analytics' home: the owner picks the project's property there (its id is not kept by the admin). */
export const GA_HOME_URL = 'https://analytics.google.com/analytics/web/';

/** Each wizard's steps in order (Setup's are its cards, listed by the page itself). */
const WIZARD_STEPS = {
    setup: [],
    new_city: ['names', 'area', 'create'],
    start: ['intro', 'plan', 'work', 'provider', 'done'],
    tiles: ['order', 'seams', 'preview', 'points'],
    georef: ['points', 'save', 'approve'],
    usgs_import: ['search', 'choose', 'import'],
    upload: ['choose', 'year', 'upload', 'check'],
    local_import: ['choose', 'upload', 'scan'],
    worker: ['connect', 'update'],
} as const satisfies Readonly<Record<WizardId, readonly string[]>>;

type StepId = (typeof WIZARD_STEPS)[WizardId][number];

const STEP_IDS: ReadonlySet<string> = new Set(Object.values(WIZARD_STEPS).flat());

const HOW = ['how1', 'how2', 'how3', 'how4', 'how5', 'how6'] as const;

export const statisticsStyles = css`
    /* The crashes page fills the page area (its list and detail panes scroll): this view scrolls on its own. */
    .statistics {
        block-size: 100%;
        overflow-y: auto;
    }

    /* M3's 48 px touch target for the links on their own lines (the tour's target-size check on a compact window). */
    .statistics p > a,
    a[data-statistics-link] {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    .statistics code {
        font-family: var(--hcm-font-mono, ui-monospace, monospace);
        font-size: 0.875em;
        overflow-wrap: anywhere;
    }

    .statistics .wizards {
        display: grid;
        gap: 16px;
        padding: 0;
        list-style: none;
    }

    /* §203: the numbers' tables scroll sideways on a narrow window, never the page. */
    .statistics .table-wrap {
        max-inline-size: 100%;
        overflow-x: auto;
    }

    .statistics table {
        border-collapse: collapse;
    }

    .statistics th,
    .statistics td {
        padding: 8px 12px 8px 0;
        text-align: start;
        vertical-align: top;
    }

    .statistics td ul {
        margin: 0;
        padding-inline-start: 1em;
    }

    .statistics svg.daily {
        color: var(--md-sys-color-primary, LinkText);
    }
`;

function stepItem(locale: Locale, step: StepId): TemplateResult {
    const name = contentText(locale, `adminContent.statistics.step.${step}`);
    return html`<li>${name} (<code>${step}</code>)</li>`;
}

function howItem(locale: Locale, key: (typeof HOW)[number]): TemplateResult {
    const text = contentText(locale, `adminContent.statistics.${key}`);
    return html`<li>${text}</li>`;
}

function stepsOf(locale: Locale, wizard: WizardId): TemplateResult {
    const steps: readonly StepId[] = WIZARD_STEPS[wizard];
    if (steps.length === 0) {
        return html`<p>${contentText(locale, 'adminContent.statistics.setupSteps')}</p>`;
    }
    return html`<ol aria-label=${contentText(locale, 'adminContent.statistics.stepsLabel')}>
        ${steps.map((step) => stepItem(locale, step))}
    </ol>`;
}

function wizardName(locale: Locale, wizard: WizardId): string {
    return contentText(locale, `adminContent.statistics.wizard.${wizard}`);
}

function wizardItem(locale: Locale, wizard: WizardId): TemplateResult {
    return html`<li data-wizard=${wizard}>
        <h3>${wizardName(locale, wizard)} (<code>${wizard}</code>)</h3>
        ${stepsOf(locale, wizard)}
    </li>`;
}

/** The note and link when GA4 is not configured: nothing is measured until Setup's step g. */
function offNote(locale: Locale, analytics: boolean): TemplateResult {
    return analytics
        ? EMPTY
        : html`<p class="note" data-statistics-off>${contentText(locale, 'adminContent.statistics.off')}</p>
              <p><a href="#/setup/analytics">${contentText(locale, 'adminContent.statistics.openSetup')}</a></p>`;
}

/** What the view shows besides the language: the page's state and intents, the project for its links. */
export interface StatisticsContext {
    /** The admin's GA4 is configured (its web configuration has a measurement id). */
    readonly analytics: boolean;
    readonly projectId: string;
    readonly authDomain: string;
    readonly view: CrashesViewState | null;
    readonly intents: CrashesIntentsPort | null;
    /** An error group's page in the Google Cloud console. */
    readonly groupUrl: (groupId: string) => string;
}

/** §203: the numbers and the errors, once the page's store is there. */
function liveSections(locale: Locale, context: StatisticsContext): TemplateResult {
    const view = context.view;
    if (view === null) {
        return EMPTY;
    }
    const numbers = numbersSection({
        ...{ locale, projectId: context.projectId, authDomain: context.authDomain, state: view.statistics, intents: context.intents },
        order: (wizard) => WIZARD_STEPS[wizard],
        stepName: (step) => (STEP_IDS.has(step) ? contentText(locale, `adminContent.statistics.step.${step as StepId}`) : step),
        wizardName: (wizard) => wizardName(locale, wizard),
    });
    return html`${numbers} ${crashesSection(locale, view, context.intents, context.groupUrl)}`;
}

/** The whole view. */
export function statisticsView(locale: Locale, context: StatisticsContext): TemplateResult {
    return html`<div class="pane statistics">
        <p><a href="#/crashes">${contentText(locale, 'adminContent.statistics.back')}</a></p>
        <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.statistics.title')}</h2>
        <p>${contentText(locale, 'adminContent.statistics.intro')}</p>
        <p>${contentText(locale, 'adminContent.statistics.intro2')}</p>
        ${offNote(locale, context.analytics)} ${liveSections(locale, context)}
        <p>
            <a class="external" href=${GA_HOME_URL} target="_blank" rel="noopener noreferrer"
                >${contentText(locale, 'adminContent.statistics.open')}<hcm-icon name="open_in_new"></hcm-icon
            ></a>
        </p>
        <h3>${contentText(locale, 'adminContent.statistics.howTitle')}</h3>
        <ol>
            ${HOW.map((key) => howItem(locale, key))}
        </ol>
        <ul class="wizards">
            ${WIZARD_IDS.map((wizard) => wizardItem(locale, wizard))}
        </ul>
    </div>`;
}
