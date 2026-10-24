/**
 * The Imagery area's work (`docs/research/M3-interfaces.md` §10.2): the unfinished versions, live, those that wait for
 * the admin (points, an approval, a compute-unit choice, a failure to retry) apart from those in progress, each with its
 * job's progress or wait in words.
 */
import { html, type TemplateResult } from 'lit';

import { current, errorTemplate, loadingTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import type { ImageryContext } from './context.js';
import type { VersionItemPort } from './imagery-port.js';
import { labelText, versionDetail } from './imagery-text.js';

function versionRow(context: ImageryContext, version: VersionItemPort): TemplateResult {
    const { locale, view } = context;
    const selected = view.detail?.kind === 'version' && view.detail.id === version.id;
    return html`<li data-version=${version.id} data-state=${version.state}>
        <a class="row" href=${context.href(['version', version.id])} aria-current=${current(selected)}>
            <span class="row-title">${labelText(version.label, locale)} · ${version.year}</span>
            <span class="row-detail">${versionDetail(locale, version, view.jobs[version.id])}</span>
        </a>
    </li>`;
}

function group(
    context: ImageryContext,
    heading: 'adminContent.imagery.needsYou' | 'adminContent.imagery.inProgress',
    versions: readonly VersionItemPort[],
): TemplateResult {
    if (versions.length === 0) {
        return EMPTY;
    }
    const id = heading === 'adminContent.imagery.needsYou' ? 'imagery-needs-you' : 'imagery-in-progress';
    return html`<section class="section" aria-labelledby=${id}>
        <h3 id=${id}>${contentText(context.locale, heading)}</h3>
        <ul class="rows">
            ${versions.map((version) => versionRow(context, version))}
        </ul>
    </section>`;
}

export function workView(context: ImageryContext): TemplateResult {
    const { locale, view, intents } = context;
    const list = view.versions;
    if (list.status === 'error') {
        return errorTemplate(locale, list.failure, () => intents?.retry());
    }
    if (list.items.length === 0) {
        return list.status === 'loading'
            ? loadingTemplate(locale)
            : html`<hcm-empty-state icon="pending" .text=${contentText(locale, 'adminContent.imagery.noWork')}></hcm-empty-state>`;
    }
    return html`${group(
        context,
        'adminContent.imagery.needsYou',
        list.items.filter((version) => version.needsYou),
    )}
    ${group(
        context,
        'adminContent.imagery.inProgress',
        list.items.filter((version) => !version.needsYou),
    )}`;
}
