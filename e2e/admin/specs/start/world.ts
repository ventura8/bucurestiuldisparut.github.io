import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { translateStart, type Locale, type StartKey } from '@hcm/shared';
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test';

import { MOCK_API_ORIGIN, TEST_HEADER } from '../../../fixtures/world.js';
import type { UpstreamControl } from '../../support/upstream.js';
import { ADMIN_ORIGIN, E2E_PROJECT_ID, E2E_RELEASED_DIR } from '../../world.js';

/**
 * The start page's world (`docs/research/M14-start-your-map.md` §11): the page at the admin server's `/start/`, Google on the
 * fake upstreams, and the fake Hosting's uploads kept here, since only the browser's route sees their bytes (the mock APIs read
 * text). Each upload's SHA-256 is checked against the address that names it, so what the page calls the gzip's hash really is
 * one; `releaseToFolder` then unpacks the live release for the admin server, which serves it to a browser with the cookie.
 */

export const PROJECT = E2E_PROJECT_ID;
/** The specs run from `e2e/`; the build's folders are named from the repository's root. */
export const REPOSITORY = resolve(import.meta.dirname, '../../../..');
export const START_URL = `${ADMIN_ORIGIN}/start/`;

/** The seeded map of the owner's question: a Fostul Bacău made from nothing. */
export const CITY = {
    nameRo: 'Fostul Bacău',
    nameEn: 'Old Bacău',
    id: 'fostul-bacau',
    west: '26.85',
    south: '46.5',
    east: '26.98',
    north: '46.62',
} as const;

export function startText(locale: Locale, key: StartKey, params?: Readonly<Record<string, string>>): string {
    return translateStart(locale, key, params);
}

export function startPage(page: Page): Locator {
    return page.locator('hcm-start-page');
}

export class FakeHostingUploads {
    readonly #uploads = new Map<string, Uint8Array>();

    /** Answers the upload host at the browser's edge: the bytes stay here, the fake hears only that the hash arrived. */
    async install(context: BrowserContext, api: APIRequestContext, testId: string, refuse: () => boolean = () => false): Promise<void> {
        await context.route('https://upload-firebasehosting.googleapis.com/**', async (route) => {
            const request = route.request();
            if (request.method() === 'OPTIONS') {
                await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
                return;
            }
            if (refuse()) {
                await route.abort('failed');
                return;
            }
            const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
            const url = new URL(request.url());
            const hash = url.pathname.split('/').at(-1) ?? '';
            const real = createHash('sha256').update(bytes).digest('hex');
            this.#uploads.set(real, bytes);
            const answer = await api.fetch(`${MOCK_API_ORIGIN}/h/${url.hostname}${url.pathname}`, {
                method: 'POST',
                headers: {
                    [TEST_HEADER]: testId,
                    authorization: (await request.allHeaders())['authorization'] ?? '',
                    ...(real === hash ? { 'x-hcm-checked': hash } : {}),
                },
                failOnStatusCode: false,
            });
            await route.fulfill({ status: answer.status(), contentType: 'application/json', body: await answer.text() });
        });
    }

    /** Every file of the live release, unpacked into a folder the admin server serves; returns the folder's name and its rules. */
    async releaseToFolder(
        upstream: UpstreamControl,
        folder: string,
    ): Promise<{ readonly files: Readonly<Record<string, string>>; readonly config: unknown }> {
        const snapshot = (await upstream.snapshot('browser'))['firebase-hosting'] as {
            readonly live: Readonly<Record<string, string>>;
            readonly versions: Readonly<Record<string, { readonly files: Readonly<Record<string, string>>; readonly config: unknown }>>;
        };
        const live = snapshot.live[PROJECT] ?? '';
        const version = snapshot.versions[live];
        if (version === undefined) {
            throw new Error(`nothing is released on ${PROJECT}`);
        }
        const root = join(REPOSITORY, E2E_RELEASED_DIR, folder);
        rmSync(root, { recursive: true, force: true });
        const unpacked: Record<string, string> = {};
        for (const [path, hash] of Object.entries(version.files)) {
            const gz = this.#uploads.get(hash);
            if (gz === undefined) {
                throw new Error(`the release names ${path}, whose bytes were never uploaded`);
            }
            const relative = path.replace(/^\//, '');
            const target = join(root, relative);
            mkdirSync(dirname(target), { recursive: true });
            const bytes = gunzipSync(gz);
            writeFileSync(target, bytes);
            unpacked[relative] = bytes.toString('utf8');
        }
        return { files: unpacked, config: version.config };
    }
}

/** What the browser sends so the admin server serves it the release of this test. */
export async function serveReleased(context: BrowserContext, folder: string): Promise<void> {
    await context.addCookies([{ name: 'hcm-e2e-variant', value: `released:${folder}`, url: ADMIN_ORIGIN }]);
}

/** Google's consent page, in this tab: Allow, and back. */
export async function allowConsent(page: Page): Promise<void> {
    await page.waitForURL(/\/__oauth\/authorize/);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/start\//);
}

export async function cancelConsent(page: Page): Promise<void> {
    await page.waitForURL(/\/__oauth\/authorize/);
    await page.locator('#cancel').click();
    await page.waitForURL(/\/start\//);
}

/** The form: the city's names, its id, its rectangle, and the new project's id (the emulators' own project). */
export async function fillPlan(page: Page, lang: Locale, projectId: string = PROJECT): Promise<void> {
    const form = startPage(page);
    await form.getByLabel(startText(lang, 'start.plan.cityName'), { exact: true }).fill(CITY.nameRo);
    await form.getByLabel(startText(lang, 'start.plan.cityNameEn'), { exact: true }).fill(CITY.nameEn);
    await form.getByLabel(startText(lang, 'start.plan.cityId'), { exact: true }).fill(CITY.id);
    await form.getByLabel(startText(lang, 'start.plan.west'), { exact: true }).fill(CITY.west);
    await form.getByLabel(startText(lang, 'start.plan.south'), { exact: true }).fill(CITY.south);
    await form.getByLabel(startText(lang, 'start.plan.east'), { exact: true }).fill(CITY.east);
    await form.getByLabel(startText(lang, 'start.plan.north'), { exact: true }).fill(CITY.north);
    await form.getByLabel(startText(lang, 'start.plan.projectId'), { exact: true }).fill(projectId);
}
