/**
 * The credits of the historical layers in the visitor's language (the Pixel Tablet, 2026-11-12: the Layers panel said
 * "Sursa: USGS EROS, declassified imagery (public domain)" once per layer, in English on the Romanian map). A layer's
 * `attribution` is stored as the pipeline words it (`USGS_ATTRIBUTION`, `LANDSAT_ATTRIBUTION`, the DEM's notice joined
 * with "; "), in English: the viewer shows each known credit as its text key in the visitor's language and anything else
 * (an admin's own credit, a licence notice) as written.
 */
import { LOCALES, translate, type Locale, type MessageKey } from '../i18n/index.js';

/** The credits the pipeline writes, as text keys; their English text is the stored constant (a test holds them equal). */
const CREDIT_KEYS: readonly MessageKey[] = ['layers.attribution.usgs', 'layers.attribution.landsat'];

/** What separates the credits of one layer (`finalize.ts` joins the DEM's notice so). */
const CREDIT_SEPARATOR = '; ';

/**
 * `text` with every known credit, in any language, in `locale`'s words: a layer's attribution, or the map's attribution
 * line, which Mapbox GL drew in the language of the page's first load.
 */
export function localizedCredit(text: string, locale: Locale): string {
    return CREDIT_KEYS.reduce(
        (out, key) => LOCALES.reduce((acc, other) => acc.replaceAll(translate(other, key), translate(locale, key)), out),
        text,
    );
}

/**
 * One layer's credits in `locale`: each known credit it holds, then the rest as written (a notice may hold "; " of its
 * own: the DEM's "…; all rights reserved").
 */
function partsOf(attribution: string, locale: Locale): readonly string[] {
    const text = localizedCredit(attribution, locale);
    const known = CREDIT_KEYS.map((key) => translate(locale, key)).filter((credit) => text.includes(credit));
    const rest = known.reduce((out, credit) => out.replace(credit, CREDIT_SEPARATOR), text);
    // The separators the known credits leave behind go; the rest's own stay ("…; all rights reserved").
    const notices = rest
        .split(';')
        .map((piece) => piece.trim())
        .filter((piece) => piece !== '');
    return [...known, notices.join(CREDIT_SEPARATOR)];
}

/** The distinct credits of `attributions` in `locale`, each once, in their first order (blank parts dropped). */
export function creditParts(attributions: readonly string[], locale: Locale): readonly string[] {
    const parts = attributions.flatMap((attribution) => partsOf(attribution, locale));
    return [...new Set(parts.map((part) => part.trim()).filter((part) => part !== ''))];
}
