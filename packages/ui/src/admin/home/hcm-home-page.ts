/**
 * `<hcm-home-page>`: the dashboard, `#/home` (the M2c brief's "dashboard home"; `docs/research/M2c-interfaces.md`
 * CR-M2c-24). What the city holds (photos, places, categories, layers), what waits for an admin (photos in rights review,
 * unpublished photos, running and failed jobs), each a link to its page; one chip per Setup area with its state (live,
 * from `setup/status`), and the public map's state (live, from `manifests/{city}`). A count that could not be read shows
 * a dash; Refresh counts again.
 */
import type { Locale } from '@hcm/shared';
import { css, html, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { errorTemplate, formatWhen, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf, shellText } from '../shell/text.js';
import type { HealthChipPort, HomeCountPort, HomeIntentsPort, HomeViewState, PublicMapPort } from './home-port.js';

export const HCM_HOME_PAGE_TAG = 'hcm-home-page';

interface Tile {
    readonly count: HomeCountPort;
    readonly href: string;
}

const HOLDINGS: readonly Tile[] = [
    { count: 'photos', href: '#/photos' },
    { count: 'pois', href: '#/pois' },
    { count: 'categories', href: '#/settings/categories' },
    { count: 'layers', href: '#/layers' },
];

const WAITING: readonly Tile[] = [
    { count: 'rightsReviews', href: '#/photos' },
    { count: 'unpublishedPhotos', href: '#/photos' },
    { count: 'activeJobs', href: '#/jobs' },
    { count: 'failedJobs', href: '#/jobs' },
];

const TONES: Readonly<Record<HealthChipPort['state'], 'good' | 'wait' | 'error' | 'none'>> = {
    ok: 'good',
    pending: 'wait',
    missing: 'none',
    invalid: 'error',
    unavailable: 'error',
};

const ICONS: Readonly<Record<HealthChipPort['state'], string>> = {
    ok: 'check_circle',
    pending: 'schedule',
    missing: 'info',
    invalid: 'error',
    unavailable: 'warning',
};

const homeStyles = css`
    .tiles {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 160px), 1fr));
        gap: 8px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .tile {
        display: flex;
        flex-direction: column;
        gap: 4px;
        box-sizing: border-box;
        min-block-size: 88px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
        color: inherit;
        text-decoration: none;
    }

    a.tile:hover {
        background: var(--md-sys-color-surface-container, Canvas);
    }

    .value {
        font-size: var(--md-sys-typescale-headline-medium-size, 1.75rem);
        line-height: var(--md-sys-typescale-headline-medium-line-height, 2.25rem);
    }

    .tile[data-attention] .value {
        color: var(--md-sys-color-primary, LinkText);
    }

    section {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    ul.chips {
        margin: 0;
        padding: 0;
        list-style: none;
    }
`;

export class HcmHomePage extends AreaPage<HomeViewState, HomeIntentsPort> {
    /** The dashboard scrolls with the page area like a form; it has no panes. */
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, homeStyles];

    protected readonly route: AdminRouteIdPort = 'home';

    protected storeOf(content: ContentPort): AreaPort<HomeViewState, HomeIntentsPort> | null {
        return content.home;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const refresh = (): void => {
            void this.intents?.refresh();
        };
        return html`<div class="pane">
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" ?disabled=${view.countsStatus === 'loading'} @click=${refresh}
                    >${shellText(locale, 'adminShell.home.refresh')}</hcm-button
                >
            </div>
            ${this.#tiles(locale, view, 'adminShell.home.holdings', HOLDINGS)}
            ${this.#tiles(locale, view, 'adminShell.home.waiting', WAITING)} ${this.#health(locale, view)} ${this.#publicMap(locale, view)}
        </div>`;
    }

    #tiles(
        locale: Locale,
        view: HomeViewState,
        heading: 'adminShell.home.holdings' | 'adminShell.home.waiting',
        tiles: readonly Tile[],
    ): TemplateResult {
        return html`<section aria-labelledby=${heading}>
            <h2 id=${heading}>${shellText(locale, heading)}</h2>
            <ul class="tiles">
                ${tiles.map((tile) => this.#tile(locale, view, tile, heading === 'adminShell.home.waiting'))}
            </ul>
        </section>`;
    }

    #tile(locale: Locale, view: HomeViewState, tile: Tile, attention: boolean): TemplateResult {
        const value = view.counts?.[tile.count] ?? null;
        return html`<li>
            <a class="tile" href=${tile.href} ?data-attention=${attention && (value ?? 0) > 0}>
                <span class="value">${countText(locale, value, view.countsStatus === 'loading')}</span>
                <span>${shellText(locale, `adminShell.home.count.${tile.count}`)}</span>
            </a>
        </li>`;
    }

    #health(locale: Locale, view: HomeViewState): TemplateResult {
        const retry = (): void => {
            this.intents?.retry();
        };
        return html`<section aria-labelledby="services">
            <h2 id="services">${shellText(locale, 'adminShell.home.services')}</h2>
            ${reconnectingStatus(locale, view.health.reconnecting)}
            ${
                view.health.status === 'error'
                    ? errorTemplate(locale, null, retry)
                    : html`<ul class="chips">
                          ${view.health.chips.map((chip) => this.#chip(locale, chip))}
                      </ul>`
            }
            <p><a href="#/setup">${shellText(locale, 'adminShell.home.openSetup')}</a></p>
        </section>`;
    }

    #chip(locale: Locale, chip: HealthChipPort): TemplateResult {
        const area = shellText(locale, `adminShell.home.area.${chip.area}`);
        const state = shellText(locale, `adminShell.home.state.${chip.state}`);
        const detail = chip.detail === null ? '' : ` (${noticeOf(locale, chip.detail)})`;
        return html`<li class="tag" data-tone=${TONES[chip.state]}>
            <hcm-icon name=${ICONS[chip.state]}></hcm-icon>${area}: ${state}${detail}
        </li>`;
    }

    #publicMap(locale: Locale, view: HomeViewState): TemplateResult {
        const map = publicMapOf(view.publicMap);
        return html`<section aria-labelledby="public-map">
            <h2 id="public-map">${shellText(locale, 'adminShell.home.publicMap')}</h2>
            ${reconnectingStatus(locale, view.publicMap.reconnecting)}
            <p>${publicMapText(locale, map)}</p>
            ${skippedNote(locale, map?.skipped ?? 0)}
        </section>`;
    }
}

