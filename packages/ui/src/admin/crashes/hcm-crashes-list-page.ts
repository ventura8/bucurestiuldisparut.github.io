/**
 * `<hcm-crashes-list-page>`: `#/crashes` (`docs/research/M2c-interfaces.md` §9.4; behaviour A22) in the list and
 * detail layout. A period (24 hours, 7 days, 30 days), the Error Reporting groups of that period (the redacted message as
 * text, how often, when last), More for the next page; the selected group's count, first and last seen, release and
 * state, with **Open in Error Reporting** (the project's page in the Google Cloud console, a new tab). A disabled Error
 * Reporting API is explained with the way to enable it (Setup's analytics card). The selection is page state: Error
 * Reporting's group ids are never routed. The Setup card's `hcm-crash-groups` stays where it is.
 */
import type { Locale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { formatWhen, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { CrashesIntentsPort, CrashesViewState, CrashGroupPort, CrashPeriodPort } from './crashes-port.js';

export const HCM_CRASHES_LIST_PAGE_TAG = 'hcm-crashes-list-page';

/**
 * The project's Error Reporting page in the Google Cloud console (**UNVERIFIED** until the weekly contract probe has
 * checked it and it joins `packages/admin/src/setup/links.json`, CR-M2c-15).
 */
export function errorReportingUrl(projectId: string): string {
    return `https://console.cloud.google.com/errors?project=${encodeURIComponent(projectId)}`;
}

const PERIODS: readonly CrashPeriodPort[] = [24, 168, 720];

const crashStyles = css`
    .message {
        overflow-wrap: anywhere;
    }

    button.row {
        inline-size: 100%;
        border: none;
        background: none;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }

    button.row:hover {
        background: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 8%, transparent);
    }

    button.row[aria-current='true'] {
        background: var(--md-sys-color-secondary-container, Highlight);
        color: var(--md-sys-color-on-secondary-container, HighlightText);
    }
`;

export class HcmCrashesListPage extends AreaPage<CrashesViewState, CrashesIntentsPort> {
    static override readonly styles = [...editingStyles, crashStyles];

    protected readonly route: AdminRouteIdPort = 'crashes';

    protected storeOf(content: ContentPort): AreaPort<CrashesViewState, CrashesIntentsPort> | null {
        return content.crashes;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const back = (): void => {
            this.intents?.select(null);
        };
        return html`<hcm-list-detail
            ?detail=${view.selected !== null}
            .detailKey=${view.selected ?? ''}
            .listLabel=${contentText(locale, 'adminContent.crashes.listLabel')}
            .detailLabel=${contentText(locale, 'adminContent.crashes.detailLabel')}
            .backLabel=${contentText(locale, 'adminContent.common.back')}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-back=${back}
        >
            <div slot="list">${this.#list(locale, view)}</div>
            <div slot="detail">${this.#detail(locale, view)}</div>
        </hcm-list-detail>`;
    }

    #list(locale: Locale, view: CrashesViewState): TemplateResult {
        const choose = (event: CustomEvent<{ readonly value: string }>): void => {
            this.intents?.setPeriod(Number(event.detail.value) as CrashPeriodPort);
        };
        const options = PERIODS.map((period) => ({
            value: String(period),
            label: contentText(locale, `adminContent.crashes.period.${String(period) as '24'}`),
        }));
        return html`<div class="list-head">
                <hcm-segmented-button
                    .label=${contentText(locale, 'adminContent.crashes.periodLabel')}
                    .options=${options}
                    .value=${String(view.period)}
                    @hcm-change=${choose}
                ></hcm-segmented-button>
            </div>
            ${this.#body(locale, view)}`;
    }

    #body(locale: Locale, view: CrashesViewState): TemplateResult {
        if (view.status === 'error') {
            return this.#failure(locale, view);
        }
        if (view.groups.length === 0) {
            return view.status === 'loading'
                ? loadingTemplate(locale)
                : html`<hcm-empty-state icon="bug_report" .text=${contentText(locale, 'adminContent.crashes.empty')}></hcm-empty-state>`;
        }
        return html`<ul class="rows">
                ${view.groups.map((group) => this.#row(locale, group, group.groupId === view.selected))}
            </ul>
            ${this.#more(locale, view)}`;
    }

    #more(locale: Locale, view: CrashesViewState): TemplateResult {
        if (view.nextPageToken === null) {
            return EMPTY;
        }
        const more = (): void => {
            void this.intents?.more();
        };
        return html`<div class="actions more">
            <hcm-button variant="text" icon="expand_more" ?disabled=${view.loadingMore} @click=${more}
                >${contentText(locale, 'adminContent.common.more')}</hcm-button
            >
        </div>`;
    }

    #failure(locale: Locale, view: CrashesViewState): TemplateResult {
        const retry = (): void => {
            this.intents?.retry();
        };
        const enable = view.apiDisabled
            ? html`<p>${contentText(locale, 'adminContent.crashes.apiDisabled')}</p>
                  <p><a href="#/setup/analytics">${contentText(locale, 'adminContent.crashes.openSetup')}</a></p>`
            : EMPTY;
        return html`<div class="pane">
            <p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.failure)}</span></p>
            ${enable}
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
            </div>
        </div>`;
    }

    #row(locale: Locale, group: CrashGroupPort, selected: boolean): TemplateResult {
        const select = (): void => {
            this.intents?.select(group.groupId);
        };
        return html`<li>
            <button class="row" type="button" aria-current=${selected ? 'true' : 'false'} @click=${select}>
                <span class="row-title message">${group.message}</span>
                <span class="row-detail"
                    >${contentText(locale, 'adminContent.crashes.countLine', { count: String(group.count), date: formatWhen(locale, group.lastSeen) })}</span
                >
            </button>
        </li>`;
    }

    #detail(locale: Locale, view: CrashesViewState): TemplateResult {
        const group = view.groups.find((candidate) => candidate.groupId === view.selected);
        if (group === undefined) {
            return html`<hcm-empty-state icon="bug_report" .text=${contentText(locale, 'adminContent.crashes.choose')}></hcm-empty-state>`;
        }
        const projectId = this.state?.projectId ?? '';
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading class="message">${group.message}</h2>
            <dl class="facts">
                <dt>${contentText(locale, 'adminContent.crashes.count')}</dt>
                <dd>${new Intl.NumberFormat(locale).format(group.count)}</dd>
                <dt>${contentText(locale, 'adminContent.crashes.firstSeen')}</dt>
                <dd>${formatWhen(locale, group.firstSeen)}</dd>
                <dt>${contentText(locale, 'adminContent.crashes.lastSeen')}</dt>
                <dd>${formatWhen(locale, group.lastSeen)}</dd>
                <dt>${contentText(locale, 'adminContent.crashes.service')}</dt>
                <dd>${group.version === undefined ? group.service : `${group.service} ${group.version}`}</dd>
                <dt>${contentText(locale, 'adminContent.crashes.state')}</dt>
                <dd>${contentText(locale, `adminContent.crashes.resolution.${group.resolution}`)}</dd>
            </dl>
            <p>
                <a class="external" href=${errorReportingUrl(projectId)} target="_blank" rel="noopener noreferrer"
                    >${contentText(locale, 'adminContent.crashes.openConsole')}<hcm-icon name="open_in_new"></hcm-icon
                ></a>
            </p>
        </div>`;
    }
}

export function defineHcmCrashesListPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_CRASHES_LIST_PAGE_TAG) === undefined) {
        registry.define(HCM_CRASHES_LIST_PAGE_TAG, HcmCrashesListPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-crashes-list-page': HcmCrashesListPage;
    }
}
