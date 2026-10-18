import { expect, test } from '../../support/content-test.js';
import { contentText, seedCity, seedJob, seedLogLine } from '../../support/ops.js';

/**
 * A job's live log when the connection drops (docs/research/M2c-interfaces.md §9.3; behaviour A18), in a city of the admin's
 * own: Firestore's listen channel is cut for a while (its requests fail as a dropped connection would), the page says it is
 * reconnecting, a line the pipeline writes meanwhile arrives once the channel is back, and no line shows twice.
 */

const AT = new Date('2026-10-17T09:00:00.000Z');

/** Firestore's listen channel of the emulator (WebChannel): what a dropped connection cuts. */
const LISTEN = /\/google\.firestore\.v1\.Firestore\/Listen\/channel/;

test(
    'A dropped listener says it is reconnecting and resumes without a line twice',
    { tag: ['@S-A18-BAD-STREAM-DROP'] },
    async ({ page, lang, content, consoleErrors }) => {
        test.setTimeout(150_000);
        await seedCity(content, AT);
        await seedJob(
            content,
            'scan-1',
            {
                type: 'usgs-import',
                status: 'running',
                createdBy: content.uid,
                progress: 0.4,
                step: 'fetch',
                steps: { fetch: { status: 'running' } },
            },
            AT,
        );
        await seedLogLine(content, 'scan-1', 1, 'Fetching the scene', AT);
        await page.goto(content.address(lang, 'jobs/scan-1', { map: false }));
        await expect(page.getByText('Fetching the scene')).toHaveCount(1);

        // The connection drops: every listen request fails; the page says it is reconnecting.
        await page.route(LISTEN, (route) => route.abort('connectionreset'));
        await expect(
            page
                .getByRole('status')
                .filter({ hasText: contentText(lang, 'adminContent.common.reconnecting') })
                .first(),
        ).toBeVisible({
            timeout: 60_000,
        });
        await seedLogLine(content, 'scan-1', 2, 'Downloading 812 MB', AT);

        // Back: the line written meanwhile shows, and every line once.
        await page.unroute(LISTEN);
        await expect(page.getByText('Downloading 812 MB')).toHaveCount(1, { timeout: 60_000 });
        await expect(page.getByText('Fetching the scene')).toHaveCount(1);
        await expect(page.getByRole('status').filter({ hasText: contentText(lang, 'adminContent.common.reconnecting') })).toHaveCount(0);
        // The cut requests are logged, and so is Firestore's network probe (an image of www.google.com) that the admin's CSP
        // refuses: it loads no third-party image.
        expect(consoleErrors.takeMatching(/ERR_CONNECTION_RESET|Listen\/channel|cleardot\.gif/).length).toBeGreaterThan(0);
    },
);