const PUBLIC_MAP: Readonly<
    Record<PublicMapPort['status'], 'adminShell.home.map.idle' | 'adminShell.home.map.updating' | 'adminShell.home.map.failed'>
> = {
    idle: 'adminShell.home.map.idle',
    queued: 'adminShell.home.map.updating',
    building: 'adminShell.home.map.updating',
    failed: 'adminShell.home.map.failed',
};

/** The public map once read (null: never built), or undefined while reading. */
function publicMapOf(state: HomeViewState['publicMap']): PublicMapPort | null | undefined {
    if (state.status !== 'ready') {
        return undefined;
    }
    return state.doc === null ? null : state.doc.data;
}

/** A count as text: the number, a dash when it failed, an ellipsis while counting. */
function countText(locale: Locale, value: number | null, counting: boolean): string {
    if (value !== null) {
        return new Intl.NumberFormat(locale).format(value);
    }
    return shellText(locale, counting ? 'adminShell.home.counting' : 'adminShell.home.unknown');
}

/** How many documents the last build left out of the public map (nothing when none). */
function skippedNote(locale: Locale, skipped: number): TemplateResult {
    return skipped > 0 ? html`<p class="note">${shellText(locale, 'adminShell.home.skipped', { count: String(skipped) })}</p>` : EMPTY;
}

/** The public map's state in one sentence (undefined: still reading; null: never built). */
export function publicMapText(locale: Locale, map: PublicMapPort | null | undefined): string {
    if (map === undefined) {
        return contentText(locale, 'adminContent.common.loading');
    }
    if (map === null) {
        return shellText(locale, 'adminShell.home.map.never');
    }
    const date = map.builtAt === null ? '' : formatWhen(locale, map.builtAt);
    return shellText(locale, PUBLIC_MAP[map.status], { date, error: map.error === null ? '' : noticeOf(locale, map.error) });
}

export function defineHcmHomePage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_HOME_PAGE_TAG) === undefined) {
        registry.define(HCM_HOME_PAGE_TAG, HcmHomePage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-home-page': HcmHomePage;
    }
}
