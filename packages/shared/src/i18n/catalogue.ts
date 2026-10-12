import type { Locale } from './index.js';

const PLACEHOLDER = /\{(\w+)\}/g;

/** Translates one key of a catalogue family, filling `{name}` placeholders (unknown ones stay visible). */
export type Translator<Key extends string> = (locale: Locale, key: Key, params?: Readonly<Record<string, string>>) => string;

/** One catalogue per locale, every key of the family in each. */
type Catalogues<Key extends string> = Readonly<Record<Locale, Readonly<Record<Key, string>>>>;

/**
 * A translate function over one catalogue per locale, for the catalogues kept apart from the viewer's (the admin's
 * own texts, `docs/research/M2b-interfaces.md` §1.6): the public viewer imports none of them.
 */
export function catalogueTranslator<Key extends string>(catalogues: Catalogues<Key>): Translator<Key> {
    return (locale, key, params = {}) =>
        catalogues[locale][key].replace(PLACEHOLDER, (placeholder: string, name: string) => params[name] ?? placeholder);
}
