/**
 * The georeferencer's suggestions (`docs/research/M4-interfaces.md` §2.5; behaviour A44): the pairs the automatic
 * matching was less sure of (`layerVersion.suggestions`, best first), each labelled `a1`, `a2`, … in that order on both
 * panes and in the list. Accept moves one into the pairs (`acceptSuggestions` of `@hcm/shared`: enabled, origin `auto`,
 * a free id, the same scan pixel never twice), Accept all moves every one still pending, Reject hides one for the page
 * visit; a suggestion already among the pairs is not pending. Each pending one says how far the page's current fit puts
 * it (`offsetM`, computed again on every change of the pairs: the matcher's own `residualM` was against its fit of the
 * moment, and a version waiting for points had none). Nothing here writes: the accepted pairs are the page's unsaved
 * pairs until Save (`imagery.saveGcps`). Pure: the store keeps the rejected ids and the selection.
 *
 * None rather than bad ones (2026-11-13): a suggestion whose pixel lies outside the scan (made for an older scan) is never
 * pending, and once the page has a fit, neither is one further than `FAR_FROM_FIT_M` from it (the owner's own points say it
 * is wrong). The version's `reference` (the published layer the pairs were found on) is passed on so the panel says
 * "from the 1911 map".
 */
import {
    acceptSuggestions,
    AUTO_GCP_MIN_CONFIDENCE,
    AUTO_GCP_SUGGEST_MIN,
    distanceFromFit,
    pendingSuggestions,
    type FittedTransform,
    type Gcp,
    type LayerVersionDoc,
} from '@hcm/shared';

/** Beyond this many ground metres from the page's fit a suggestion is not offered: an old map's own distortion stays well under it. */
export const FAR_FROM_FIT_M = 300;

/** How sure the matching was, in words: from `AUTO_GCP_MIN_CONFIDENCE` high, from halfway down to the floor medium. */
export type ConfidenceLevel = 'high' | 'medium' | 'low';

const MEDIUM_FROM = (AUTO_GCP_SUGGEST_MIN + AUTO_GCP_MIN_CONFIDENCE) / 2;

export function confidenceLevel(score: number): ConfidenceLevel {
    if (score >= AUTO_GCP_MIN_CONFIDENCE) {
        return 'high';
    }
    return score >= MEDIUM_FROM ? 'medium' : 'low';
}

/** One suggestion as the panel and the panes show it. */
export interface SuggestionRow {
    /** `a1`, `a2`, … by its place in the version's list (it keeps its label while others are decided). */
    readonly label: string;
    readonly pair: Gcp;
    readonly level: ConfidenceLevel;
    /** Ground metres between its place and where the page's current fit puts its pixel; null without a fit. */
    readonly offsetM: number | null;
}

/** What the version holds: its suggestions and, when it waits for points, how many confident pairs the matching found. */
export interface VersionSuggestions {
    /** The matcher ran on the version (it has a suggestions record) or it waits for points after matching too few. */
    readonly matched: boolean;
    readonly all: readonly Gcp[];
    /** `noMatch {pairs}` (or `noSpread {pairs}`) of a version that waits for points, else null. */
    readonly confident: string | null;
    /** The version waits because its confident pairs lie almost in a line (`noSpread`), not because they are too few. */
    readonly noSpread: boolean;
    /** The year of the published map the pairs were found on, or null (today's streets). */
    readonly fromYear: number | null;
    /** The published layer the pairs were found on, or null. */
    readonly fromLayer: string | null;
}

const NO_VERSION_SUGGESTIONS: VersionSuggestions = {
    matched: false,
    all: [],
    confident: null,
    noSpread: false,
    fromYear: null,
    fromLayer: null,
};

/** Why a version the matcher ran on waits for points: too few confident pairs, or enough that lie almost in a line. */
const WAITING_CODES: readonly string[] = ['apiError.imagery.noMatch', 'apiError.imagery.noSpread'];

/**
 * The version waits for points after the matching (`noMatch`, `noSpread`): a USGS import, the only kind the matcher runs
 * on (an upload without a georeference waits with `noMatch {pairs: 0}` too, though nothing was matched).
 */
function waitsAfterMatching(doc: LayerVersionDoc): boolean {
    return doc.origin === 'usgs' && doc.state === 'needs_gcps' && WAITING_CODES.includes(doc.error?.code ?? '');
}

/** The confident pairs' count a version waiting for points was left with (null otherwise). */
function confidentOf(doc: LayerVersionDoc): string | null {
    return waitsAfterMatching(doc) ? (doc.error?.params?.['pairs'] ?? '0') : null;
}

/** A version waiting for points says its confident pairs lie almost in a line. */
function waitsForSpread(doc: LayerVersionDoc): boolean {
    return waitsAfterMatching(doc) && doc.error?.code === 'apiError.imagery.noSpread';
}

/** The pair's pixel lies on the scan the version has now (always true when its size is unknown). */
function onScan(doc: LayerVersionDoc, pair: Gcp): boolean {
    const scan = doc.scan;
    return scan === undefined || (pair.pixel.x >= 0 && pair.pixel.y >= 0 && pair.pixel.x < scan.width && pair.pixel.y < scan.height);
}

