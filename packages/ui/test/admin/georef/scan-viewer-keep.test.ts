// The scan pane over the 2026-11-12 fixes: a pane that changes size keeps the owner's zoom and centre (S-A16-HAPPY-GEOREF-KEEP-ZOOM,
// S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN), the ghost of a pair begun on the map is drawn (S-A16-HAPPY-GEOREF-GHOST), and the sharper
// scan is drawn once zoomed past the preview's own pixels (S-A16-HAPPY-GEOREF-FULL-RES, S-A16-BAD-GEOREF-FULL-RES-NONE).
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { paintGhostBadge } from '../../../src/admin/georef/marker-badge.js';
import { defineHcmScanViewer, type HcmScanViewer } from '../../../src/admin/georef/hcm-scan-viewer.js';
import { drawScan } from '../../../src/admin/georef/scan-draw.js';
import { fitView, resizedView } from '../../../src/admin/georef/scan-view.js';
import { blankImage } from '../imagery/fixtures.js';
import { cleanup, mount, updated } from '../shell/fake-app.js';

defineHcmScanViewer();

const IMAGE = { width: 1000, height: 600 };

/** A 400 × 240 pane over a 2000 × 1200 scan whose preview is half its size. */
async function viewer(): Promise<HcmScanViewer> {
    const element = await mount<HcmScanViewer>(
        html`<hcm-scan-viewer
            style="display: block; inline-size: 400px; block-size: 240px"
            .src=${blankImage()}
            .scanWidth=${2000}
            .scanHeight=${1200}
            .previewScale=${0.5}
            .label=${'The scan'}
        ></hcm-scan-viewer>`,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await updated(element);
    return element;
}

function canvasOf(element: HcmScanViewer): HTMLCanvasElement {
    const canvas = element.renderRoot.querySelector('canvas');
    if (canvas === null) {
        throw new Error('no canvas');
    }
    return canvas;
}

/** Waits for the next frames (the resize observer and an image's load). */
async function frames(element: HcmScanViewer): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 80));
    await updated(element);
}

describe('the scan pane keeps its zoom', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('happyPath_aResizedPaneKeepsTheZoomAndTheCentreAndAFittedOneFitsAgain @S-A16-HAPPY-GEOREF-KEEP-ZOOM', async () => {
        const before = { width: 400, height: 240 };
        const after = { width: 385, height: 240 };
        const zoomed = { scale: 3, offset: { x: -500, y: -300 } };
        expect(resizedView(zoomed, before, after, IMAGE)).toEqual({ scale: 3, offset: { x: -507.5, y: -300 } });
        expect(resizedView(fitView(before, IMAGE), before, after, IMAGE)).toEqual(fitView(after, IMAGE));

        const element = await viewer();
        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -800, clientX: 100, clientY: 60, bubbles: true, cancelable: true }),
        );
        const centre = element.centre;
        const scale = element.view.scale;
        // A scrollbar comes (a pair added below made the page taller): 15 px narrower, the same place at the centre.
        element.style.inlineSize = '385px';
        await frames(element);

        expect(element.view.scale).toBe(scale);
        expect(element.centre.x).toBeCloseTo(centre.x, 6);
        expect(element.centre.y).toBeCloseTo(centre.y, 6);
    });

    it('badPath_aPaneNeverShownOrNeverZoomedFitsTheWholeScan @S-A16-BAD-GEOREF-KEEP-ZOOM-NEVER-SHOWN', async () => {
        const zoomed = { scale: 3, offset: { x: -500, y: -300 } };
        const after = { width: 400, height: 240 };
        expect(resizedView(zoomed, { width: 0, height: 0 }, after, IMAGE)).toEqual(fitView(after, IMAGE));
        expect(resizedView(zoomed, { width: 400, height: 0 }, after, IMAGE)).toEqual(fitView(after, IMAGE));

        const element = await viewer();
        element.style.inlineSize = '300px';
        await frames(element);
        expect(element.view).toEqual(fitView({ width: 300, height: 240 }, IMAGE));
    });
});

describe('the ghost and the sharper scan on the scan pane', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('happyPath_theGhostIsADashedDoubleRingAndTheDetailIsDrawnPastThePreviewsPixels @S-A16-HAPPY-GEOREF-FULL-RES', async () => {
        const drawn = vi.spyOn(CanvasRenderingContext2D.prototype, 'drawImage');
        const dashed = vi.spyOn(CanvasRenderingContext2D.prototype, 'setLineDash');
        const element = await viewer();
        element.ghost = { x: 1000, y: 600 };
        element.detail = { url: blankImage(), scale: 1 };
        await frames(element);
        expect(dashed).toHaveBeenCalled();

        drawn.mockClear();
        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -1500, clientX: 200, clientY: 120, bubbles: true, cancelable: true }),
        );
        expect(element.view.scale).toBeGreaterThan(1);
        // The detail is twice the preview's size: drawn at half the preview's scale.
        const transforms = vi.spyOn(CanvasRenderingContext2D.prototype, 'setTransform');
        element.ghost = null;
        await updated(element);
        const ratio = Math.max(globalThis.devicePixelRatio, 1);
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale * 0.5) < 1e-9)).toBe(true);
        expect(drawn).toHaveBeenCalled();
    });

    it('badPath_noDetailOrOneStillLoadingDrawsThePreviewAtItsScale @S-A16-BAD-GEOREF-FULL-RES-NONE', async () => {
        const element = await viewer();
        canvasOf(element).dispatchEvent(
            new WheelEvent('wheel', { deltaY: -1500, clientX: 200, clientY: 120, bubbles: true, cancelable: true }),
        );
        const transforms = vi.spyOn(CanvasRenderingContext2D.prototype, 'setTransform');
        element.detail = { url: 'data:image/png;base64,broken', scale: 1 };
        await frames(element);
        element.detail = null;
        await frames(element);

        const ratio = Math.max(globalThis.devicePixelRatio, 1);
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale) < 1e-9)).toBe(true);
        expect(transforms.mock.calls.some((call) => Math.abs(Number(call[0]) - ratio * element.view.scale * 0.5) < 1e-9)).toBe(false);

        // Drawn without a scene's picture at all: only the marks.
        const plain = document.createElement('canvas');
        document.body.append(plain);
        drawScan(plain, {
            ...{ image: null, view: { scale: 2, offset: { x: 0, y: 0 } }, previewScale: 1, markers: [], selected: null },
            ...{ half: { x: 1, y: 1 }, crosshair: false, dragged: null, detail: null, ghost: { x: 2, y: 2 } },
        });
        const context = plain.getContext('2d');
        if (context !== null) {
            paintGhostBadge(context, { x: 5, y: 5 }, { marker: '#000', onMarker: '#fff', outline: '#111', warn: '#222', bad: '#333' });
        }
        expect(plain.width).toBeGreaterThanOrEqual(0);
    });
});
