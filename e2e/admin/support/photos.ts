import { translateAdminContent, type AdminContentKey } from '@hcm/shared';
import type { Page } from '@playwright/test';

import type { EmulatorWorld } from './emulators.js';

/**
 * The photos area's world for the admin tier (docs/research/M2c-interfaces.md §6, §12.3): the city the admin edits and
 * its photos, written into the Firestore emulator past the rules (as the processing trigger or an earlier session would
 * have left them), the derivatives' addresses answered with one small image, and the photos page's texts.
 */

/** The city of `infra/project.json` the admin edits (`E2E_PROJECT_CONFIG.cities[0]`). */
export const PHOTOS_CITY = 'bucharest';

/** A 1×1 PNG: every derivative of the seeded photos. */
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');

/** Where the seeded derivatives live (the public bucket's address, answered by `servePhotoImages`). */
const IMAGE_BASE = 'https://storage.googleapis.com/demo-hcm-public/photos/bucharest';

/** An editor text (`adminContent.*`) in the project's language. */
export function photosText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** Answers every seeded derivative with the one-pixel image (the browser never reaches the real bucket). */
export async function servePhotoImages(page: Page): Promise<void> {
    await page.route(`${IMAGE_BASE}/**`, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL }));
}

/** The city document: bounds around Bucharest, published. */
export async function seedPhotosCity(emulators: EmulatorWorld, at: Date): Promise<void> {
    await emulators.setDocument(`cities/${PHOTOS_CITY}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

export interface SeededPhoto {
    readonly id: string;
    readonly title: string;
    readonly extra?: Readonly<Record<string, unknown>>;
}

function image(id: string): Record<string, unknown> {
    return {
        web: `${IMAGE_BASE}/${id}/web.webp`,
        thumb: `${IMAGE_BASE}/${id}/thumb.webp`,
        sha256: id
            .padEnd(64, '0')
            .slice(0, 64)
            .replace(/[^a-f0-9]/g, 'a'),
        w: 1,
        h: 1,
    };
}

/** A processed, unpublished photo of the city (its `extra` overrides any field). */
export async function seedPhoto(emulators: EmulatorWorld, photo: SeededPhoto, at: Date, uid: string): Promise<void> {
    const fields: Record<string, unknown> = {
        title: { ro: photo.title },
        license: 'CC-BY-4.0',
        location: { lat: 44.43, lng: 26.1 },
        published: false,
        processing: 'done',
        image: image(photo.id),
        createdAt: at,
        createdBy: uid,
        updatedBy: uid,
        updatedAt: at,
        ...photo.extra,
    };
    // An `undefined` in `extra` leaves the field out (a photo still processing has no image).
    await emulators.setDocument(
        `cities/${PHOTOS_CITY}/photos/${photo.id}`,
        Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)),
    );
}
