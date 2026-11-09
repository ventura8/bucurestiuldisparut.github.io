/**
 * `<hcm-archive-panel>` (`docs/research/M20-import-local.md` §2.1, §8.1; behaviour A121), in the Imagery area's Upload view under the
 * GeoTIFF upload: Import local files. With no worker of the city seen in the last three minutes it says to start the worker first
 * (Open Jobs); with one, Choose a folder or zip on this computer opens the worker's own import page in a new tab (the files are
 * picked there: a page of the map's site cannot reach the computer's loopback). Below, the archives already scanned, each opening its
 * report (`#/imagery/archive/<id>`). An archive that arrives while the card is open (the worker's scan just reported it) opens its report
 * by itself (`hcm-archive-arrived`): choosing the files and Import are the owner's only inputs (§8.3, the admin-input budget).
 */
import { html, type PropertyValues, type TemplateResult } from 'lit';

import { errorTemplate } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import type { ArchiveRowPort, ArchiveViewPort } from './archive-port.js';
import { ArchiveElement, count, sizeText } from './archive-element.js';

export const HCM_ARCHIVE_PANEL_TAG = 'hcm-archive-panel';

export class HcmArchivePanel extends ArchiveElement {
    /** The archives listed when the card first read them (null before): any other one arrived since. */
    #known: ReadonlySet<string> | null = null;

    protected override updated(changed: PropertyValues): void {
        super.updated(changed);
        const view = this.view;
        if (view?.status === 'ready') {
            this.#arrived(view.archives);
        }
    }

    protected override detach(): void {
        super.detach();
        this.#known = null;
    }

    /** A new archive not yet imported: the page opens its report. */
    #arrived(archives: readonly ArchiveRowPort[]): void {
        const known = this.#known;
        this.#known = new Set(archives.map((row) => row.id));
        const fresh = known === null ? undefined : archives.find((row) => !known.has(row.id) && !row.imported);
        if (fresh !== undefined) {
            this.dispatchEvent(new CustomEvent('hcm-archive-arrived', { detail: { id: fresh.id }, bubbles: true, composed: true }));
        }
    }
    override render(): TemplateResult {
        const view = this.view;
        return html`<section data-archive-panel>
            <h3 class="title">${this.t('adminArchive.title')}</h3>
            <p class="note">${this.t('adminArchive.intro')}</p>
            ${view === null ? EMPTY : this.#body(view)}
        </section>`;
    }

    #body(view: ArchiveViewPort): TemplateResult {
        if (view.status === 'error') {
            return errorTemplate(this.locale, view.failure, () => this.feed?.intents.retry());
        }
        return html`${this.#choose(view)} ${this.#archives(view)}`;
    }

    #choose(view: ArchiveViewPort): TemplateResult {
        if (!view.connected) {
            return html`<p data-state="no-worker">${this.t('adminArchive.noWorker')}</p>
                <div class="actions"><a class="external" href="#/jobs">${this.t('adminArchive.openJobs')}</a></div>`;
        }
        return html`<div class="actions">
                <a class="link-button" data-choose href=${view.importUrl} target="_blank" rel="noopener noreferrer"
                    ><hcm-icon name="open_in_new" aria-hidden="true"></hcm-icon>${this.t('adminArchive.choose')}</a
                >
            </div>
            <p class="note">${this.t('adminArchive.chooseNote')}</p>`;
    }

    #archives(view: ArchiveViewPort): TemplateResult {
        const rows =
            view.archives.length === 0
                ? html`<p class="note" data-state="no-archives">${this.t('adminArchive.none')}</p>`
                : html`<ul class="rows">
                      ${view.archives.map((row) => html`<li>${this.#row(row)}</li>`)}
                  </ul>`;
        return html`<h4>${this.t('adminArchive.archives')}</h4>
            ${rows}`;
    }

    #row(row: ArchiveRowPort): TemplateResult {
        const locale = this.locale;
        const detail = this.t('adminArchive.row', {
            ...{ series: count(locale, row.series), files: count(locale, row.files) },
            size: sizeText(locale, row.bytes),
        });
        const imported = row.imported ? html` <span class="tag" data-tone="good">${this.t('adminArchive.rowImported')}</span>` : EMPTY;
        const href = `#/imagery/archive/${row.id}`;
        return html`<a class="row" data-archive=${row.id} href=${href}
            ><span class="row-title">${row.name}${imported}</span><span class="row-detail">${detail}</span></a
        >`;
    }
}
