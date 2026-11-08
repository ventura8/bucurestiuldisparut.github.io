/**
 * The city's tab icon in the public bucket (`docs/research/M2-interfaces.md` → *The city's tab icon*), shared plumbing of
 * `cities.setIcon` (an editor's upload or Use the default) and the manifest's build (the default kept in the city's seed
 * colour): the PNGs at `CITY_ICON_SIZES`, under fixed names (`STORAGE_PATHS.cityIcon`) the city's pages link to, with a
 * five-minute cache, so a new icon reaches every tab on its next load without a deploy.
 */
import { createHash } from 'node:crypto';

import {
    CITY_ICON_SIZES,
    DEFAULT_ICON_COLOR,
    FIRESTORE_PATHS,
    STORAGE_PATHS,
    cityDocSchema,
    publicObjectUrl,
    timestampFromDate,
    type CityDoc,
} from '@hcm/shared';

import type { IconSource } from '../ports/image-processor.js';
import type { Ports } from '../ports/index.js';

export type CityIconDeps = Pick<Ports, 'documents' | 'blobs' | 'images' | 'clock' | 'config'>;

export type CityIconRecord = NonNullable<CityDoc['icon']>;

/** Short enough for a new icon to show within minutes, long enough that a busy map's visitors fetch it rarely. */
const CITY_ICON_CACHE_CONTROL = 'public, max-age=300';

/** The size the admin previews (`icon.url`). */
const PREVIEW_SIZE = 180;

/** The colour a city's default icon wears: its theme's seed, else the project's default. */
export function iconSeedOf(city: Pick<CityDoc, 'theme'>): string {
    return city.theme?.seedColor ?? DEFAULT_ICON_COLOR;
}

/** What the icon was drawn from, as bytes: the upload, or our SVG's text. */
function sourceBytes(source: IconSource): Uint8Array | string {
    return 'upload' in source ? source.upload : source.ownSvg;
}

/**
 * Writes the icon's PNGs over the previous ones; returns the preview's address and the source's SHA-256 (what the
 * admin's preview is versioned by: a new upload or a new colour changes it).
 */
export async function storeCityIcon(
    deps: CityIconDeps,
    cityId: string,
    source: IconSource,
): Promise<Pick<CityIconRecord, 'url' | 'sha256'>> {
    await Promise.all(
        CITY_ICON_SIZES.map(async (size) => {
            const png = await deps.images.iconPng(source, size);
            await deps.blobs.write('public', STORAGE_PATHS.cityIcon(cityId, size), png, {
                contentType: 'image/png',
                cacheControl: CITY_ICON_CACHE_CONTROL,
            });
        }),
    );
    return {
        url: publicObjectUrl(deps.config.buckets.public, STORAGE_PATHS.cityIcon(cityId, PREVIEW_SIZE)),
        sha256: createHash('sha256').update(sourceBytes(source)).digest('hex'),
    };
}

/**
 * Records `icon` on the city, leaving every other field and the city's own stamp as they are (an icon-only write, which
 * `history.onCityWrite` does not list and no manifest build follows). `keep` decides, on the current record, whether to
 * leave it (a custom icon an editor uploaded meanwhile); false when the city is gone or kept.
 */
export async function recordCityIcon(
    deps: Pick<CityIconDeps, 'documents'>,
    cityId: string,
    icon: CityIconRecord,
    keep: (current: CityDoc) => boolean = () => false,
): Promise<boolean> {
    const path = FIRESTORE_PATHS.city(cityId);
    return deps.documents.transaction(async (transaction) => {
        const city = await transaction.get(path, cityDocSchema);
        if (city === undefined || keep(city)) {
            return false;
        }
        await transaction.set(path, cityDocSchema, { ...city, icon });
        return true;
    });
}

/** The stamp of an icon record. */
export function iconStamp(deps: Pick<CityIconDeps, 'clock'>, writer: string): Pick<CityIconRecord, 'updatedBy' | 'updatedAt'> {
    return { updatedBy: writer, updatedAt: timestampFromDate(deps.clock.now()) };
}
