/**
 * What `<hcm-georef-page>` reads of the georeferencer (`packages/admin/src/georef/georef.ts`,
 * `docs/research/M3-interfaces.md` §10.4), mirrored structurally because `@hcm/ui` sits below `@hcm/admin`;
 * `packages/admin/test/app/admin-port.test.ts` checks that the real store satisfies it.
 */
import type { BBox, Gcp, GeorefTransform, LayerVersionState } from '@hcm/shared';

import type { LoadStatusPort, StoreFailurePort } from '../area-port.js';
import type { AdminNoticeInputPort } from '../notice-port.js';
import type { MapStatusPort } from '../imagery/imagery-port.js';

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
    readonly selected: string | null;
    readonly transform: GeorefTransform;
    readonly fit: FitViewPort;
    readonly thresholdM: number;
    readonly dirty: boolean;
    readonly saving: boolean;
    readonly refusal: AdminNoticeInputPort | null;
    readonly saved: string | null;
    readonly showPreview: boolean;
    readonly previewOpacity: number;
    readonly map: MapStatusPort;
    readonly pane: 'scan' | 'map';
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
    setTransform(kind: GeorefTransform): void;
    setReference(kind: ReferenceKindPort): void;
    setPreviewOpacity(percent: number): void;
    togglePreview(show: boolean): void;
    setPane(pane: 'scan' | 'map'): void;
    save(): Promise<boolean>;
    discard(): void;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
}
