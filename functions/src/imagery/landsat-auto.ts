/**
 * M25 (`docs/research/M25-landsat.md` §4): `imagery.tick`'s Landsat part. For a city that leaves `imagery.landsatAuto` on (the default),
 * the best harvested Landsat scene of each year from `landsatFrom` to `landsatTo` (1984 to 2000 by default) is imported on its own,
 * oldest year first, at most `LANDSAT_AUTO_PER_TICK` a tick. A year already holding a Landsat import is done; a scene is a candidate
 * only when it is free, holds the city, its cloud is recorded and at most `LANDSAT_AUTO_MAX_CLOUD`, and nobody rejected it; among a
 * year's candidates the highest rank wins (the season counts in it), then the clearer one. Each import is an ordinary
 * `usgs-import` (`startImport`): the budget guard and the daily cap refuse it as any other (the scene waits for a later tick), and
 * USGS must have approved downloads.
 */
import {
    CITY_MIN_COVERAGE_PCT,
    FIRESTORE_PATHS,
    LANDSAT_AUTO_MAX_CLOUD,
    LANDSAT_AUTO_PER_TICK,
    cityDocSchema,
    imagerySettingsOf,
    isLandsatDataset,
    landsatYearsOf,
    usgsSceneDocSchema,
    yearOfDate,
    type UsgsSceneDoc,
} from '@hcm/shared';

import type { Ports } from '../ports/index.js';
import { startImport } from './import.js';
import { refuseNewRasterJob } from './limits.js';
import { IMAGERY_WRITER, usgsRecord } from './records.js';
import { usgsDownloads, usgsSearchable } from './usgs-session.js';

export type LandsatAutoDeps = Pick<Ports, 'documents' | 'clock' | 'log' | 'setup'>;

/** A scene that holds the city under few enough clouds (an unrecorded cover is never clear enough). */
function clearOverCity(scene: UsgsSceneDoc): boolean {
    return scene.coverage * 100 >= CITY_MIN_COVERAGE_PCT && (scene.cloudCover ?? Number.POSITIVE_INFINITY) <= LANDSAT_AUTO_MAX_CLOUD;
}

/** True for a Landsat scene the tick may import: free, over the city, clear enough, never rejected or imported. */
function candidate(scene: UsgsSceneDoc): boolean {
    return isLandsatDataset(scene.dataset) && scene.status === 'candidate' && scene.downloadAvailable && clearOverCity(scene);
}

function cloudOf(scene: UsgsSceneDoc): number {
    return scene.cloudCover ?? 0;
}

/** The better of two scenes of a year: the higher rank, then the clearer, then the earlier entity id (a stable choice). */
function better(left: UsgsSceneDoc, right: UsgsSceneDoc): UsgsSceneDoc {
    const order = right.rank.score - left.rank.score || cloudOf(left) - cloudOf(right) || left.entityId.localeCompare(right.entityId);
    return order <= 0 ? left : right;
}

/** The years that already hold a Landsat import (any state: one per year is the default). */
function importedYears(scenes: readonly UsgsSceneDoc[]): ReadonlySet<number> {
    return new Set(
        scenes
            .filter((scene) => isLandsatDataset(scene.dataset) && scene.status === 'imported')
            .map((scene) => yearOfDate(scene.acquisitionDate)),
    );
}

/** The scene to import for each wanted year that has none yet, oldest year first. */
export function landsatPicks(scenes: readonly UsgsSceneDoc[], years: readonly number[]): UsgsSceneDoc[] {
    const done = importedYears(scenes);
    const best = new Map<number, UsgsSceneDoc>();
    for (const scene of scenes.filter(candidate)) {
        const year = yearOfDate(scene.acquisitionDate);
        const kept = best.get(year);
        best.set(year, kept === undefined ? scene : better(kept, scene));
    }
    return years.filter((year) => !done.has(year)).flatMap((year) => best.get(year) ?? []);
}

/** True when USGS is set up with downloads approved; else the part waits (nothing to say: the Setup card says it). */
async function downloadsApproved(deps: LandsatAutoDeps): Promise<boolean> {
    const record = await usgsRecord(deps.setup);
    return usgsSearchable(record) && usgsDownloads(record);
}

/** The scenes this tick imports for the city: none when it turned the switch off, or USGS cannot download. */
async function picksFor(deps: LandsatAutoDeps, cityId: string): Promise<UsgsSceneDoc[]> {
    const city = await deps.documents.get(FIRESTORE_PATHS.city(cityId), cityDocSchema);
    const settings = imagerySettingsOf(city?.imagery);
    if (city === undefined || !settings.landsatAuto || !(await downloadsApproved(deps))) {
        return [];
    }
    const scenes = await deps.documents.query(FIRESTORE_PATHS.usgsScenes(cityId), usgsSceneDocSchema);
    return landsatPicks(
        scenes.documents.map((scene) => scene.data),
        landsatYearsOf(settings),
    ).slice(0, LANDSAT_AUTO_PER_TICK);
}

/** One import, or false when the guard or today's cap refuses it (it waits for a later tick). */
async function importOne(deps: LandsatAutoDeps, cityId: string, scene: UsgsSceneDoc, now: Date): Promise<boolean> {
    try {
        await refuseNewRasterJob(deps.documents, now, cityId);
    } catch (error) {
        deps.log.info('a landsat import waits', { cityId, entityId: scene.entityId, reason: String(error) });
        return false;
    }
    const { jobId, layerId } = await startImport(deps, { cityId, scene, createdBy: IMAGERY_WRITER, now });
    deps.log.info('landsat scene imported on its own', { cityId, entityId: scene.entityId, jobId, layerId });
    return true;
}

/** `imagery.tick`'s `landsat` part. */
export async function importLandsat(deps: LandsatAutoDeps, cityId: string, now: Date): Promise<void> {
    for (const scene of await picksFor(deps, cityId)) {
        if (!(await importOne(deps, cityId, scene, now))) {
            return;
        }
    }
}
