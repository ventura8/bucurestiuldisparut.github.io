/**
 * Viewer texts built from manifest data and the i18n catalogues: localized data fields (English falls back to
 * Romanian), photo dates, POI year spans, counted forms and licences. Everything returned here is plain text that
 * the elements render with Lit templates, never as HTML.
 */
import { translate, type License, type Locale, type Photo, type Poi } from '@hcm/shared';

/** A `{ro, en?}` data text (photo and POI texts: English is optional). */
export interface DataText {
    readonly ro: string;
    readonly en?: string | undefined;
}

/** The text in `locale`; English falls back to Romanian. */
export function localizedText(text: DataText, locale: Locale): string {
    return locale === 'en' ? (text.en ?? text.ro) : text.ro;
}

type PhotoDate = Pick<Photo, 'year' | 'yearEnd' | 'dateText'>;

function photoYears(photo: PhotoDate, locale: Locale): string {
    if (photo.year === undefined) {
        return translate(locale, 'photo.unknownYear');
    }
    const year = String(photo.year);
    return photo.yearEnd === undefined || photo.yearEnd === photo.year
        ? translate(locale, 'photo.year', { year })
        : translate(locale, 'photo.years', { year, yearEnd: String(photo.yearEnd) });
}

/** How the photo is dated: the source's own words (`Iulie 1936`), else its year or years, else "unknown year". */
export function photoDateText(photo: PhotoDate, locale: Locale): string {
    return photo.dateText === undefined ? photoYears(photo, locale) : localizedText(photo.dateText, locale);
}

type PoiSpan = Pick<Poi, 'yearStart' | 'yearEnd'>;

function closedSpan(start: number, end: number, locale: Locale): string {
    return start === end
        ? translate(locale, 'poi.year', { year: String(start) })
        : translate(locale, 'poi.years', { yearStart: String(start), yearEnd: String(end) });
}

/** The years of a POI (`Între 1900 și 1986`, `Din 1890`, `Până în 1984`), or null when it has none. */
export function poiYearsText(poi: PoiSpan, locale: Locale): string | null {
    const { yearStart, yearEnd } = poi;
    if (yearStart !== undefined && yearEnd !== undefined) {
        return closedSpan(yearStart, yearEnd, locale);
    }
    if (yearStart !== undefined) {
        return translate(locale, 'poi.yearStart', { yearStart: String(yearStart) });
    }
    return yearEnd === undefined ? null : translate(locale, 'poi.yearEnd', { yearEnd: String(yearEnd) });
}

/** The catalogue key of each plural form the catalogues spell out; every other form uses `photos.count.other`. */
const COUNT_KEYS: Partial<Record<Intl.LDMLPluralRule, 'photos.count.one' | 'photos.count.few'>> = {
    one: 'photos.count.one',
    few: 'photos.count.few',
};

/** `1 fotografie`, `3 fotografii`, `20 de fotografii` / `1 photo`, `3 photos`: the plural form of `locale`. */
export function photoCountText(count: number, locale: Locale): string {
    const key = COUNT_KEYS[new Intl.PluralRules(locale).select(count)] ?? 'photos.count.other';
    return translate(locale, key, { count: String(count) });
}

export function licenseText(license: License, locale: Locale): string {
    return translate(locale, `license.${license}`);
}
