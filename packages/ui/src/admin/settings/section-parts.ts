/**
 * What every settings section shares: its context (the language, the area's state and intents, the page's addresses
 * and its polite region) and the top of a section that edits the city (heading, save row, conflict banner).
 */
import type { CityDoc, Locale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { conflictBanner, saveBar, saveStateOf } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import type { SettingsIntentsPort, SettingsViewState } from './settings-port.js';

export interface SectionContext {
    readonly locale: Locale;
    readonly view: SettingsViewState;
    readonly intents: SettingsIntentsPort | null;
    /** `#/settings/<params>`. */
    readonly href: (params: readonly string[]) => string;
    /** Opens `#/settings/<params>`. */
    readonly go: (params: readonly string[]) => void;
    /** Says a settled change in the page's polite region. */
    readonly announce: (text: string) => void;
}

export const SETTINGS_SAVE_TEXTS = {
    saved: 'adminContent.settings.state.saved',
    unsaved: 'adminContent.settings.state.unsaved',
    saving: 'adminContent.settings.state.saving',
} as const;

export const SETTINGS_CONFLICT_TEXTS = {
    conflict: 'adminContent.settings.conflict',
    keepMine: 'adminContent.settings.keepMine',
    takeTheirs: 'adminContent.settings.takeTheirs',
} as const;

/** The heading, save row and conflict banner of a section that edits the city document. */
export function cityHead(context: SectionContext, title: string): TemplateResult {
    const { locale, intents } = context;
    const draft = context.view.citySection.draft;
    const state = saveStateOf({ ...draft, dirty: draft.dirty.length > 0 });
    const handlers = {
        save: () => {
            void intents?.saveSection();
        },
        discard: () => {
            intents?.discardSection();
        },
    };
    return html`<h2 tabindex="-1" data-detail-heading>${title}</h2>
        ${saveBar(locale, SETTINGS_SAVE_TEXTS, state, handlers)}
        ${conflictBanner(locale, SETTINGS_CONFLICT_TEXTS, draft.conflict, {
            keepMine: () => {
                intents?.keepMine();
            },
            takeTheirs: () => {
                intents?.takeTheirs();
            },
        })}`;
}

/** The city as the open section edits it, or null before it is read. */
export function cityOf(context: SectionContext): CityDoc | null {
    return context.view.citySection.draft.value;
}

/** A section heading's text. */
export function sectionTitle(locale: Locale, section: 'area' | 'texts' | 'theme' | 'categories' | 'overlays'): string {
    return contentText(locale, `adminContent.settings.section.${section}`);
}
