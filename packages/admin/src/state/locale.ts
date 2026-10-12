/**
 * The admin's language (`docs/research/M2b-interfaces.md` §1.6): `?lang=en` (or `ro`), then the stored choice
 * (`localStorage` `hcm:admin:lang`), then the browser's first language, then Romanian. Switching keeps every form's
 * state (the shell only re-renders its texts) and `<html lang>` follows it.
 */
import { LOCALES, resolveLocale, type Locale } from '@hcm/shared';

export const LANGUAGE_KEY = 'hcm:admin:lang';

function isLocale(value: string | null): value is Locale {
    return (LOCALES as readonly (string | null)[]).includes(value);
}

/** The `lang` parameter of `search` when it names a supported language. */
function queryLocale(search: string): Locale | null {
    const value = new URLSearchParams(search).get('lang');
    return isLocale(value) ? value : null;
}

export function resolveAdminLocale(search: string, stored: string | null, languages: readonly string[]): Locale {
    return queryLocale(search) ?? (isLocale(stored) ? stored : resolveLocale(languages[0]));
}
