/**
 * Draws the georeferencer's scan pane (`./hcm-scan-viewer.ts`): the scan preview at the view's scale and offset, the
 * pairs' numbered markers (shared with the map: `./marker-badge.ts`), the half pair's cross and, while the pane has the
 * keyboard, the crosshair at its centre.
 */
import {
    badgePaletteOf,
    paintBadgeCross,
    paintPairBadge,
    paintSuggestionBadge,
    type BadgeMarker,
    type BadgePalette,
} from './marker-badge.js';
import { scanToPane, type Point, type ScanView } from './scan-view.js';

export interface ScanMarker extends BadgeMarker {
    readonly pixel: Point;
}

export interface ScanScene {
    readonly image: CanvasImageSource | null;
    readonly view: ScanView;
    readonly previewScale: number;
    readonly markers: readonly ScanMarker[];
    readonly selected: string | null;
    readonly half: Point | null;
    readonly crosshair: boolean;
    /** The marker being dragged, at its pointer's place. */
    readonly dragged: ScanMarker | null;
    /** M4: the matcher's suggestions, dashed and hollow, the selected one larger (`docs/research/M4-interfaces.md` §2.5). */
    readonly suggestions?: readonly ScanMarker[];
    readonly selectedSuggestion?: string | null;
}

/** The canvas sized to its box at the device's pixel ratio, cleared; null without a 2D context. */
function sized(canvas: HTMLCanvasElement, ratio: number): CanvasRenderingContext2D | null {
    const width = Math.round(canvas.clientWidth * ratio);
    const height = Math.round(canvas.clientHeight * ratio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (context === null) {
        return null;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    return context;
}

/** The markers as they stand, the dragged one at its pointer. */
function placed(scene: ScanScene): readonly ScanMarker[] {
    const dragged = scene.dragged;
    return dragged === null ? scene.markers : scene.markers.map((item) => (item.id === dragged.id ? dragged : item));
}

/** The scan preview at the view's scale and offset. */
function image(context: CanvasRenderingContext2D, scene: ScanScene, ratio: number): void {
    if (scene.image === null) {
        return;
    }
    const { scale, offset } = scene.view;
    context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * offset.x, ratio * offset.y);
    context.drawImage(scene.image, 0, 0);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

/** The suggestions (dashed, under) and the pairs (over them), the dragged one at its pointer. */
function markers(context: CanvasRenderingContext2D, scene: ScanScene, palette: BadgePalette): void {
    for (const item of scene.suggestions ?? []) {
        paintSuggestionBadge(context, scanToPane(scene.view, item.pixel, scene.previewScale), item, {
            selected: item.id === scene.selectedSuggestion,
            palette,
        });
    }
    for (const item of placed(scene)) {
        paintPairBadge(context, scanToPane(scene.view, item.pixel, scene.previewScale), item, {
            selected: item.id === scene.selected,
            palette,
        });
    }
}

export function drawScan(canvas: HTMLCanvasElement, scene: ScanScene): void {
    const ratio = Math.max(globalThis.devicePixelRatio, 1);
    const context = sized(canvas, ratio);
    if (context === null) {
        return;
    }
    const palette = badgePaletteOf(canvas);
    image(context, scene, ratio);
    markers(context, scene, palette);
    if (scene.half !== null) {
        paintBadgeCross(context, scanToPane(scene.view, scene.half, scene.previewScale), palette.marker);
    }
    if (scene.crosshair) {
        paintBadgeCross(context, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, palette.outline);
    }
}
