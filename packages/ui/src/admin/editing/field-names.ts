/**
 * A document field's name in the admin's language (the UX review of 2026-10-18, `DECISIONS-for-review.md` §42e): History's
 * "what changed" and the editors' conflict banners name a field as the editors' forms do ("Title", "Shown at start"),
 * never as it is stored (`title`, `defaultVisible`). A field the catalogue does not know (a server field added later)
 * keeps its stored name, so nothing is ever hidden.
 */
import type { AdminContentKey, Locale } from '@hcm/shared';

import { contentText } from '../shell/text.js';

const FIELDS = [
    'name',
    'bounds',
    'center',
    'zoom',
    'minZoom',
    'maxZoom',
    'about',
    'privacy',
    'credits',
    'theme',
    'basemap',
    'photosOverlay',
    'published',
    'updatedBy',
    'updatedAt',
    'createdAt',
    'createdBy',
    'title',
    'description',
    'year',
    'yearStart',
    'yearEnd',
    'dateText',
    'date',
    'author',
    'license',
    'rightsHolder',
    'sourceUrl',
    'sourceLabel',
    'permissionNote',
    'legacyId',
    'links',
    'location',
    'bearing',
    'fov',
    'rightsReview',
    'processing',
    'label',
    'attribution',
    'order',
    'opacity',
    'defaultVisible',
    'adjustments',
    'category',
    'geometry',
    'photoIds',
    'icon',
    'color',
    'defaultOpacity',
    'source',
    'analytics',
    'mapbox',
] as const;

type NamedField = (typeof FIELDS)[number];

const NAMED: ReadonlySet<string> = new Set(FIELDS);

function isNamed(field: string): field is NamedField {
    return NAMED.has(field);
}

/** The field's name in `locale` ("Title" for `title`), or the stored name for a field the catalogue does not know. */
export function fieldName(locale: Locale, field: string): string {
    if (!isNamed(field)) {
        return field;
    }
    const key: AdminContentKey = `adminContent.field.${field}`;
    return contentText(locale, key);
}

/** Several fields' names, in the given order, joined as a list ("Title, Year"). */
export function fieldNames(locale: Locale, fields: readonly string[]): string {
    return fields.map((field) => fieldName(locale, field)).join(', ');
}
