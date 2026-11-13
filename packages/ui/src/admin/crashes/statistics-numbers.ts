/**
 * The Statistics view's numbers (§203; `docs/ADMIN_GUIDE.en.md` → *Where people get stuck*): **Show the numbers here**
 * with Google's note about the read-only Analytics permission, the period (7, 28 or 90 days), then the overview, the
 * visitors and visits per app and role with a line per day, and each wizard's steps (people, who left before the step,
 * the average time, the most frequent errors). Every failure says what happened and the fix, with a link to it.
 */
import type { Locale } from '@hcm/shared';
import { WIZARD_IDS, type WizardId } from '@hcm/shared/funnels';
import { html, type TemplateResult } from 'lit';

import { loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type {
    CrashesIntentsPort,
    NamedCountPort,
    StatisticsDaysPort,
    StatisticsNumbersPort,
    StatisticsProblemPort,
    StatisticsViewState,
    StepNumbersPort,
    SurfaceNumbersPort,
} from './crashes-port.js';
import { dailyLine, deviceName, errorName, eventName, formatCount, formatDuration, surfaceName } from './statistics-format.js';

/** Google Analytics' home: where an account's access to the property is managed. */
const GA_HOME = 'https://analytics.google.com/analytics/web/';
const DAYS: readonly StatisticsDaysPort[] = [7, 28, 90];
/** The errors shown per step. */
const TOP_ERRORS = 3;

export interface NumbersContext {
    readonly locale: Locale;
    readonly projectId: string;
    readonly authDomain: string;
    readonly state: StatisticsViewState;
    readonly intents: CrashesIntentsPort | null;
    /** A wizard's steps in order (the view's table); a step not listed follows by its people. */
    readonly order: (wizard: WizardId) => readonly string[];
    readonly stepName: (step: string) => string;
    readonly wizardName: (wizard: WizardId) => string;
}

/** The Data API's page in the Google Cloud console, where it is turned on. */
function dataApiUrl(projectId: string): string {
    return `https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com?project=${encodeURIComponent(projectId)}`;
}

interface FixLink {
    readonly href: string;
    readonly key:
        'adminContent.statistics.problem.openSetup' | 'adminContent.statistics.problem.openConsole' | 'adminContent.statistics.open';
    readonly external: boolean;
}

const SETUP_FIX: FixLink = { href: '#/setup/analytics', key: 'adminContent.statistics.problem.openSetup', external: false };

/** The links that fix each problem; a problem without one is fixed by the button itself. */
const FIXES: Readonly<Record<StatisticsProblemPort, (projectId: string) => readonly FixLink[]>> = {
    apiDisabled: (projectId) => [
        { ...SETUP_FIX, href: '#/setup' },
        { href: dataApiUrl(projectId), key: 'adminContent.statistics.problem.openConsole', external: true },
    ],
    noProperty: () => [SETUP_FIX],
    noReports: () => [SETUP_FIX],
    notSetUp: () => [SETUP_FIX],
    noAccess: () => [{ href: GA_HOME, key: 'adminContent.statistics.open', external: true }],
    consent: () => [],
    popupBlocked: () => [],
    wrongAccount: () => [],
    unavailable: () => [],
    blocked: () => [],
    server: () => [],
};

function fixLink(locale: Locale, link: FixLink): TemplateResult {
    const text = contentText(locale, link.key);
    return link.external
        ? html`<p>
              <a class="external" href=${link.href} target="_blank" rel="noopener noreferrer"
                  >${text}<hcm-icon name="open_in_new"></hcm-icon
              ></a>
          </p>`
        : html`<p><a href=${link.href}>${text}</a></p>`;
}

/** What happened and what to do, in words (the server's own refusal is its message alone). */
function problemWords(locale: Locale, state: StatisticsViewState, problem: StatisticsProblemPort): readonly string[] {
    if (problem === 'server') {
        return [noticeOf(locale, state.notice)];
    }
    const key = problem as 'consent';
    return [
        contentText(locale, `adminContent.statistics.problem.${key}`),
        contentText(locale, `adminContent.statistics.problem.${key}Fix`),
    ];
}

function problemTemplate(context: NumbersContext): TemplateResult {
    const { locale, state } = context;
    const problem = state.problem ?? 'unavailable';
    const [what, fix] = problemWords(locale, state, problem);
    return html`<p class="alert" role="alert" data-statistics-problem=${problem}>
            <hcm-icon name="error"></hcm-icon><span>${what}${fix === undefined ? '' : ` ${fix}`}</span>
        </p>
        ${FIXES[problem](context.projectId).map((link) => fixLink(locale, link))}`;
}

function controls(context: NumbersContext): TemplateResult {
    const { locale, state, intents } = context;
    const choose = (event: CustomEvent<{ readonly value: string }>): void => {
        intents?.setStatisticsDays(Number(event.detail.value) as StatisticsDaysPort);
    };
    const options = DAYS.map((days) => ({
        value: String(days),
        label: contentText(locale, `adminContent.statistics.numbers.days.${String(days) as '7'}`),
    }));
    const ready = state.status === 'ready';
    const show = (): void => {
        if (ready) {
            intents?.refreshStatistics();
        } else {
            intents?.showNumbers();
        }
    };
    return html`<hcm-segmented-button
            .label=${contentText(locale, 'adminContent.statistics.numbers.period')}
            .options=${options}
            .value=${String(state.days)}
            @hcm-change=${choose}
        ></hcm-segmented-button>
        ${
            ready
                ? EMPTY
                : html`<hcm-consent-note
                          .locale=${locale}
                          scope="analyticsRead"
                          .projectId=${context.projectId}
                          .domain=${context.authDomain}
                      ></hcm-consent-note>
                      <p class="note">${contentText(locale, 'adminContent.statistics.numbers.remove')}</p>`
        }
        <div class="actions">
            <hcm-button
                variant=${ready ? 'tonal' : 'filled'}
                icon=${ready ? 'refresh' : 'visibility'}
                ?disabled=${state.status === 'loading'}
                @click=${show}
                >${contentText(locale, ready ? 'adminContent.statistics.numbers.refresh' : 'adminContent.statistics.numbers.show')}</hcm-button
            >
        </div>`;
}

function countList(
    locale: Locale,
    titleKey: 'pages' | 'screens' | 'events' | 'devices' | 'countries',
    items: readonly NamedCountPort[],
    name: (value: string) => string,
): TemplateResult {
    const title = contentText(locale, `adminContent.statistics.numbers.${titleKey}`);
    const body =
        items.length === 0
            ? html`<p class="note">${contentText(locale, 'adminContent.statistics.numbers.none')}</p>`
            : html`<ol aria-label=${title}>
                  ${items.map(
                      (item) =>
                          html`<li>
                              ${contentText(locale, 'adminContent.statistics.numbers.count', { name: name(item.name), count: formatCount(locale, item.count) })}
                          </li>`,
                  )}
              </ol>`;
    return html`<h4>${title}</h4>
        ${body}`;
}

function surfaceRow(locale: Locale, surface: SurfaceNumbersPort): TemplateResult {
    const name = surfaceName(locale, surface.surface);
    const max = formatCount(locale, Math.max(0, ...surface.daily.map((day) => day.visitors)));
    return html`<tr>
        <th scope="row">${name}</th>
        <td>${formatCount(locale, surface.visitors)}</td>
        <td>${formatCount(locale, surface.sessions)}</td>
        <td>${dailyLine(contentText(locale, 'adminContent.statistics.numbers.dailyLabel', { app: name, max }), surface.daily)}</td>
    </tr>`;
}

function appsTable(locale: Locale, numbers: StatisticsNumbersPort): TemplateResult {
    const title = contentText(locale, 'adminContent.statistics.numbers.apps');
    return html`<h4>${title}</h4>
        <div class="table-wrap" tabindex="0" role="region" aria-label=${title}>
            <table>
                <thead>
                    <tr>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.app')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.visitors')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.sessions')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.daily')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${numbers.surfaces.map((surface) => surfaceRow(locale, surface))}
                    <tr data-surface="start">
                        <th scope="row">${contentText(locale, 'adminContent.statistics.numbers.surface.start')}</th>
                        <td colspan="3">${contentText(locale, 'adminContent.statistics.numbers.notMeasured')}</td>
                    </tr>
                </tbody>
            </table>
        </div>`;
}

/** The steps of one wizard in the page's order, then any other step by its people. */
function ordered(context: NumbersContext, numbers: StatisticsNumbersPort, wizard: WizardId): readonly StepNumbersPort[] {
    const own = numbers.steps.filter((step) => step.wizard === wizard);
    const order = context.order(wizard);
    const rank = (step: StepNumbersPort): number => {
        const index = order.indexOf(step.step);
        return index === -1 ? order.length : index;
    };
    return [...own].sort((left, right) => rank(left) - rank(right) || right.visitors - left.visitors);
}

/** Who left between the step before and this one: the count and its share; a dash for the first step. */
function leftText(locale: Locale, before: StepNumbersPort | undefined, step: StepNumbersPort): string {
    if (before === undefined || before.visitors === 0) {
        return '—';
    }
    const left = Math.max(0, before.visitors - step.visitors);
    return contentText(locale, 'adminContent.statistics.numbers.percent', {
        count: formatCount(locale, left),
        percent: formatCount(locale, (left / before.visitors) * 100),
    });
}

function stepRow(context: NumbersContext, step: StepNumbersPort, before: StepNumbersPort | undefined): TemplateResult {
    const { locale } = context;
    const errors = step.errors.slice(0, TOP_ERRORS);
    return html`<tr>
        <th scope="row">${context.stepName(step.step)} (<code>${step.step}</code>)</th>
        <td>${formatCount(locale, step.visitors)}</td>
        <td>${leftText(locale, before, step)}</td>
        <td>${formatDuration(locale, step.averageMs)}</td>
        <td>
            ${
                errors.length === 0
                    ? '—'
                    : html`<ul>
                          ${errors.map((error) => html`<li>${errorName(locale, error.name)}: ${formatCount(locale, error.count)}</li>`)}
                      </ul>`
            }
        </td>
    </tr>`;
}

function wizardTable(context: NumbersContext, numbers: StatisticsNumbersPort, wizard: WizardId): TemplateResult {
    const { locale } = context;
    const name = context.wizardName(wizard);
    const steps = ordered(context, numbers, wizard);
    if (steps.length === 0) {
        return html`<h5>${name}</h5>
            <p class="note">${contentText(locale, 'adminContent.statistics.numbers.noWizard')}</p>`;
    }
    const label = contentText(locale, 'adminContent.statistics.numbers.tableLabel', { name });
    return html`<h5>${name}</h5>
        <div class="table-wrap" tabindex="0" role="region" aria-label=${label} data-funnel=${wizard}>
            <table>
                <thead>
                    <tr>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.step')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.people')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.left')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.time')}</th>
                        <th scope="col">${contentText(locale, 'adminContent.statistics.numbers.errors')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${steps.map((step, index) => stepRow(context, step, steps[index - 1]))}
                </tbody>
            </table>
        </div>`;
}

function numbersTemplate(context: NumbersContext, numbers: StatisticsNumbersPort): TemplateResult {
    const { locale } = context;
    const identity = (value: string): string => value;
    return html`<h4>${contentText(locale, 'adminContent.statistics.numbers.overview')}</h4>
        <dl class="facts">
            <dt>${contentText(locale, 'adminContent.statistics.numbers.visitors')}</dt>
            <dd data-statistics-visitors>${formatCount(locale, numbers.visitors)}</dd>
            <dt>${contentText(locale, 'adminContent.statistics.numbers.sessions')}</dt>
            <dd>${formatCount(locale, numbers.sessions)}</dd>
        </dl>
        ${appsTable(locale, numbers)} ${countList(locale, 'pages', numbers.pages, identity)}
        ${countList(locale, 'screens', numbers.screens, identity)}
        ${countList(locale, 'events', numbers.events, (value) => eventName(locale, value))}
        ${countList(locale, 'devices', numbers.devices, (value) => deviceName(locale, value))}
        ${countList(locale, 'countries', numbers.countries, identity)}
        <h4>${contentText(locale, 'adminContent.statistics.numbers.wizards')}</h4>
        ${WIZARD_IDS.map((wizard) => wizardTable(context, numbers, wizard))}`;
}

function bodyOf(context: NumbersContext): TemplateResult {
    const { state } = context;
    if (state.status === 'loading') {
        return loadingTemplate(context.locale);
    }
    if (state.status === 'error') {
        return problemTemplate(context);
    }
    return state.status === 'ready' && state.numbers !== null ? numbersTemplate(context, state.numbers) : EMPTY;
}

/** The numbers' section: its title, what it reads, the controls and the state's body. */
export function numbersSection(context: NumbersContext): TemplateResult {
    const { locale } = context;
    return html`<section class="numbers" data-statistics-numbers>
        <h3>${contentText(locale, 'adminContent.statistics.numbers.title')}</h3>
        <p>${contentText(locale, 'adminContent.statistics.numbers.intro')}</p>
        ${controls(context)} ${bodyOf(context)}
    </section>`;
}
