/**
 * The Statistics view's errors (§203): Cloud Error Reporting's groups for the view's period (`telemetry.listGroups`, read by
 * the server's own account; Error Reporting keeps 30 days), each with how often, first and last seen, the release, the
 * plain cause (the redacted first line, no stack) and its page in the Google Cloud console. A disabled API, a refusal or
 * an empty period says so, with the way on.
 */
import type { Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { formatWhen, loadingTemplate } from '../editing/states.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { CrashesIntentsPort, CrashesViewState, CrashGroupPort } from './crashes-port.js';
import { formatCount } from './statistics-format.js';

/** The groups shown here: the most recent ones (the crash list has them all). */
const SHOWN = 10;

function groupRow(locale: Locale, group: CrashGroupPort, url: (groupId: string) => string): TemplateResult {
    return html`<tr>
        <th scope="row" class="message">${group.message}</th>
        <td>${formatCount(locale, group.count)}</td>
        <td>${formatWhen(locale, group.firstSeen)}</td>
        <td>${formatWhen(locale, group.lastSeen)}</td>
        <td>${group.version ?? '—'}</td>
        <td>
            <a class="external" href=${url(group.groupId)} target="_blank" rel="noopener noreferrer"
                >${contentText(locale, 'adminContent.statistics.crashes.open')}<hcm-icon name="open_in_new"></hcm-icon
            ></a>
        </td>
    </tr>`;
}

function groupsTable(locale: Locale, groups: readonly CrashGroupPort[], url: (groupId: string) => string): TemplateResult {
    const label = contentText(locale, 'adminContent.statistics.crashes.tableLabel');
    return html`<div class="table-wrap" tabindex="0" role="region" aria-label=${label}>
        <table>
            <thead>
                <tr>
                    <th scope="col">${contentText(locale, 'adminContent.statistics.crashes.cause')}</th>
                    <th scope="col">${contentText(locale, 'adminContent.crashes.count')}</th>
                    <th scope="col">${contentText(locale, 'adminContent.crashes.firstSeen')}</th>
                    <th scope="col">${contentText(locale, 'adminContent.crashes.lastSeen')}</th>
                    <th scope="col">${contentText(locale, 'adminContent.statistics.crashes.release')}</th>
                    <th scope="col">${contentText(locale, 'adminContent.statistics.crashes.link')}</th>
                </tr>
            </thead>
            <tbody>
                ${groups.slice(0, SHOWN).map((group) => groupRow(locale, group, url))}
            </tbody>
        </table>
    </div>`;
}

function failure(locale: Locale, view: CrashesViewState, intents: CrashesIntentsPort | null): TemplateResult {
    const retry = (): void => {
        intents?.retry();
    };
    const fix = view.apiDisabled
        ? html`<p>${contentText(locale, 'adminContent.crashes.apiDisabled')}</p>
              <p><a href="#/setup/analytics">${contentText(locale, 'adminContent.crashes.openSetup')}</a></p>`
        : html``;
    return html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.failure)}</span></p>
        ${fix}
        <div class="actions">
            <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
        </div>`;
}

function body(
    locale: Locale,
    view: CrashesViewState,
    intents: CrashesIntentsPort | null,
    url: (groupId: string) => string,
): TemplateResult {
    if (view.status === 'error') {
        return failure(locale, view, intents);
    }
    if (view.groups.length === 0) {
        return view.status === 'loading'
            ? loadingTemplate(locale)
            : html`<p class="note">${contentText(locale, 'adminContent.crashes.empty')}</p>`;
    }
    return groupsTable(locale, view.groups, url);
}

/** The errors' section; `url` is a group's page in the console (`errorGroupUrl`). */
export function crashesSection(
    locale: Locale,
    view: CrashesViewState,
    intents: CrashesIntentsPort | null,
    url: (groupId: string) => string,
): TemplateResult {
    const longest =
        view.statistics.days === 90 ? html`<p class="note">${contentText(locale, 'adminContent.statistics.crashes.longest')}</p>` : html``;
    return html`<section class="crash-groups" data-statistics-crashes>
        <h3>${contentText(locale, 'adminContent.statistics.crashes.title')}</h3>
        ${longest} ${body(locale, view, intents, url)}
    </section>`;
}
