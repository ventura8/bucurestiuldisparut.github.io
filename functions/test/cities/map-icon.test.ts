/**
 * The default tab icon of `@hcm/shared` (`packages/shared/src/kit/map-icon.ts`): `mapIconSvg` refuses anything but a
 * `#RRGGBB` colour and an icon's size, and the 32 px PNG every page inlines (`DEFAULT_FAVICON_DATA_URL`) is the SVG as
 * the functions' sharp draws it, pixel for pixel, so the pages and a city's default never differ.
 */
import { DEFAULT_FAVICON_DATA_URL, DEFAULT_ICON_COLOR, MAP_GLYPH_PATH, mapIconSvg } from '@hcm/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { createSharpImageProcessor } from '../../src/adapters/image.js';

async function pixels(png: Uint8Array): Promise<{ readonly data: number[]; readonly width: number }> {
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: Array.from(data), width: info.width };
}

describe('mapIconSvg', () => {
    it('happyPath_aSquareOfTheColourWithTheGlyphInWhite', () => {
        const svg = mapIconSvg('#336699', 64);

        expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64" viewBox="0 0 960 960">/);
        expect(svg).toContain('fill="#336699"');
        expect(svg).toContain(`fill="#FFFFFF" d="${MAP_GLYPH_PATH}"`);
        expect(svg.endsWith('</svg>')).toBe(true);
    });

    it.each([
        ['a colour name', 'brown', 512],
        ['markup', '#8B5E3C"/><script>', 512],
        ['a short colour', '#abc', 512],
        ['a size too small', '#8B5E3C', 8],
        ['a size that is no whole number', '#8B5E3C', 31.5],
    ])('badPath_%s_isRefused', (_name, colour, size) => {
        expect(() => mapIconSvg(colour, size)).toThrow(RangeError);
    });
});

describe('DEFAULT_FAVICON_DATA_URL', () => {
    it('happyPath_isTheDefaultIconAt32PixelsAsSharpDrawsIt', async () => {
        const committed = new Uint8Array(Buffer.from(DEFAULT_FAVICON_DATA_URL.replace('data:image/png;base64,', ''), 'base64'));
        const drawn = await createSharpImageProcessor().iconPng({ ownSvg: mapIconSvg(DEFAULT_ICON_COLOR) }, 32);

        const [want, got] = await Promise.all([pixels(drawn), pixels(committed)]);
        expect(got.width).toBe(32);
        const off = got.data.filter((value, index) => Math.abs(value - (want.data[index] ?? -999)) > 2);
        expect(off).toEqual([]);
    });
});
