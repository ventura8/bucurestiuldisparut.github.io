/**
 * The rank of a harvested USGS scene (`docs/research/M3-interfaces.md` §3.3): a 0–100 score from six parts, each 0 to 1
 * and weighted by `RANKING_WEIGHTS` (free 30, coverage 25, target year 15, new year 10, cloud 10, resolution 10), and
 * the plain-word reasons the admin reads (`adminContent.imagery.reason.*`): those that explain a low rank first, then the
 * largest contributions. Shared, so the
 * harvest (functions) stores it and the admin re-ranks live when a filter or a layer changes.
 */
import { RANKING_VERSION, RANKING_WEIGHTS, type RankReason, type RankReasonEntry, type UsgsSceneDoc } from '../schemas/usgs-scene.js';

/** What a rank reads of a scene. */
export type RankedScene = Pick<UsgsSceneDoc, 'downloadAvailable' | 'coverage' | 'acquisitionDate' | 'cloudCover' | 'resolutionM'>;

export interface RankContext {
    /** The city's target years (`cities/{city}.imagery.targetYears`). */
    readonly targetYears: readonly number[];
    /** The years of the city's layers and unfinished layer versions (the scene's own import left out by the caller). */
    readonly layerYears: readonly number[];
}

type Part = keyof typeof RANKING_WEIGHTS;

/** One part of the score: its value (0 to 1) and the reason that explains it, when it has one. */
interface Scored {
    readonly part: Part;
    readonly value: number;
    readonly reason?: RankReasonEntry;
    /** Listed whatever its contribution (`needsOrder`, `sameYear`, a coverage under half): it explains a low rank. */
    readonly always?: boolean;
}

/** A target year counts as near when the frame is this many years from it. */
const NEAR_TARGET_YEARS = 1;
/** The new-year part reaches 1 this many years away from the nearest layer. */
const NEW_YEAR_SPAN = 10;
/** Cloud cover at which the cloud part reaches 0, in percent. */
const CLOUDY_PERCENT = 50;

function reason(code: RankReason, params?: Readonly<Record<string, string>>): RankReasonEntry {
    return params === undefined ? { code } : { code, params };
}

function yearOf(scene: RankedScene): number {
    return Number(scene.acquisitionDate.slice(0, 4));
}

/** The smallest distance in years from `year` to one of `years`, and that year; undefined for none. */
function nearest(year: number, years: readonly number[]): { readonly year: number; readonly distance: number } | undefined {
    return years
        .map((candidate) => ({ year: candidate, distance: Math.abs(candidate - year) }))
        .reduce<{ readonly year: number; readonly distance: number } | undefined>(
            (best, candidate) => (best === undefined || candidate.distance < best.distance ? candidate : best),
            undefined,
        );
}

function free(scene: RankedScene): Scored {
    return scene.downloadAvailable
        ? { part: 'free', value: 1, reason: reason('free') }
        : { part: 'free', value: 0, reason: reason('needsOrder'), always: true };
}

function coverage(scene: RankedScene): Scored {
    const percent = String(Math.round(scene.coverage * 100));
    return { part: 'coverage', value: scene.coverage, reason: reason('coverage', { percent }), always: scene.coverage < 0.5 };
}

function targetYear(scene: RankedScene, context: RankContext): Scored {
    const found = nearest(yearOf(scene), context.targetYears);
    if (found?.distance === 0) {
        return { part: 'targetYear', value: 1, reason: reason('targetYear', { year: String(found.year) }) };
    }
    if (found !== undefined && found.distance <= NEAR_TARGET_YEARS) {
        return { part: 'targetYear', value: 0.5, reason: reason('nearTargetYear', { year: String(found.year) }) };
    }
    return { part: 'targetYear', value: 0 };
}

function newYear(scene: RankedScene, context: RankContext): Scored {
    const found = nearest(yearOf(scene), context.layerYears);
    if (found === undefined) {
        return { part: 'newYear', value: 1, reason: reason('noLayers') };
    }
    if (found.distance === 0) {
        return { part: 'newYear', value: 0, reason: reason('sameYear', { year: String(found.year) }), always: true };
    }
    return {
        part: 'newYear',
        value: Math.min(1, found.distance / NEW_YEAR_SPAN),
        reason: reason('newYear', { years: String(found.distance) }),
    };
}

function cloud(scene: RankedScene): Scored {
    if (scene.cloudCover === undefined) {
        return { part: 'cloud', value: 0.5, reason: reason('cloudUnknown') };
    }
    const value = Math.max(0, 1 - scene.cloudCover / CLOUDY_PERCENT);
    return { part: 'cloud', value, reason: reason('cloud', { percent: String(Math.round(scene.cloudCover)) }) };
}

function resolution(scene: RankedScene): Scored {
    const value = Math.min(1, Math.max(0.2, 1 - (scene.resolutionM - 1) / 8));
    return { part: 'resolution', value, reason: reason('resolution', { metres: scene.resolutionM.toFixed(1) }) };
}

function contribution(scored: Scored): number {
    return RANKING_WEIGHTS[scored.part] * scored.value;
}

/**
 * The reasons worth reading: every part that adds to the score, and those that explain a low one. The ones that explain
 * a low rank come first (a card shows only its first three: "there is already a layer from 1966" must not be the fourth),
 * then the largest contributions.
 */
function reasonsOf(parts: readonly Scored[]): RankReasonEntry[] {
    return parts
        .filter((scored) => scored.reason !== undefined && (contribution(scored) > 0 || scored.always === true))
        .sort((left, right) => Number(right.always === true) - Number(left.always === true) || contribution(right) - contribution(left))
        .flatMap((scored) => (scored.reason === undefined ? [] : [scored.reason]));
}

/** The scene's rank: the rounded weighted score, the reasons in order, and the ranking's version. */
export function rankScene(scene: RankedScene, context: RankContext): UsgsSceneDoc['rank'] {
    const parts = [free(scene), coverage(scene), targetYear(scene, context), newYear(scene, context), cloud(scene), resolution(scene)];
    const score = Math.round(parts.reduce((sum, scored) => sum + contribution(scored), 0));
    return { score: Math.min(100, Math.max(0, score)), reasons: reasonsOf(parts), version: RANKING_VERSION };
}
