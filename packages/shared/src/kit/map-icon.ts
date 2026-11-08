/**
 * The map's tab icon (the owner, 2026-11-08: "the map icon we use in Layers as the default browser tab icon"): the
 * Material Symbols Rounded `map` glyph the Layers panel draws beside each historical layer, white on a rounded square of
 * the city's seed colour, so it reads on a light and a dark tab strip alike.
 *
 * - `MAP_GLYPH_PATH` is the glyph's outline as HarfBuzz draws it from the kit's own subset
 *   (`packages/ui/fonts/material-symbols-rounded.woff2`: `FILL` 0, `wght` 400, `opsz` 24; 960 units to the em, y up).
 *   `packages/ui/scripts/build-fonts.mjs --check` (the static stage's font gate) reads the committed font and refuses
 *   a path that is no longer the font's. Material Symbols: Apache License 2.0, Copyright Google LLC
 *   (`packages/ui/fonts/LICENSES.md`).
 * - `mapIconSvg` is our own SVG text, never a user's: the functions render it to PNG with sharp (a city's default icon).
 * - `DEFAULT_FAVICON_DATA_URL` is that icon at 32 px in the project's default colour, inlined by every page the build
 *   writes (the city sites without a bucket, `/city/` before its city's own loads, the admin, the start page, 404) and by
 *   the starter kit; every page's policy allows `data:` images. `functions/test/cities/map-icon.test.ts` renders the
 *   SVG again and compares the pixels.
 *
 * A city's own icon lives in the public bucket at fixed names (`STORAGE_PATHS.cityIcon`), at `CITY_ICON_SIZES`;
 * `cities.setIcon` writes it (`docs/research/M2-interfaces.md` → *The city's tab icon*).
 */

/** The `map` glyph of Material Symbols Rounded (y up, 960 units to the em, the glyph within 120…840). */
export const MAP_GLYPH_PATH =
    'M574,129L360,204L174,132Q164,128 154.5,129.5Q145,131 137,136Q129,141 124.5,149.5Q120,158 120,169L120,730Q120,743 127.5,753' +
    'Q135,763 148,768L334,831Q340,833 346.5,834Q353,835 360,835Q367,835 373.5,834Q380,833 386,831L600,756L786,828Q796,832 805.5,830.5' +
    'Q815,829 823,824Q831,819 835.5,810.5Q840,802 840,791L840,230Q840,217 832.5,207Q825,197 812,192L626,129Q620,127 613.5,126' +
    'Q607,125 600,125Q593,125 586.5,126Q580,127 574,129ZM560,218L560,686L400,742L400,274L560,218ZM640,218L760,258L760,732L640,686' +
    'L640,218ZM200,228L320,274L320,742L200,702L200,228ZM640,686L640,686L640,218L640,218L640,686ZM320,742L320,742L320,274L320,274' +
    'L320,742Z';

/** The project's default seed colour (`sites/bucharest/site.json` → `themeColor`, the kit's `theme-color`). */
export const DEFAULT_ICON_COLOR = '#8B5E3C';

/** The sizes a city's icon is stored at: the tab (32), the home screen (180, `apple-touch-icon`), the master (512). */
export const CITY_ICON_SIZES = [32, 180, 512] as const;
export type CityIconSize = (typeof CITY_ICON_SIZES)[number];

/** What `cities.setIcon` accepts: PNG or WebP only (never SVG), square enough, large enough, at most 1 MB. */
export const CITY_ICON_LIMITS = {
    maxBytes: 1_000_000,
    /** The request's base64 text: 4 characters per 3 bytes, rounded up. */
    maxBase64Chars: 1_333_336,
    minSide: 192,
    maxSide: 4096,
    /** The long side over the short one. */
    maxRatio: 1.25,
    contentTypes: ['image/png', 'image/webp'],
} as const;

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

/** The em of the glyph's font. */
const EM = 960;
/** The square's corner radius, about 22 % of its side. */
const RADIUS = 211;
/** The glyph spans 720 units; at this scale it fills about 62 % of the square. */
const GLYPH_SCALE = 0.8267;

/** The icon as SVG text: a rounded square of `seedColor` with the glyph in white. Throws on anything but `#RRGGBB`. */
/** An icon's side: a whole number of pixels from 16 to 1024. */
function iconSide(size: number): boolean {
    return Number.isInteger(size) && size >= 16 && size <= 1024;
}

export function mapIconSvg(seedColor: string, size = 512): string {
    if (!HEX_COLOR.test(seedColor) || !iconSide(size)) {
        throw new RangeError(`not an icon colour and size: ${JSON.stringify(seedColor)}, ${String(size)}`);
    }
    const [half, scale] = [String(EM / 2), String(GLYPH_SCALE)];
    const glyph = `translate(${half} ${half}) scale(${scale} -${scale}) translate(-${half} -${half})`;
    return [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${String(size)}" height="${String(size)}" viewBox="0 0 ${String(EM)} ${String(EM)}">`,
        `<rect width="${String(EM)}" height="${String(EM)}" rx="${String(RADIUS)}" fill="${seedColor}"/>`,
        `<path transform="${glyph}" fill="#FFFFFF" d="${MAP_GLYPH_PATH}"/>`,
        '</svg>',
    ].join('');
}

/** The default icon at 32 px in `DEFAULT_ICON_COLOR`, a PNG (rendered by sharp from `mapIconSvg`; the functions' test checks it). */
export const DEFAULT_FAVICON_DATA_URL =
    'data:image/png;base64,' +
    'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACTUlEQVRYw+1XTWsTQRje36D+lYK4G+vNU6tHi9ltxYMU' +
    '9WYQPKit1EN2g1AIWEypFNoeWj/x4xBF0dIQqg1FIbdEtGJpl7SbhNo2bt/OM7XrpG5CY9JdkH1gGJiv99mZ2XmeV5IEGF3tR6Ka3Kdr8kdWl3RNoVYUrBVV' +
    'lQ+6Kt+8rbYdltxghJXTbMBqq4LWLCxGVA2dcgmu2Ace3CGh2A4JbLsnX773WFR5hR8HzsXr4H/uhnJDYhdkzjcC7GJK+73tI9c0mnk8Ql+zGfr8/gU9iEUo' +
    'du5E3Tnjt3ppLjlFz+/219oBS6q3wPDVszT9MEHmQp7csFZcpczrRzQxcJH07hCfE7/UQW8n4mR+/+KMK6+YNWPUJDD/5slfAX+WLV5XNtapsrlR1WeZi5Sb' +
    'T5H9q+JKtGECmAQsL+To3eQQJSJnKHnf4G0/clkavHCSXt4boPynNG3ZdlXAUmGJUk9H6dXoneYJTBlXnDaRgDg2frmTCovfeF/62RgZPcd5O+Z6QgAFbQDG' +
    '7LYFBAICAYGAwP9FAM8rnlkAzy6eX08IQFAgLBAYERAgCBEECcIkEoBwQcAgZE0TEAGpheRCekVAmiHRomSLgLQ3TAAmYhcwFzAZMBu8n5kPmBCYETeifA4z' +
    'MTAzMDX1TA8zpUrRrQM2CnYKtqreArBlsGewabBrsG2wb/vNEfw3pX7acrb71yUkB34kJqwUYuePHuLZEdIkr1MzQzvWWZUfggTSJS++XA/LHa4ZMo4D6dJO' +
    'Ku3+d/xjCmaxehZrO9v+G9tIuMRFoT7ILgAAAABJRU5ErkJggg==';
