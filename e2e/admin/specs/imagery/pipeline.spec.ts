import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { DEFAULT_RMSE_THRESHOLD_M } from '@hcm/shared';

import { FUNCTIONS_TIMEOUT_MS } from '../../support/emulators.js';
import { ADMIN_LOCK, adminPath, expect, test } from '../../support/test.js';
import { PUBLISH_TIMEOUT_MS } from './layer.js';
import {
    awaitHarvest,
    cardImport,
    closeImportNotice,
    expectLayerInViewer,
    publishedLayer,
    readyImagery,
    stepRow,
    stepStateText,
    versionIdOf,
} from './world.js';

// One admin test at a time: the import runs in the server's upstream world and reads setup/status.
test.describe.configure({ lock: ADMIN_LOCK });

/**
 * The real raster pipeline in the admin's world (docs/research/M3-interfaces.md §5, §13; CR-M3-16): the 1966 frame
 * imported with Import on its card is run by `python -m hcm_pipeline run` of the quality image's pipeline venv (the
 * image the pipeline ships on), against the Firestore and Storage emulators and the mock APIs' USGS, STAC and Overpass,
 * which answer a synthetic scene of known georeference (`pipeline/tests/synthetic/scenes.py`, generated into the test's
 * folder, never committed). It downloads and unpacks the delivery, stitches its segments, guesses the corners against
 * Sentinel-2, matches automatic points, warps and exports; the policy publishes the version under the city's threshold,
 * and the viewer shows the layer and fades it with its opacity slider.
 */
test.use({ persona: 'owner', mapOwner: 'owner' });

const SCENE = 'DS1035-1057DA023';
const REPO_ROOT = resolve(import.meta.dirname, '../../../..');
/** The raster pipeline's interpreter in the quality image (docs/research/M0-handoff.md). */
const PIPELINE_PYTHON = '/opt/hcm/pipeline-venv/bin/python';

type Corners = Readonly<Record<'nw' | 'ne' | 'se' | 'sw', { readonly lat: number; readonly lng: number }>>;

/**
 * The synthetic frame's centre, and the city the pipeline's own tests use around it (5 km by 4 km in Web Mercator:
 * `city_bounds` of `pipeline/tests/fakes/world.py`), which the frame covers: the corner guess needs the city's window on
 * the frame.
 */
const FRAME_CENTRE = { lat: 44.43, lng: 26.1 } as const;
const FRAME_CITY = { west: 26.077542, south: 44.417169, east: 26.122458, north: 44.442828 } as const;

/**
 * Writes the synthetic scene into `dir` (the folder the mock APIs then answer from); its corners as USGS's metadata would
 * list them (`truth.json`: deliberately a few hundred metres off, as real metadata is).
 */
function generateScene(dir: string): Corners {
    const result = spawnSync(PIPELINE_PYTHON, ['pipeline/tests/synthetic/scenes.py', '--out', dir, '--seed', '7'], {
        cwd: REPO_ROOT,
        env: { ...process.env, PYTHONPATH: resolve(REPO_ROOT, 'pipeline/src') },
        encoding: 'utf8',
        timeout: 120_000,
    });
    expect(result.status, `scenes.py: ${result.stderr}`).toBe(0);
    return (JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8')) as { corners: Corners }).corners;
}

test(
    'The real raster pipeline imports a free scene, the policy publishes it, and the viewer shows it',
    { tag: '@S-P01-HAPPY-ADMIN' },
    async ({ page, lang, adminWorld, mockApiRequest, upstream }, testInfo) => {
        test.setTimeout(600_000);
        const fixtures = { emulators: adminWorld.emulators, api: mockApiRequest, upstream };
        const imagery = await readyImagery(fixtures, adminWorld.accounts.owner.uid, {}, { published: true });
        const dir = testInfo.outputPath('synthetic');
        const corners = generateScene(dir);
        await imagery.useSyntheticScene(relative(REPO_ROOT, dir));
        await imagery.script({ runner: 'python', attempts: [{ outcome: 'under' }] });
        await page.goto(adminPath(lang, 'imagery'));
        await awaitHarvest(page, lang);
        // The harvested 1966 frame takes the synthetic frame's corners (where the corner guess starts), and the city the
        // synthetic world's size.
        await adminWorld.emulators.updateFields(`cities/${imagery.city}/usgsScenes/${SCENE}`, { corners }, ['corners']);
        await adminWorld.emulators.updateFields(`cities/${imagery.city}`, { bounds: FRAME_CITY }, ['bounds']);

        // One click: Import on the scene's card; every step of the pipeline runs for real.
        await cardImport(page, lang, SCENE).click();
        await expect(page).toHaveURL(/#\/imagery\/version\//, { timeout: FUNCTIONS_TIMEOUT_MS });
        await closeImportNotice(page, lang);
        const versionId = versionIdOf(page);
        for (const step of ['fetch', 'extract', 'stitch', 'locate', 'georef', 'warp', 'export'] as const) {
            await expect(stepRow(page, lang, step)).toContainText(stepStateText(lang, 'done'), { timeout: FUNCTIONS_TIMEOUT_MS * 2 });
        }

        // Its checkpoints agree under the city's threshold: the policy approved it, and it was published.
        const layer = await publishedLayer(imagery, versionId, PUBLISH_TIMEOUT_MS);
        const version = await imagery.version(versionId);
        const georef = (version?.['georef'] ?? {}) as { method?: string; checkpointRmseM?: number };
        expect(georef.method).toBe('auto');
        expect(Number(georef.checkpointRmseM)).toBeLessThan(DEFAULT_RMSE_THRESHOLD_M);
        expect(version?.['approval']).toMatchObject({ auto: true, by: 'system:imagery' });
        expect((await imagery.runs()).map((run) => run.outcome)).toEqual([]);
        await expectLayerInViewer(page, lang, imagery, layer, FRAME_CENTRE);
    },
);