/** The published map the suggestions were found on: its year and layer, or nulls (today's streets). */
function foundOn(doc: LayerVersionDoc): Pick<VersionSuggestions, 'fromYear' | 'fromLayer'> {
    const reference = doc.suggestions?.reference;
    return reference === undefined ? { fromYear: null, fromLayer: null } : { fromYear: reference.year, fromLayer: reference.layerId };
}

export function versionSuggestions(doc: LayerVersionDoc): VersionSuggestions {
    const confident = confidentOf(doc);
    const all = (doc.suggestions?.pairs ?? []).filter((pair) => onScan(doc, pair));
    return { matched: doc.suggestions !== undefined || confident !== null, all, confident, noSpread: waitsForSpread(doc), ...foundOn(doc) };
}

/** The panel's view: the pending suggestions, the selected one, and what the version says about its matching. */
export interface SuggestionsView {
    readonly matched: boolean;
    readonly total: number;
    readonly pending: readonly SuggestionRow[];
    readonly selected: string | null;
    readonly confident: string | null;
    readonly noSpread: boolean;
    readonly fromYear: number | null;
}

export const NO_SUGGESTIONS: SuggestionsView = {
    matched: false,
    total: 0,
    pending: [],
    selected: null,
    confident: null,
    noSpread: false,
    fromYear: null,
};

/** A row the page's fit says is wrong: further from it than `FAR_FROM_FIT_M`. */
function farFromFit(row: SuggestionRow): boolean {
    return row.offsetM !== null && row.offsetM > FAR_FROM_FIT_M;
}

/** Suggestion `pair`, the `index`th of the version's list, as a row: its label, its confidence, its distance from `fit`. */
function rowOf(pair: Gcp, index: number, fit: FittedTransform | null): SuggestionRow {
    const offsetM = fit === null ? null : distanceFromFit(fit, pair);
    return { label: `a${String(index + 1)}`, pair, level: confidenceLevel(pair.score ?? 0), offsetM };
}

/** The page's state a view is made for: its pairs, its current fit or null when none is possible yet, the rejected ids. */
export interface SuggestionsPage {
    readonly pairs: readonly Gcp[];
    readonly fit: FittedTransform | null;
    readonly rejected: ReadonlySet<string>;
    readonly selected: string | null;
}

/** The rows still to decide, each with its label and its distance from the current fit. */
export function suggestionsView(source: VersionSuggestions, page: SuggestionsPage): SuggestionsView {
    const { pairs, fit, rejected, selected } = page;
    // An accepted suggestion moved since (a manual pair now) keeps its id: it is decided, not pending again.
    const placed = new Set(pairs.map((pair) => pair.id));
    const open = new Set(pendingSuggestions(source.all, pairs, rejected).map((pair) => pair.id));
    const rows = source.all.flatMap((pair, index) => (open.has(pair.id) && !placed.has(pair.id) ? [rowOf(pair, index, fit)] : []));
    const pending = rows.filter((row) => !farFromFit(row));
    const kept = pending.some((row) => row.pair.id === selected) ? selected : null;
    const { matched, confident, noSpread, fromYear } = source;
    return { matched, total: source.all.length, pending, selected: kept, confident, noSpread, fromYear };
}

/**
 * The store's side of the suggestions for one page visit: the version's list, the ids rejected on this page and the
 * selected suggestion (the panes follow it). Accepting returns the pairs to refit; the store keeps them.
 */
export class Suggestions {
    #source: VersionSuggestions = NO_VERSION_SUGGESTIONS;
    #rejected = new Set<string>();
    #selected: string | null = null;

    /** A new snapshot of the version (the rejected ones stay rejected). */
    load(doc: LayerVersionDoc): void {
        this.#source = versionSuggestions(doc);
    }

    /** The page closed: nothing is rejected or selected any more. */
    reset(): void {
        this.#source = NO_VERSION_SUGGESTIONS;
        this.#rejected = new Set();
        this.#selected = null;
    }

    /** The published layer the version's suggestions were found on (the picture the page shows beside the scan), or null. */
    get fromLayer(): string | null {
        return this.#source.fromLayer;
    }

    /** The panel's view for the page's pairs and its current fit. */
    view(pairs: readonly Gcp[], fit: FittedTransform | null): SuggestionsView {
        return suggestionsView(this.#source, { pairs, fit, rejected: this.#rejected, selected: this.#selected });
    }

    /** The pairs with suggestion `id` accepted (or every pending one, without an id). */
    accepted(pairs: readonly Gcp[], id?: string): readonly Gcp[] {
        const pending = this.view(pairs, null).pending.map((row) => row.pair);
        return acceptSuggestions(pairs, pending, id === undefined ? undefined : [id]);
    }

    reject(id: string): void {
        this.#rejected.add(id);
    }

    select(id: string | null): void {
        this.#selected = id;
    }
}
