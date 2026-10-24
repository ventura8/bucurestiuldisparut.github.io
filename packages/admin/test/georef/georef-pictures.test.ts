import { fitTransform, type FittedTransform } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { GeorefPictures, REFERENCE_PICTURE, referenceOf, WARP_DELAY_MS, WARPED_PICTURE } from '../../src/georef/georef-pictures.js';
import type { GeorefVersion, ScanImage } from '../../src/georef/state.js';
import { PictureOverlays } from '../../src/imagery/overlay.js';
import { FakeClock, settle } from '../app/fakes.js';
import { mapboxHandle } from '../imagery/maps.js';
import { FakeFiles, FakePictures } from '../imagery/world.js';
import { pair } from './fixtures.js';

const SCAN = { width: 1000, height: 500, previewScale: 0.5, previewPath: 'v/scan-preview.jpg' };
const REFERENCE = {
    bounds: [
        [26, 44.4],
        [26.2, 44.5],
    ] as const,
    osmPath: 'v/reference-osm.png',
    s2Path: 'v/reference-s2.jpg',
    s2Date: '2025-08-03',
};

function version(overrides: Partial<GeorefVersion> = {}): GeorefVersion {
    return {
        id: 'v1',
        layerId: 'l',
        label: { ro: 'Scan' },
        state: 'needs_gcps',
        scan: SCAN,
        reference: REFERENCE,
        crop: null,
        editable: true,
        ...overrides,
    };
}

function fitted(): FittedTransform {
    const result = fitTransform('affine', [pair('g1', 0, 0), pair('g2', 1000, 0), pair('g3', 1000, 500), pair('g4', 0, 500)]);
    if (!result.ok) {
        throw new Error(result.reason);
    }
    return result.transform;
}

async function setup(pictures: FakePictures | null = new FakePictures()) {
    const { handle, native } = await mapboxHandle();
    const files = new FakeFiles();
    const clock = new FakeClock();
    const scans: ScanImage[] = [];
    const overlays = new PictureOverlays(() => handle.port);
    const shown = new GeorefPictures({ files, pictures, clock, overlays, scan: (image) => scans.push(image) });
    for (const path of [SCAN.previewPath, REFERENCE.osmPath, REFERENCE.s2Path]) {
        files.put(path);
    }
    return { shown, files, clock, scans, overlays, native, pictures };
}

describe('the references a version offers', () => {
    it('happyPath_theOneAskedForElseOpenStreetMapElseSentinel2ElseNone', () => {
        expect(referenceOf(version(), null)?.kind).toBe('osm');
        expect(referenceOf(version(), 's2')).toMatchObject({ kind: 's2', path: REFERENCE.s2Path });
        expect(referenceOf(version({ reference: { ...REFERENCE, osmPath: null } }), 'osm')?.kind).toBe('s2');
        expect(referenceOf(version({ reference: { ...REFERENCE, osmPath: null, s2Path: null } }), null)).toBeNull();
        expect(referenceOf(version({ reference: null }), 'osm')).toBeNull();
    });
});

describe('the georeferencer pictures', () => {
    it('happyPath_theScanThenTheReferenceThenTheWarpedPreviewOncePerFrame', async () => {
        const { shown, clock, scans, overlays, native, pictures } = await setup();

        shown.load(version(), null);
        shown.load(version(), null);
        await settle();
        shown.warp(fitted(), SCAN, 0.6);
        shown.warp(fitted(), SCAN, 0.7);
        clock.advance(WARP_DELAY_MS);
        shown.warp(fitted(), SCAN, 0.7);
        clock.advance(WARP_DELAY_MS);
        shown.setOpacity(0.3);

        expect(scans).toEqual([{ status: 'loading' }, { status: 'ready', url: `blob:${SCAN.previewPath}` }]);
        expect(shown.reference).toBe('osm');
        expect([overlays.has(REFERENCE_PICTURE), overlays.has(WARPED_PICTURE)]).toEqual([true, true]);
        expect(pictures?.drawn).toHaveLength(2);
        expect(pictures?.drawn[0]?.target).toBe(pictures?.drawn[1]?.target);
        expect(native.paint.get('hcm-picture-layer-warped')?.['raster-opacity']).toBeCloseTo(0.3, 9);
    });

    it('happyPath_switchingTheReferenceAndARefusedFitTakeThePreviewOff', async () => {
        const { shown, clock, overlays, native } = await setup();
        shown.load(version(), null);
        await settle();

        shown.load(version(), 's2');
        await settle();
        shown.warp(null, SCAN, 1);
        clock.advance(WARP_DELAY_MS);

        expect(shown.reference).toBe('s2');
        expect(native.sources.get('hcm-picture-reference')).toBeDefined();
        shown.load(version({ reference: null }), 's2');
        await settle();
        expect([shown.reference, overlays.has(REFERENCE_PICTURE)]).toEqual([null, false]);
        expect(overlays.has(WARPED_PICTURE)).toBe(false);
    });

    it('badPath_noScanNoReadableScanOrNoDecoderShowsNoPreview', async () => {
        const blind = await setup(null);
        blind.shown.load(version(), null);
        await settle();
        blind.shown.warp(fitted(), SCAN, 1);
        blind.clock.advance(WARP_DELAY_MS);
        const scanless = await setup();
        scanless.shown.load(version({ id: 'v2', scan: null, reference: null }), null);
        const missing = await setup();
        missing.files.objects.delete(SCAN.previewPath);
        missing.shown.load(version(), null);
        await settle();

        const unreadable = await setup();
        unreadable.files.objects.delete(REFERENCE.osmPath);
        unreadable.shown.load(version(), null);
        await settle();

        expect(unreadable.overlays.has(REFERENCE_PICTURE)).toBe(false);
        expect(blind.overlays.has(WARPED_PICTURE)).toBe(false);
        expect(scanless.scans).toEqual([{ status: 'none' }]);
        expect(missing.scans.at(-1)).toEqual({ status: 'failed' });
    });

    it('happyPath_clearingReleasesTheScanAndDropsALateOne', async () => {
        const { shown, files, clock, scans } = await setup();
        shown.load(version(), null);
        await settle();
        shown.warp(fitted(), SCAN, 1);

        shown.clear();
        clock.advance(WARP_DELAY_MS);
        files.hold = true;
        shown.load(version({ id: 'v3' }), null);
        await settle();
        shown.clear();
        files.hold = false;
        files.flush();
        await settle();

        expect(files.released).toEqual([`blob:${SCAN.previewPath}`, `blob:${SCAN.previewPath}`]);
        expect(scans.at(-1)).toEqual({ status: 'none' });
    });
});
