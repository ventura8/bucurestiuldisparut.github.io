/**
 * The georeferencer's state and intents (`docs/research/M3-interfaces.md` §10.4): the version it opens (its scan, its
 * reference, whether it takes points), the pairs being edited and the half pair, the transform and its fit, the city's
 * threshold, Save, the reference shown, the warped preview, the map and, on compact windows, which pane shows.
 */
import {
    bboxFromRecord,
    imagerySettingsOf,
    type BBox,
    type CropRing,
    type Gcp,
    type GeorefTransform,
    type LayerVersionDoc,
    type LayerVersionState,
} from '@hcm/shared';

import type { DocState } from '../content/doc.js';
import type { MapStatus } from '../layers/map-session.js';
import type { NoticeInput } from '../state/state.js';
import type { FitView } from './fit-view.js';
import type { GeoPosition, HalfPair, PixelPosition } from './pairs.js';
import { NO_SUGGESTIONS, type SuggestionsView } from './suggestions.js';

export type ReferenceKind = 'osm' | 's2';

/** The states in which a version takes new points (`imagery.saveGcps`): it waits for them, or it has a render. */
const EDITABLE_STATES: readonly LayerVersionState[] = ['needs_gcps', 'awaiting_approval', 'published'];

export interface GeorefVersion {
    readonly id: string;
    readonly layerId: string;
    readonly label: LayerVersionDoc['label'];
    readonly state: LayerVersionState;
    readonly scan: { readonly width: number; readonly height: number; readonly previewScale: number; readonly previewPath: string } | null;
    readonly reference: {
        readonly bounds: BBox;
        readonly osmPath: string | null;
        readonly s2Path: string | null;
        readonly s2Date: string | null;
    } | null;
    readonly crop: CropRing | null;
    readonly editable: boolean;
}

function referenceOf(reference: LayerVersionDoc['reference']): GeorefVersion['reference'] {
    if (reference === undefined) {
        return null;
    }
    const { osmPath = null, s2Path = null, s2Date = null } = reference;
    return { bounds: bboxFromRecord(reference.bounds), osmPath, s2Path, s2Date };
}

function scanOf(scan: LayerVersionDoc['scan']): GeorefVersion['scan'] {
    return scan === undefined
        ? null
        : { width: scan.width, height: scan.height, previewScale: scan.previewScale, previewPath: scan.previewPath };
}

export function georefVersionOf(id: string, version: LayerVersionDoc): GeorefVersion {
    return {
        ...{ id, layerId: version.layerId, label: version.label, state: version.state, scan: scanOf(version.scan) },
        ...{ reference: referenceOf(version.reference), crop: version.crop ?? null, editable: EDITABLE_STATES.includes(version.state) },
    };
}

export type ScanImage = { readonly status: 'none' | 'loading' | 'failed' } | { readonly status: 'ready'; readonly url: string };

export interface GeorefState {
    readonly versionId: string | null;
    readonly doc: Omit<DocState<never>, 'doc'>;
    /** Read, and no such version. */
    readonly notFound: boolean;
    readonly version: GeorefVersion | null;
    /** The scan preview for the scan pane (a `blob:` address). */
    readonly scan: ScanImage;
    /** The reference shown on the map (null: the version has none). */
    readonly reference: ReferenceKind | null;
    readonly pairs: readonly Gcp[];
    /** "Add pairs" is on: a click on the scan or the map is one end of the next pair. */
    readonly adding: boolean;
    readonly half: HalfPair | null;
    readonly selected: string | null;
    readonly transform: GeorefTransform;
    readonly fit: FitView;
    readonly thresholdM: number;
    /** The pairs or the transform differ from the version's. */
    readonly dirty: boolean;
    readonly saving: boolean;
    readonly refusal: NoticeInput | null;
    /** The version Save started or continued (the page opens it). */
    readonly saved: string | null;
    readonly showPreview: boolean;
    /** The warped preview's opacity, 0 to 1. */
    readonly previewOpacity: number;
    readonly map: MapStatus;
    /** On compact windows, the pane shown: the scan or the map. */
    readonly pane: 'scan' | 'map';
    /** The matcher's suggestions still to decide (M4 §2.5). */
    readonly suggestions: SuggestionsView;
}

const EMPTY_FIT: FitView = {
    ...{ refusal: 'too-few', fitRmseM: null, checkpointRmseM: null, checkpointCount: 0, residuals: {} },
    ...{ missing: { affine: 3, poly2: 6, tps: 10 }, overThreshold: false },
};

export const INITIAL_GEOREF: GeorefState = {
    ...{ versionId: null, doc: { status: 'loading', reconnecting: false, failure: null }, notFound: false, version: null },
    ...{ scan: { status: 'none' }, reference: null, pairs: [], adding: false, half: null, selected: null, transform: 'affine' },
    ...{ fit: EMPTY_FIT, thresholdM: imagerySettingsOf(undefined).rmseThresholdM, dirty: false, saving: false, refusal: null },
    ...{ saved: null, showPreview: true, previewOpacity: 0.7, map: 'none', pane: 'scan', suggestions: NO_SUGGESTIONS },
};

export interface GeorefIntents {
    retry(): void;
    /** "Add pairs": on, each pair is a click on the scan and one on the map (either first); off, the points move. */
    setAdding(adding: boolean): void;
    /** A click on the scan, in full-resolution scan pixels. */
    pickScan(pixel: PixelPosition): void;
    /** The keyboard's way: a pair at the scan's crosshair and the map's centre. */
    addAtCentres(pixel: PixelPosition): void;
    movePixel(id: string, pixel: PixelPosition): void;
    moveGeo(id: string, geo: GeoPosition): void;
    select(id: string | null): void;
    remove(id: string): void;
    /** Enabled ↔ checkpoint. */
    toggle(id: string): void;
    /** Esc: the half pair is dropped. */
    cancelHalf(): void;
    /** Accept: the suggestion joins the pairs (enabled, `auto`); saved only with Save. */
    acceptSuggestion(id: string): void;
    /** Accept all: every suggestion still to decide joins the pairs. */
    acceptAllSuggestions(): void;
    /** Reject: the suggestion is hidden for this visit of the page. */
    rejectSuggestion(id: string): void;
    /** The suggestion the panes show larger (null: none). */
    selectSuggestion(id: string | null): void;
    setTransform(kind: GeorefTransform): void;
    setReference(kind: ReferenceKind): void;
    setPreviewOpacity(percent: number): void;
    togglePreview(show: boolean): void;
    setPane(pane: 'scan' | 'map'): void;
    /** `imagery.saveGcps`: true when the job was queued (the page opens the version). */
    save(): Promise<boolean>;
    discard(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
}
