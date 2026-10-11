/**
 * Assembles a static City Manifest v1 from a city seed (hand-written JSON: names, About, credits,
 * privacy, basemap, ...), the generated theme, and the migrated photos with their derived images.
 * The result is validated with the strict manifest schema; the CLI writes it only when it passes.
 */
import { translate } from '../i18n/index.js';
import { MANIFEST_VERSION, type Credit, type Manifest, type PhotoImage, type Theme } from '../schemas/manifest.js';
import { validateManifest, type ValidationResult } from '../schemas/validation.js';
import type { MigratedPhoto } from './legacy-photos.js';

export interface StaticManifestInput {
    /** Everything of `city` except `theme`; its `credits` get the photo authors' credit first. */
    readonly city: Readonly<Record<string, unknown>>;
    readonly theme: Theme;
    readonly photos: readonly MigratedPhoto[];
    /** The derived images per photo id; a photo without one is left out. */
    readonly images: ReadonlyMap<string, PhotoImage>;
}

/** One credit naming every photo author, alphabetically in Romanian order; null when there is none. */
export function photoAuthorsCredit(photos: readonly { readonly author?: string | undefined }[]): Credit | null {
    const authors = [...new Set(photos.flatMap((photo) => (photo.author === undefined ? [] : [photo.author])))].toSorted((a, b) =>
        a.localeCompare(b, 'ro'),
    );
    if (authors.length === 0) {
        return null;
    }
    const names = authors.join(', ');
    return { label: { ro: `${translate('ro', 'photos.title')}: ${names}`, en: `${translate('en', 'photos.title')}: ${names}` } };
}

/** The manifest for `input`, validated (a failure lists the localized issues). */
export function buildStaticManifest(input: StaticManifestInput): ValidationResult<Manifest> {
    const photos = input.photos.flatMap((migrated) => {
        const image = input.images.get(migrated.photo.id);
        return image === undefined ? [] : [{ ...migrated.photo, image }];
    });
    const credit = photoAuthorsCredit(photos);
    const credits = Array.isArray(input.city['credits']) ? (input.city['credits'] as unknown[]) : [];
    return validateManifest({
        version: MANIFEST_VERSION,
        city: { ...input.city, theme: input.theme, credits: credit === null ? credits : [credit, ...credits] },
        layers: [],
        photos,
    });
}
