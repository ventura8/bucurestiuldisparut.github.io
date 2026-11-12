import { en } from './en.js';
import { ro, type MessageKey } from './ro.js';

export type { MessageKey, Messages } from './ro.js';

/** The languages of the admin and of a city's own texts (`{ro, en}`): Romanian, the source, and English. */
export const LOCALES = ['ro', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * The public viewer's languages (docs/ENGINE_API.md → Language): Romanian, the default and the source of every key,
 * English, and fourteen more. The engine bundles none of their catalogues: each is fetched once, when first shown,
 * from `i18n/<locale>.json` next to the engine (`docs/research/DECISIONS-for-review.md` §159).
 */
export const VIEWER_LOCALES = ['ro', 'en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'uk', 'pl', 'tr', 'ar', 'hi', 'zh', 'ja', 'ko'] as const;

export type ViewerLocale = (typeof VIEWER_LOCALES)[number];

/** Romanian is the default for every visitor whose language is not explicitly another one. */
export const DEFAULT_LOCALE: Locale = 'ro';

/**
 * The catalogues this page has: Romanian and English imported (the admin, the start page, the tests), every other one
 * registered once fetched. The engine's build replaces the two imports with empty stand-ins, so it registers all of them.
 */
const CATALOGUES: Partial<Record<ViewerLocale, Readonly<Record<string, string>>>> = { ro, en };

const PLACEHOLDER = /\{(\w+)\}/g;

/** The viewer language of a BCP 47 tag (`de-AT`, `zh-TW`, `EN`), by its primary subtag, or undefined for any other. */
export function viewerLocaleOf(tag: string | null | undefined): ViewerLocale | undefined {
    const language = (tag ?? '').trim().toLowerCase().replace(/-.*/s, '');
    return VIEWER_LOCALES.find((locale) => locale === language);
}

/** The viewer language of a tag, falling back to {@link DEFAULT_LOCALE}. */
export function resolveViewerLocale(tag: string | null | undefined): ViewerLocale {
    return viewerLocaleOf(tag) ?? DEFAULT_LOCALE;
}

/** Maps a tag to the admin's two languages: English stays English, anything else becomes {@link DEFAULT_LOCALE}. */
export function resolveLocale(tag: string | null | undefined): Locale {
    return viewerLocaleOf(tag) === 'en' ? 'en' : DEFAULT_LOCALE;
}

/** Arabic, the one language of the sixteen written right to left. */
export function isRtl(locale: ViewerLocale): boolean {
    return locale === 'ar';
}

/** Adds a fetched catalogue (the engine's loader, after checking it). */
export function registerCatalogue(locale: ViewerLocale, messages: Readonly<Record<string, string>>): void {
    CATALOGUES[locale] = messages;
}

/** True once `locale`'s texts are here: the viewer renders no text before. */
export function hasCatalogue(locale: ViewerLocale): boolean {
    return CATALOGUES[locale] !== undefined;
}

/** One text of `locale`'s catalogue by any key (the map labels' family is in the same fetched file), or undefined. */
export function catalogueText(locale: ViewerLocale, key: string): string | undefined {
    return CATALOGUES[locale]?.[key];
}

/**
 * Translates `key` and fills `{name}` placeholders from `params`; unknown placeholders are left visible. A locale whose
 * catalogue is not here yet gives an empty text, never a raw key. In a right-to-left language each value is isolated
 * (U+2068 … U+2069), so a Latin layer name keeps its own order inside the Arabic sentence.
 */
export function translate(locale: ViewerLocale, key: MessageKey, params: Readonly<Record<string, string>> = {}): string {
    const [open, close] = isRtl(locale) ? ['⁨', '⁩'] : ['', ''];
    return (catalogueText(locale, key) ?? '').replace(PLACEHOLDER, (placeholder: string, name: string) => {
        const value = params[name];
        return value === undefined ? placeholder : open + value + close;
    });
}

/**
 * Each viewer language by its own name (an endonym: data, not a translation, the same in every catalogue), in the order
 * the language list shows them: the root collation's (`Intl.Collator('und')`, Latin first), so the list never reorders
 * when the page's language changes.
 */
export const LANGUAGE_NAMES: Readonly<Record<ViewerLocale, string>> = {
    de: 'Deutsch',
    en: 'English',
    es: 'Español',
    fr: 'Français',
    it: 'Italiano',
    pl: 'Polski',
    pt: 'Português',
    ro: 'Română',
    tr: 'Türkçe',
    ru: 'Русский',
    uk: 'Українська',
    ar: 'العربية',
    hi: 'हिन्दी',
    ko: '한국어',
    zh: '中文',
    ja: '日本語',
};

/** The tags `Intl` formats with where the bare code would not do: the owner's photo dates (`en` alone would write `July 12, 1936`), Latin digits in Arabic (as the timeline's years). */
const INTL_TAGS: Partial<Record<ViewerLocale, string>> = { ro: 'ro-RO', en: 'en-GB', ar: 'ar-u-nu-latn' };

/** The `Intl` tag of a viewer language. */
export function intlTag(locale: ViewerLocale): string {
    return INTL_TAGS[locale] ?? locale;
}

/** A city's own text (`{ro, en?}`, a name, a caption, About): Romanian always, English often, other languages maybe. */
export type CityText = { readonly ro: string } & Partial<Readonly<Record<ViewerLocale, string | undefined>>>;

/**
 * The language a city's text is shown in for a visitor reading `locale` (docs/ENGINE_API.md → Language): its own, else
 * English, else Romanian, the source every text has. The element showing it takes this as its `lang`.
 */
export function shownLanguage(text: CityText, locale: ViewerLocale): ViewerLocale {
    if (text[locale] !== undefined) {
        return locale;
    }
    return text.en === undefined ? 'ro' : 'en';
}

/** A city's text in `locale`, falling back as {@link shownLanguage} says. */
export function localized(text: CityText, locale: ViewerLocale): string {
    return text[shownLanguage(text, locale)] ?? text.ro;
}
