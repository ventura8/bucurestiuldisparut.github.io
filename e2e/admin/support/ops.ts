import { translateAdminContent, type AdminContentKey } from '@hcm/shared';
import { expect } from '@playwright/test';

import type { EmulatorWorld } from './emulators.js';

/**
 * The operations screens' world for the admin tier (docs/research/M2c-interfaces.md §9; behaviours A02, A18, A22, A23 and
 * the dashboard): the city the admin edits, its jobs and log lines as the raster pipeline would leave them, places whose
 * writes the history triggers record, and the editors' texts. Everything is written past the rules, as the server does.
 */

/** The city of `infra/project.json` the admin edits (`E2E_PROJECT_CONFIG.cities[0]`). */
export const OPS_CITY = 'bucharest';

/** An editor text (`adminContent.*`) in the project's language. */
export function contentText(lang: 'ro' | 'en', key: AdminContentKey, params: Readonly<Record<string, string>> = {}): string {
    return translateAdminContent(lang, key, params);
}

/** The city document: bounds around Bucharest, published. */
export async function seedCity(emulators: EmulatorWorld, at: Date): Promise<void> {
    await emulators.setDocument(`cities/${OPS_CITY}`, {
        name: { ro: 'București', en: 'Bucharest' },
        bounds: { west: 25.9, south: 44.3, east: 26.3, north: 44.6 },
        published: true,
        updatedBy: 'system:setup',
        updatedAt: at,
    });
}

/** A job of the city as the dispatcher and the pipeline keep it (`jobDocSchema`). */
export async function seedJob(emulators: EmulatorWorld, id: string, fields: Readonly<Record<string, unknown>>, at: Date): Promise<void> {
    await emulators.setDocument(`cities/${OPS_CITY}/jobs/${id}`, {
        params: {},
        createdAt: at,
        updatedBy: 'system:pipeline',
        updatedAt: at,
        ...fields,
    });
}

/** One redacted log line of a job (`jobLogDocSchema`, id: `seq` padded to six digits). */
export async function seedLogLine(emulators: EmulatorWorld, jobId: string, seq: number, message: string, at: Date): Promise<void> {
    await emulators.setDocument(`cities/${OPS_CITY}/jobs/${jobId}/logs/${String(seq).padStart(6, '0')}`, {
        seq,
        level: 'info',
        step: 'fetch',
        message,
        updatedBy: 'system:pipeline',
        updatedAt: at,
    });
}

/** A place (`poiDocSchema`): its creation is recorded by `history.onPoiWrite`. */
export async function seedPlace(emulators: EmulatorWorld, id: string, title: string, at: Date): Promise<void> {
    await emulators.setDocument(`cities/${OPS_CITY}/pois/${id}`, {
        category: 'monuments',
        geometry: { type: 'Point', point: { lat: 44.446, lng: 26.074 } },
        title: { ro: title },
        published: false,
        createdAt: at,
        createdBy: 'system:bootstrap',
        updatedBy: 'system:bootstrap',
        updatedAt: at,
    });
}

/** Waits until the history triggers have recorded `count` entries of a place. */
export async function expectEntries(emulators: EmulatorWorld, placeId: string, count: number): Promise<void> {
    await expect
        .poll(async () => Object.keys(await emulators.collection(`cities/${OPS_CITY}/pois/${placeId}/history`)).length, { timeout: 30_000 })
        .toBe(count);
}
