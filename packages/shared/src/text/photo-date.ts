/**
 * A photo's date as a person reads it, from `Intl` so that a new language needs no new text
 * (`docs/research/photo-date-source.md` §1): `12 July 1936`, `12 iulie 1936`, `July 1936`, `Iulie 1936`.
 */
import type { Locale } from '../i18n/index.js';

/** The formats behind the owner's examples: `en` alone would write `July 12, 1936`. */
const INTL_LOCALES: Readonly<Record<Locale, string>> = { ro: 'ro-RO', en: 'en-GB' };

function sentenceCase(text: string, locale: Locale): string {
    return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

function utcDate(year: number, month: number, day: number): Date {
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    return date;
}

/** The date at the precision given: a month and its year, or a day, a month and a year. */
export function formatPhotoDate(
    date: { readonly year: number; readonly month: number; readonly day?: number | undefined },
    locale: Locale,
): string {
    const format = new Intl.DateTimeFormat(INTL_LOCALES[locale], {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
        ...(date.day === undefined ? {} : { day: 'numeric' }),
    });
    return sentenceCase(format.format(utcDate(date.year, date.month, date.day ?? 1)), locale);
}

/** The twelve month names in order, for the editor's list. */
export function monthNames(locale: Locale): readonly string[] {
    const format = new Intl.DateTimeFormat(INTL_LOCALES[locale], { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_unused, index) => sentenceCase(format.format(utcDate(2000, index + 1, 1)), locale));
}
