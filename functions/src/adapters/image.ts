import { PHOTO_LIMITS, type PhotoContentType } from '@hcm/shared';
import sharp from 'sharp';

import { UpstreamError } from '../ports/errors.js';
import type { ImageInspection, ImageProcessor } from '../ports/image-processor.js';
import { readExif } from './image-exif.js';

type Sniffer = (bytes: Uint8Array) => boolean;

function startsWith(bytes: Uint8Array, at: number, expected: readonly number[] | string): boolean {
    const wanted = typeof expected === 'string' ? Array.from(expected, (char) => char.charCodeAt(0)) : expected;
    return wanted.every((byte, index) => bytes[at + index] === byte);
}

/** The ISO base media brand of a HEIF file (`ftyp` box at offset 4, major brand at 8). */
function brandIn(bytes: Uint8Array, brands: readonly string[]): boolean {
    return startsWith(bytes, 4, 'ftyp') && brands.some((brand) => startsWith(bytes, 8, brand));
}

/**
 * The accepted photo types by their magic numbers (security review §1.5: never the client's content type or the file
 * name). SVG, PDF, AVIF, GIF and everything else match none and are refused.
 */
const SNIFFERS: readonly (readonly [PhotoContentType, Sniffer])[] = [
    ['image/jpeg', (bytes) => startsWith(bytes, 0, [0xff, 0xd8, 0xff])],
    ['image/png', (bytes) => startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
    ['image/webp', (bytes) => startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')],
    ['image/tiff', (bytes) => startsWith(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])],
    ['image/heic', (bytes) => brandIn(bytes, ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'])],
    ['image/heif', (bytes) => brandIn(bytes, ['mif1', 'msf1', 'heif'])],
];

/** What the bytes are, from their magic numbers alone. */
export function sniffPhotoType(bytes: Uint8Array): PhotoContentType | undefined {
    return SNIFFERS.find(([, sniff]) => sniff(bytes))?.[0];
}

/**
 * HEIC and HEIF photos (iPhones) are HEVC-coded, which sharp's prebuilt libvips cannot decode (it reads AVIF only):
 * they are reported with their type and no size, and `photos.onUpload` refuses them with an actionable message.
 */
const UNDECODABLE: ReadonlySet<PhotoContentType> = new Set(['image/heic', 'image/heif']);

/** Bytes sharp cannot read (CR-M2-23): `photos.onUpload` answers `apiError.photo.unreadable`. */
function unreadable(): UpstreamError {
    return new UpstreamError('image', 'invalid');
}

/** Header only (no pixels are decoded), so the size of an image over the pixel limit is still reported. */
async function inspectDecodable(bytes: Uint8Array, contentType: PhotoContentType): Promise<ImageInspection> {
    const metadata = await sharp(bytes, { limitInputPixels: false })
        .metadata()
        .catch(() => {
            throw unreadable();
        });
    const size = metadata.autoOrient;
    return { contentType, width: size.width, height: size.height, exif: readExif(metadata.exif) };
}

/**
 * sharp (libvips) behind the `ImageProcessor` port. `inspect` sniffs the magic numbers before sharp sees anything and
 * reads only the header, so a decompression bomb is measured, never decoded; `webp` decodes with sharp's
 * `limitInputPixels` at `PHOTO_LIMITS.maxInputPixels`, applies the EXIF orientation and writes no metadata at all
 * (sharp keeps none unless asked). Unreadable bytes reject with `UpstreamError` `invalid`.
 */
export function createSharpImageProcessor(): ImageProcessor {
    return {
        inspect: async (bytes) => {
            const contentType = sniffPhotoType(bytes);
            if (contentType === undefined || UNDECODABLE.has(contentType)) {
                return { contentType, width: 0, height: 0, exif: {} };
            }
            return inspectDecodable(bytes, contentType);
        },
        webp: async (bytes, options) => {
            const output = await sharp(bytes, { limitInputPixels: PHOTO_LIMITS.maxInputPixels })
                .rotate()
                .resize({ width: options.longEdge, height: options.longEdge, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: options.quality })
                .toBuffer({ resolveWithObject: true })
                .catch(() => {
                    throw unreadable();
                });
            return { bytes: new Uint8Array(output.data), width: output.info.width, height: output.info.height };
        },
    };
}
