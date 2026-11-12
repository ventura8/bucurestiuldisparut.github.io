/**
 * What `<hcm-georef-page>` reads of the georeferencer (`packages/admin/src/georef/georef.ts`,
 * `docs/research/M3-interfaces.md` §10.4), mirrored structurally because `@hcm/ui` sits below `@hcm/admin`;
 * `packages/admin/test/app/admin-port.test.ts` checks that the real store satisfies it.
 */
import type { BBox, Gcp, GeorefTransform, LayerVersionState } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { MapStatusPort } from '../imagery/imagery-port.js';
import type { SuggestionsViewPort } from './suggestions-port.js';

export type ReferenceKindPort = 'osm' | 's2';

export interface PixelPositionPort {
    readonly x: number;
    readonly y: number;
}

interface GeoPositionPort {
    readonly lat: number;
    readonly lng: number;
}

export type HalfPairPort = { readonly pixel: PixelPositionPort } | { readonly geo: GeoPositionPort };

/** What the context menu finds under a point of the map: the place, and the pair drawn within the hit radius. */
interface MapTargetPort {
    readonly geo: GeoPositionPort;
    readonly hit: string | null;
}

/** A point the context menu picked up: its end on `pane` follows the next click there. */
interface MovingPort {
    readonly id: string;
    readonly pane: 'scan' | 'map';
}

export interface GeorefVersionPort {
    readonly id: string;
    readonly layerId: string;
    readonly label: { readonly ro: string; readonly en?: string | undefined };
    readonly state: LayerVersionState;
    readonly scan: { readonly width: number; readonly height: number; readonly previewScale: number; readonly previewPath: string } | null;
    readonly reference: {
        readonly bounds: BBox;
        readonly osmPath: string | null;
        readonly s2Path: string | null;
        readonly s2Date: string | null;
    } | null;
    readonly editable: boolean;
}

interface FitViewPort {
    readonly refusal: 'too-few' | 'degenerate' | null;
    readonly fitRmseM: number | null;
    readonly checkpointRmseM: number | null;
    readonly checkpointCount: number;
    readonly residuals: Readonly<Record<string, number>>;
    readonly missing: Readonly<Record<GeorefTransform, number>>;
    readonly overThreshold: boolean;
    readonly refitted: boolean;
}

type ScanImagePort = { readonly status: 'none' | 'loading' | 'failed' } | { readonly status: 'ready'; readonly url: string };

export interface GeorefViewState {
    readonly versionId: string | null;
    readonly doc: { readonly status: LoadStatusPort; readonly reconnecting: boolean; readonly failure: StoreFailurePort | null };
    readonly notFound: boolean;
    readonly version: GeorefVersionPort | null;
    readonly scan: ScanImagePort;
    readonly reference: ReferenceKindPort | null;
    readonly pairs: readonly Gcp[];
    readonly adding: boolean;
    readonly half: HalfPairPort | null;
    /** The context menu's Move this point: the pair whose end the next click drops (Esc cancels). */
    readonly moving: MovingPort | null;
    readonly selected: string | null;
    readonly transform: GeorefTransform;
    readonly fit: FitViewPort;
    readonly thresholdM: number;
    readonly dirty: boolean;
    /** Undo has a remembered pair edit (up to 50). */
    readonly canUndo: boolean;
    readonly saving: boolean;
    readonly refusal: AdminNoticeInputPort | null;
    readonly saved: string | null;
    readonly showPreview: boolean;
    readonly previewOpacity: number;
    readonly map: MapStatusPort;
    readonly pane: 'scan' | 'map';
    /** M4: the matcher's suggestions still to decide. */
    readonly suggestions: SuggestionsViewPort;
}

export interface GeorefIntentsPort {
    retry(): void;
    setAdding(adding: boolean): void;
    pickScan(pixel: PixelPositionPort): void;
    addAtCentres(pixel: PixelPositionPort): void;
    movePixel(id: string, pixel: PixelPositionPort): void;
    moveGeo(id: string, geo: GeoPositionPort): void;
    select(id: string | null): void;
    remove(id: string): void;
    toggle(id: string): void;
    cancelHalf(): void;
    /** The context menu's Add a point here: Add pairs on, then that end exactly as a click there. */
    addAt(end: HalfPairPort): void;
    /** The context menu's Move this point: the pair's end on `pane` follows the next click there. */
    pickUp(id: string, pane: 'scan' | 'map'): void;
    /** The place and the pair under a point of the map's box (CSS px from its corner); null without a map. */
    mapTarget(point: PixelPositionPort): MapTargetPort | null;
    acceptSuggestion(id: string): void;
    acceptAllSuggestions(): void;
    rejectSuggestion(id: string): void;
    selectSuggestion(id: string | null): void;
    setTransform(kind: GeorefTransform): void;
    setReference(kind: ReferenceKindPort): void;
    setPreviewOpacity(percent: number): void;
    togglePreview(show: boolean): void;
    setPane(pane: 'scan' | 'map'): void;
    save(): Promise<boolean>;
    /** M16: the points placed since the page opened, snapped into a new version of a published or waiting one. */
    snap(): Promise<boolean>;
    discard(): void;
    /** The last change to the pairs taken back (an add, a move, a removal), one step at a time. */
    undo(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    setMapFocus(focused: boolean): void;
    nudgeMap(dx: number, dy: number): void;
}
