import { en } from './en.js';
import { ro, type MessageKey, type Messages } from './ro.js';

export type { MessageKey, Messages } from './ro.js';

export const LOCALES = ['ro', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/** Romanian is the default for every visitor whose language is not explicitly English. */
export const DEFAULT_LOCALE: Locale = 'ro';

const CATALOGUES: Readonly<Record<Locale, Messages>> = { ro, en };

const PLACEHOLDER = /\{(\w+)\}/g;

function isLocale(value: string): value is Locale {
    return (LOCALES as readonly string[]).includes(value);
}

/** Maps a BCP 47 tag (`en-US`, `ro`, `fr`) or nothing to a supported locale, falling back to {@link DEFAULT_LOCALE}. */
export function resolveLocale(tag: string | null | undefined): Locale {
    const language = (tag ?? '').trim().toLowerCase().replace(/-.*/s, '');
    return isLocale(language) ? language : DEFAULT_LOCALE;
}

/** Translates `key` and fills `{name}` placeholders from `params`; unknown placeholders are left visible. */
export function translate(locale: Locale, key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    return CATALOGUES[locale][key].replace(PLACEHOLDER, (placeholder: string, name: string) => params[name] ?? placeholder);
}
