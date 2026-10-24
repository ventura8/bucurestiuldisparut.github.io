/**
 * `PicturePort` over the page (`./files.ts`): `createImageBitmap` decodes a blob (no CSP source is needed for it), a
 * canvas holds the picture at most `maxSide` pixels long, and the warped preview is drawn triangle by triangle, each
 * clipped and mapped with `setTransform`. The scope is injected (`globalThis` in the entry), so the node tests drive it
 * with a recording fake.
 */
import type { Picture, PicturePort, PictureTriangle } from './files.js';

/** What the adapter draws with (`CanvasRenderingContext2D`, structurally). */
export interface Context2d {
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
    clearRect(x: number, y: number, width: number, height: number): void;
    save(): void;
    restore(): void;
    beginPath(): void;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    closePath(): void;
    clip(): void;
    drawImage(image: object, x: number, y: number, width?: number, height?: number): void;
}

export interface CanvasLike {
    width: number;
    height: number;
    getContext(kind: '2d'): Context2d | null;
}

interface Bitmap {
    readonly width: number;
    readonly height: number;
    close(): void;
}

export interface PictureScope {
    createImageBitmap(blob: Blob): Promise<Bitmap>;
    readonly document: { createElement(tag: 'canvas'): CanvasLike };
}

function canvasOf(scope: PictureScope, width: number, height: number): CanvasLike {
    const canvas = scope.document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
}

function pictureOf(canvas: CanvasLike): Picture {
    return { canvas, width: canvas.width, height: canvas.height };
}

async function decode(scope: PictureScope, blob: Blob, maxSide: number): Promise<Picture | null> {
    let bitmap: Bitmap;
    try {
        bitmap = await scope.createImageBitmap(blob);
    } catch {
        return null;
    }
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = canvasOf(scope, bitmap.width * scale, bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return pictureOf(canvas);
}

function drawTriangle(context: Context2d, source: Picture, triangle: PictureTriangle): void {
    const [first, second, third] = triangle.clip;
    context.save();
    context.beginPath();
    context.moveTo(...first);
    context.lineTo(...second);
    context.lineTo(...third);
    context.closePath();
    context.clip();
    context.setTransform(...triangle.transform);
    context.drawImage(source.canvas, 0, 0);
    context.restore();
}

function draw(target: Picture, source: Picture, triangles: readonly PictureTriangle[]): void {
    const context = (target.canvas as CanvasLike).getContext('2d');
    if (context === null) {
        return;
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, target.width, target.height);
    for (const triangle of triangles) {
        drawTriangle(context, source, triangle);
    }
}

export function browserPictures(scope: PictureScope): PicturePort {
    return {
        decode: (blob, maxSide) => decode(scope, blob, maxSide),
        blank: (width, height) => pictureOf(canvasOf(scope, width, height)),
        draw,
    };
}
