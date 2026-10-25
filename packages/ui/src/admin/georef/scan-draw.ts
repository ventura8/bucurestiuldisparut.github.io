/**
 * Draws the georeferencer's scan pane (`./hcm-scan-viewer.ts`): the scan preview at the view's scale and offset, the
 * pairs' numbered markers (filled while used for the fit, hollow as checkpoints, the selected one larger with a ring),
 * the half pair's cross and, while the pane has the keyboard, the crosshair at its centre. Colours are the theme's
 * (`--md-sys-color-*`), so the markers keep their contrast in light, dark and high contrast.
 */
import { scanToPane, type Point, type ScanView } from './scan-view.js';

export interface ScanMarker {
    readonly id: string;
    /** What the marker says (`1`, `2`, … in the table's order). */
    readonly label: string;
    readonly pixel: Point;
    readonly enabled: boolean;
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

interface Colours {
    readonly marker: string;
    readonly onMarker: string;
    readonly outline: string;
}

const RADIUS = 11;
const SELECTED_RADIUS = 15;
const CROSS = 12;
const DASH: readonly number[] = [4, 3];

function colours(canvas: HTMLCanvasElement): Colours {
    const style = getComputedStyle(canvas);
    const token = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return {
        marker: token('--md-sys-color-tertiary', '#7d5260'),
        onMarker: token('--md-sys-color-on-tertiary', '#ffffff'),
        outline: token('--md-sys-color-on-surface', '#1d1b20'),
    };
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

/** A marker's look: filled while used for the fit, hollow as a checkpoint. */
function inks(item: ScanMarker, palette: Colours): { readonly fill: string; readonly stroke: string; readonly text: string } {
    return item.enabled
        ? { fill: palette.marker, stroke: palette.onMarker, text: palette.onMarker }
        : { fill: 'transparent', stroke: palette.marker, text: palette.outline };
}

function marker(context: CanvasRenderingContext2D, scene: ScanScene, item: ScanMarker, palette: Colours): void {
    const at = scanToPane(scene.view, item.pixel, scene.previewScale);
    const selected = item.id === scene.selected;
    const ink = inks(item, palette);
    context.beginPath();
    context.arc(at.x, at.y, selected ? SELECTED_RADIUS : RADIUS, 0, Math.PI * 2);
    context.fillStyle = ink.fill;
    context.fill();
    context.lineWidth = selected ? 3 : 2;
    context.strokeStyle = ink.stroke;
    context.stroke();
    context.fillStyle = ink.text;
    context.font = '600 12px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(item.label, at.x, at.y);
}

/** A suggestion: a dashed ring in the outline colour with its label (`a1`), larger when it is selected. */
function suggestion(context: CanvasRenderingContext2D, scene: ScanScene, item: ScanMarker, palette: Colours): void {
    const at = scanToPane(scene.view, item.pixel, scene.previewScale);
    const selected = item.id === scene.selectedSuggestion;
    context.beginPath();
    context.arc(at.x, at.y, selected ? SELECTED_RADIUS : RADIUS, 0, Math.PI * 2);
    context.setLineDash([...DASH]);
    context.lineWidth = selected ? 3 : 2;
    context.strokeStyle = palette.outline;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = palette.outline;
    context.font = '600 11px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(item.label, at.x, at.y);
}

function cross(context: CanvasRenderingContext2D, at: Point, colour: string): void {
    context.beginPath();
    context.moveTo(at.x - CROSS, at.y);
    context.lineTo(at.x + CROSS, at.y);
    context.moveTo(at.x, at.y - CROSS);
    context.lineTo(at.x, at.y + CROSS);
    context.lineWidth = 2;
    context.strokeStyle = colour;
    context.stroke();
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
function markers(context: CanvasRenderingContext2D, scene: ScanScene, palette: Colours): void {
    for (const item of scene.suggestions ?? []) {
        suggestion(context, scene, item, palette);
    }
    for (const item of placed(scene)) {
        marker(context, scene, item, palette);
    }
}

export function drawScan(canvas: HTMLCanvasElement, scene: ScanScene): void {
    const ratio = Math.max(globalThis.devicePixelRatio, 1);
    const context = sized(canvas, ratio);
    if (context === null) {
        return;
    }
    const palette = colours(canvas);
    image(context, scene, ratio);
    markers(context, scene, palette);
    if (scene.half !== null) {
        cross(context, scanToPane(scene.view, scene.half, scene.previewScale), palette.marker);
    }
    if (scene.crosshair) {
        cross(context, { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, palette.outline);
    }
}
