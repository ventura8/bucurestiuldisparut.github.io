/**
 * `<hcm-settings-page>`: `#/settings`, `#/settings/<section>` and `#/settings/categories/<id>`
 * (`docs/research/M2c-interfaces.md` §8.5; behaviours A19, A36, A39). The sections in the list pane; the open one in the
 * detail pane (in its place below 840 px), each its own draft with its own Save. While the theme section previews a
 * seed, the page wears the previewed schemes (the whole admin once the shell's preview is wired, CR-M2c-28); Discard,
 * Save or leaving takes them off.
 */
import type { Locale, ThemeTokens } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { clearTheme, applyTheme, type ThemeMode } from '../../theme/apply.js';
import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { current, errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { keepFocus } from '../layers/focus-keeper.js';
import { announcer } from '../layers/form-parts.js';
import { layersStyles } from '../layers/layers-styles.js';
import { RowDrag } from '../layers/reorder.js';
import { EMPTY } from '../shell/empty.js';
import { contentText } from '../shell/text.js';
import { areaSection } from './area-section.js';
import { categoriesSection } from './categories-section.js';
import { overlaysSection } from './overlays-section.js';
import { sectionTitle, type SectionContext } from './section-parts.js';
import type { SettingsIntentsPort, SettingsSectionPort, SettingsViewState } from './settings-port.js';
import { settingsStyles } from './settings-styles.js';
import { textsSection } from './texts-section.js';
import { themeSection } from './theme-section.js';

export const HCM_SETTINGS_PAGE_TAG = 'hcm-settings-page';

const SECTIONS: readonly SettingsSectionPort[] = ['area', 'texts', 'theme', 'categories', 'overlays'];

const SECTION_ICONS: Readonly<Record<SettingsSectionPort, string>> = {
    area: 'crop_free',
    texts: 'translate',
    theme: 'palette',
    categories: 'place',
    overlays: 'opacity',
};

const RENDERERS: Readonly<Record<Exclude<SettingsSectionPort, 'categories'>, (context: SectionContext) => TemplateResult>> = {
    area: areaSection,
    texts: textsSection,
    theme: themeSection,
    overlays: overlaysSection,
};

export class HcmSettingsPage extends AreaPage<SettingsViewState, SettingsIntentsPort> {
    static override readonly properties = { ...AreaPage.properties, announcement: { state: true } };

    static override readonly styles = [...layersStyles, settingsStyles];

    protected readonly route: AdminRouteIdPort = 'settings';
    declare announcement: string;
    readonly #drag = new RowDrag((id, index) => {
        void this.intents?.moveCategoryTo(id, index);
    });

    constructor() {
        super();
        this.announcement = '';
        keepFocus(this);
    }

    protected storeOf(content: ContentPort): AreaPort<SettingsViewState, SettingsIntentsPort> | null {
        return content.settings;
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        clearTheme(this);
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        return html`<hcm-list-detail
                ?detail=${view.section !== null}
                .detailKey=${[view.section ?? '', view.category?.id ?? ''].join('/').replace(/\/$/, '')}
                .listLabel=${contentText(locale, 'adminContent.settings.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.settings.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${() => {
                    this.go(view.category === null ? [] : ['categories']);
                }}
            >
                <div slot="list">${this.#sections(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${announcer(this.announcement)}`;
    }

    /** The page wears the previewed theme while there is one. */
    override updated(): void {
        const preview = this.#preview();
        if (preview === null) {
            clearTheme(this);
        } else {
            applyTheme(this, preview, this.#mode(), false);
        }
    }

    #preview(): ThemeTokens | null {
        return this.view === null ? null : this.view.citySection.theme.preview;
    }

    #mode(): ThemeMode {
        return this.state === null ? 'system' : this.state.theme.mode;
    }

    #sections(locale: Locale, view: SettingsViewState): TemplateResult {
        return html`<div class="list-head">
                <h2>${contentText(locale, 'adminContent.settings.title')}</h2>
                ${reconnectingStatus(locale, view.city.reconnecting)}
            </div>
            <ul class="rows" aria-label=${contentText(locale, 'adminContent.settings.sections')}>
                ${SECTIONS.map(
                    (section) =>
                        html`<li>
                            <a class="row section-row" href=${this.href([section])} aria-current=${current(section === view.section)}>
                                <hcm-icon name=${SECTION_ICONS[section]}></hcm-icon>
                                <span class="row-text">
                                    <span class="row-title">${sectionTitle(locale, section)}</span>
                                    <span class="row-detail">${contentText(locale, `adminContent.settings.section.${section}Hint`)}</span>
                                </span>
                            </a>
                        </li>`,
                )}
            </ul>`;
    }

    #detail(locale: Locale, view: SettingsViewState): TemplateResult {
        const section = view.section;
        if (section === null) {
            return html`<hcm-empty-state icon="settings" .text=${contentText(locale, 'adminContent.settings.choose')}></hcm-empty-state>`;
        }
        if (view.city.status === 'error') {
            return errorTemplate(locale, view.city.failure, () => this.intents?.retry());
        }
        if (view.city.status === 'loading') {
            return loadingTemplate(locale);
        }
        return html`<div class="pane">${this.#section(locale, view, section)}</div>`;
    }

    #section(locale: Locale, view: SettingsViewState, section: SettingsSectionPort): TemplateResult {
        if (view.city.doc === null && section !== 'categories' && section !== 'overlays') {
            return html`<h2 tabindex="-1" data-detail-heading>${sectionTitle(locale, section)}</h2>
                <p class="alert" role="alert"><span>${contentText(locale, 'adminContent.settings.cityMissing')}</span></p>`;
        }
        const context: SectionContext = {
            ...{ locale, view, intents: this.intents },
            href: (params) => this.href(params),
            go: (params) => {
                this.go(params);
            },
            announce: (text) => {
                this.announcement = text;
            },
        };
        return section === 'categories' ? categoriesSection(context, this.#drag) : RENDERERS[section](context);
    }
}

/** Registers `<hcm-settings-page>` and the icon picker it renders. */
export function defineHcmSettingsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SETTINGS_PAGE_TAG) === undefined) {
        registry.define(HCM_SETTINGS_PAGE_TAG, HcmSettingsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-settings-page': HcmSettingsPage;
    }
}
