/**
 * Georeferencer page intents wired from the store's private actions (`docs/research/M3-interfaces.md` §10.4).
 */
import { clamp, type Gcp, type GeorefTransform, type LayerVersionDoc } from '@hcm/shared';

import type { LiveDoc } from '../content/doc.js';
import type { Store } from '../state/store.js';
import type { GeorefMap } from './georef-map.js';
import type { GeorefPictures } from './georef-pictures.js';
import type { PairHistory } from './history.js';
import { moveGeo, togglePair, withoutPair, type GeoPosition, type PixelPosition } from './pairs.js';
import type { PersistBase } from './persist.js';
import type { GeorefIntents, GeorefState, ReferenceKind } from './state.js';
import type { Suggestions } from './suggestions.js';

/** Collaborators and actions the store exposes to build its intents object. */
export interface GeorefIntentActions {
    readonly cell: Store<GeorefState>;
    readonly map: GeorefMap;
    readonly pictures: GeorefPictures;
    readonly history: PairHistory;
    readonly doc: LiveDoc<LayerVersionDoc>;
    readonly suggestions: Suggestions;
    base(): PersistBase;
    edit(pairs: readonly Gcp[], remember?: boolean): void;
    refit(pairs: readonly Gcp[], transform: GeorefTransform): void;
    pickScan(pixel: PixelPosition): void;
    pickMap(geo: GeoPosition): void;
    addAtCentres(pixel: PixelPosition): void;
    movePixel(id: string, pixel: PixelPosition): void;
    select(id: string | null): void;
    escape(): void;
    setReference(kind: ReferenceKind): void;
    warp(): void;
    showSuggestions(): void;
    save(): Promise<boolean>;
    snap(): Promise<boolean>;
}

function suggestionIntents(
    actions: GeorefIntentActions,
): Pick<GeorefIntents, 'acceptSuggestion' | 'acceptAllSuggestions' | 'rejectSuggestion' | 'selectSuggestion'> {
    const pairs = (): GeorefState['pairs'] => actions.cell.state.pairs;
    return {
        acceptSuggestion: (id) => {
            actions.edit(actions.suggestions.accepted(pairs(), id));
        },
        acceptAllSuggestions: () => {
            actions.edit(actions.suggestions.accepted(pairs()));
        },
        rejectSuggestion: (id) => {
            actions.suggestions.reject(id);
            actions.showSuggestions();
        },
        selectSuggestion: (id) => {
            actions.suggestions.select(id);
            actions.showSuggestions();
        },
    };
}

/** The context menu's: Add a point here (Add pairs turned on first, as a click there) and Move this point. */
function menuIntents(actions: GeorefIntentActions): Pick<GeorefIntents, 'addAt' | 'pickUp' | 'mapTarget'> {
    return {
        addAt: (end) => {
            if (!actions.cell.state.adding) {
                actions.cell.update({ adding: true, half: null });
                actions.map.setAdding(true);
            }
            if ('pixel' in end) {
                actions.pickScan(end.pixel);
            } else {
                actions.pickMap(end.geo);
            }
        },
        pickUp: (id, pane) => {
            actions.cell.update({ moving: { id, pane } });
            // The map's points stand still while one waits for its place (a click there is the drop).
            actions.map.setAdding(true);
        },
        mapTarget: (point) => actions.map.targetAt(point),
    };
}

function pairIntents(
    actions: GeorefIntentActions,
): Pick<
    GeorefIntents,
    'setAdding' | 'pickScan' | 'addAtCentres' | 'movePixel' | 'moveGeo' | 'select' | 'remove' | 'toggle' | 'cancelHalf'
> {
    const pairs = (): GeorefState['pairs'] => actions.cell.state.pairs;
    return {
        setAdding: (adding) => {
            actions.cell.update({ adding, half: null });
            actions.map.setAdding(adding);
        },
        pickScan: (pixel) => {
            actions.pickScan(pixel);
        },
        addAtCentres: (pixel) => {
            actions.addAtCentres(pixel);
        },
        movePixel: (id, pixel) => {
            actions.movePixel(id, pixel);
        },
        moveGeo: (id, geo: GeoPosition) => {
            actions.edit(moveGeo(pairs(), id, geo));
        },
        select: (id) => {
            actions.select(id);
        },
        remove: (id) => {
            actions.edit(withoutPair(pairs(), id));
        },
        toggle: (id) => {
            actions.edit(togglePair(pairs(), id));
        },
        cancelHalf: () => {
            actions.escape();
        },
    };
}

type PageIntent = Exclude<
    keyof GeorefIntents,
    | 'acceptSuggestion'
    | 'acceptAllSuggestions'
    | 'rejectSuggestion'
    | 'selectSuggestion'
    | 'setAdding'
    | 'pickScan'
    | 'addAtCentres'
    | 'movePixel'
    | 'moveGeo'
    | 'select'
    | 'remove'
    | 'toggle'
    | 'cancelHalf'
    | 'addAt'
    | 'pickUp'
    | 'mapTarget'
>;

function pageIntents(actions: GeorefIntentActions): Pick<GeorefIntents, PageIntent> {
    return {
        retry: () => {
            actions.doc.retry();
        },
        setTransform: (kind) => {
            actions.refit(actions.cell.state.pairs, kind);
        },
        setReference: (kind) => {
            actions.setReference(kind);
        },
        setPreviewOpacity: (percent) => {
            const previewOpacity = clamp(Math.round(percent), 0, 100) / 100;
            actions.cell.update({ previewOpacity });
            actions.pictures.setOpacity(previewOpacity);
        },
        togglePreview: (show) => {
            actions.cell.update({ showPreview: show });
            actions.warp();
        },
        setPane: (pane) => {
            actions.cell.update({ pane });
        },
        save: () => actions.save(),
        snap: () => actions.snap(),
        discard: () => {
            const base = actions.base();
            actions.history.clear();
            actions.refit(base.pairs, base.transform);
        },
        undo: () => {
            const previous = actions.history.pop();
            if (previous !== null) {
                actions.edit(previous, false);
            }
        },
        attachMap: (container) => {
            actions.map.attach(container);
        },
        zoomBy: (delta) => {
            actions.map.zoomBy(delta);
        },
        setMapFocus: (focused) => {
            actions.map.setCrosshair(focused);
        },
        nudgeMap: (dx, dy) => actions.map.nudgeSelected(dx, dy),
    };
}

/** All page intents from the store's actions. */
export function georefIntentsOf(actions: GeorefIntentActions): GeorefIntents {
    return { ...pairIntents(actions), ...menuIntents(actions), ...suggestionIntents(actions), ...pageIntents(actions) };
}
