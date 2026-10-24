import { describe, expect, it } from 'vitest';

import { browserPictures, type CanvasLike, type Context2d, type PictureScope } from '../../src/imagery/pictures.js';

interface Recorded {
    readonly canvases: CanvasLike[];
    readonly calls: string[];
}

function scope(options: { readonly fail?: boolean; readonly noContext?: boolean } = {}): PictureScope & Recorded {
    const canvases: CanvasLike[] = [];
    const calls: string[] = [];
    const context = new Proxy({} as Context2d, {
        get:
            (_target, name: string) =>
            (...args: unknown[]) => {
                calls.push(`${name}(${args.map((arg) => (typeof arg === 'number' ? String(arg) : 'image')).join(',')})`);
            },
    });
    return {
        canvases,
        calls,
        createImageBitmap: (blob) =>
            options.fail === true
                ? Promise.reject(new Error(`not an image: ${blob.type}`))
                : Promise.resolve({ width: 8000, height: 4000, close: () => calls.push('close') }),
        document: {
            createElement: () => {
                const canvas = { width: 0, height: 0, getContext: () => (options.noContext === true ? null : context) };
                canvases.push(canvas);
                return canvas;
            },
        },
    };
}

describe('pictures drawn in a canvas', () => {
    it('happyPath_aBlobIsDecodedIntoACanvasAtMostMaxSideLong', async () => {
        const page = scope();

        const picture = await browserPictures(page).decode(new Blob(['x'], { type: 'image/jpeg' }), 2000);

        expect(picture).toMatchObject({ width: 2000, height: 1000 });
        expect(page.calls).toEqual(['drawImage(image,0,0,2000,1000)', 'close']);
    });

    it('badPath_aBlobThatIsNoImageIsNone', async () => {
        await expect(browserPictures(scope({ fail: true })).decode(new Blob(['x']), 2000)).resolves.toBeNull();
    });

    it('happyPath_theWarpClearsThenDrawsEachTriangleClipped', () => {
        const page = scope();
        const pictures = browserPictures(page);
        const target = pictures.blank(100.4, 0.2);
        const source = pictures.blank(10, 10);

        pictures.draw(target, source, [
            {
                clip: [
                    [0, 0],
                    [10, 0],
                    [0, 10],
                ],
                transform: [2, 0, 0, 2, 5, 5],
            },
        ]);

        expect([target.width, target.height]).toEqual([100, 1]);
        expect(page.calls).toEqual([
            'setTransform(1,0,0,1,0,0)',
            'clearRect(0,0,100,1)',
            'save()',
            'beginPath()',
            'moveTo(0,0)',
            'lineTo(10,0)',
            'lineTo(0,10)',
            'closePath()',
            'clip()',
            'setTransform(2,0,0,2,5,5)',
            'drawImage(image,0,0)',
            'restore()',
        ]);
    });

    it('badPath_aCanvasWithoutAContextDrawsNothing', async () => {
        const page = scope({ noContext: true });
        const pictures = browserPictures(page);

        pictures.draw(pictures.blank(10, 10), pictures.blank(10, 10), [
            {
                clip: [
                    [0, 0],
                    [1, 0],
                    [0, 1],
                ],
                transform: [1, 0, 0, 1, 0, 0],
            },
        ]);
        const decoded = await pictures.decode(new Blob(['x']), 100);

        expect(page.calls).toEqual(['close']);
        expect(decoded).toMatchObject({ width: 100, height: 50 });
    });
});
