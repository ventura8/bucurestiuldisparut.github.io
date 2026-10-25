/**
 * What one static export holds (M5, `docs/research/M5-interfaces.md` §5.1, §5.2), pure: from the published manifest,
 * the layers whose scans may travel and the kit, the list of the zip's files with where each one's bytes come from, the
 * city's `city.json` and the export's counts. The task (`./build.ts`) reads, plans, sums the sizes, then streams.
 */
import {
    EXPORT_LAYOUT,
    exportPhotoPath,
    exportRasterPath,
    restrictedPhotoIds,
    type CityExportDoc,
    type Manifest,
    type Photo,
    type PhotoVariant,
} from '@hcm/shared';

import type { BucketRole } from '../ports/blob-store.js';
import type { KitFile } from '../ports/export-kit.js';
import { exportReadme, rightsDocument } from './documents.js';
import { exportPage } from './page.js';

/** Where an entry's bytes come from: text the export writes, an object of a bucket, or a file of the kit. */
export type PlannedSource =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'object'; readonly bucket: BucketRole; readonly path: string }
    | { readonly kind: 'kit'; readonly file: KitFile };

export interface PlannedEntry {
    readonly name: string;
    readonly source: PlannedSource;
}

/** A layer whose scan travels (a USGS frame, `rasterExportable`): its current version's Cloud-Optimized GeoTIFF. */
export interface ExportRaster {
    readonly layerId: string;
    /** The COG in the private bucket (`layerVersion.output.cogPath`). */
    readonly path: string;
}

export interface PlanInput {
    readonly manifest: Manifest;
    /** `https://storage.googleapis.com/<public bucket>/`: a photo file under it travels, its address made relative. */
    readonly publicPrefix: string;
    /** The scans asked for and allowed (empty without `rasters`). */
    readonly rasters: readonly ExportRaster[];
    /** The starter kit's `index.html` as committed (`exportPage` fills it for the city). */
    readonly kitPage: string;
    /** The kit's README, which the export's preface goes before. */
    readonly kitReadme: string;
    readonly engine: readonly KitFile[];
    /** The export's day (the README names it). */
    readonly madeAt: Date;
}

type ExportCounts = NonNullable<CityExportDoc['counts']>;

export interface ExportPlan {
    readonly entries: readonly PlannedEntry[];
    readonly counts: ExportCounts;
}

const VARIANTS: readonly PhotoVariant[] = ['web', 'thumb'];

/** The object path of a public-bucket address, or undefined for any other address (it stays as it is). */
function publicPath(url: string, prefix: string): string | undefined {
    return url.startsWith(prefix) ? url.slice(prefix.length) : undefined;
}

interface PhotoFiles {
    readonly photo: Photo;
    readonly entries: readonly PlannedEntry[];
}

/** A photo whose files are in the public bucket: its files under `photos/<id>/`, its addresses relative. */
function photoFiles(photo: Photo, prefix: string): PhotoFiles {
    const entries: PlannedEntry[] = [];
    const image = { ...photo.image };
    for (const variant of VARIANTS) {
        const path = publicPath(photo.image[variant], prefix);
        if (path !== undefined) {
            const name = exportPhotoPath(photo.id, variant);
            entries.push({ name, source: { kind: 'object', bucket: 'public', path } });
            image[variant] = name;
        }
    }
    return { photo: { ...photo, image }, entries };
}

/**
 * The export's `city.json`: the photos' files beside it, and no analytics at all (the project's GA4 and Firebase ids and
 * its crash endpoint stay the project's: an export sends nothing anywhere). The viewer token stays (README: replace it).
 */
function exportedManifest(manifest: Manifest, photos: readonly Photo[]): Manifest {
    return { ...manifest, city: { ...manifest.city, analytics: {} }, photos: [...photos] };
}

function text(name: string, value: string): PlannedEntry {
    return { name, source: { kind: 'text', text: value } };
}

/** Every file of the export, the city's `city.json` among them, and what the export's record counts. */
export function planExport(input: PlanInput): ExportPlan {
    const photos = input.manifest.photos.map((photo) => photoFiles(photo, input.publicPrefix));
    const manifest = exportedManifest(
        input.manifest,
        photos.map((files) => files.photo),
    );
    const restricted = new Set(restrictedPhotoIds(input.manifest.photos));
    const rights = input.manifest.photos.filter((photo) => restricted.has(photo.id));
    const readme = exportReadme({ manifest, rasters: input.rasters.length, kitReadme: input.kitReadme, madeAt: input.madeAt });
    const entries: PlannedEntry[] = [
        text(EXPORT_LAYOUT.page, exportPage(input.kitPage, manifest)),
        text(EXPORT_LAYOUT.manifest, `${JSON.stringify(manifest, null, 2)}\n`),
        text(EXPORT_LAYOUT.readme, readme),
        text(EXPORT_LAYOUT.rights, rightsDocument(manifest.city.name, rights)),
        ...input.engine.map((file) => ({ name: `${EXPORT_LAYOUT.engineFolder}/${file.path}`, source: { kind: 'kit', file } }) as const),
        ...photos.flatMap((files) => files.entries),
        ...input.rasters.map((raster) => ({
            name: exportRasterPath(raster.layerId),
            source: { kind: 'object', bucket: 'private', path: raster.path } as const,
        })),
    ];
    return {
        entries,
        counts: {
            photos: manifest.photos.length,
            restrictedPhotos: rights.length,
            layers: manifest.layers.length,
            rasters: input.rasters.length,
            pois: manifest.pois?.length ?? 0,
        },
    };
}
