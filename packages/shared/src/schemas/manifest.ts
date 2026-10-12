/**
 * The public City Manifest v1: the only data the viewer reads (docs/ENGINE_API.md → Manifest v1).
 * Built by the manifest builder (M2) or the legacy migration (`seed/bucharest/manifest.static.json`),
 * served as static JSON, validated by the engine before anything is rendered.
 */
import { z } from 'zod';

import { bboxContains } from '../geo/bbox.js';
import { isHttpsUrl } from '../text/urls.js';
import { manifestRuleIssues } from './manifest-rules.js';
import { photosOverlaySchema, poiCategorySchema, poiSchema, MAX_POI_CATEGORIES, MAX_POIS } from './poi.js';
import {
    assetUrlSchema,
    bboxSchema,
    bearingSchema,
    coded,
    firebaseAppIdsSchema,
    fovSchema,
    hexColorSchema,
    httpsUrlSchema,
    idSchema,
    isoDateSchema,
    latLngSchema,
    linkSchema,
    lngLatSchema,
    localized,
    localizedMarkdown,
    localizedPartial,
    mapboxPublicTokenSchema,
    MAX_LINKS,
    measurementIdSchema,
    opacitySchema,
    plainText,
    tokenMapSchema,
    validYearRange,
    versionSchema,
    yearSchema,
    zoomSchema,
} from './primitives.js';

/** The `version` every v1 manifest carries; a different value is refused before validation. */
export const MANIFEST_VERSION = 1;

/** Photo licences that may be published (`unknown` exists only in Firestore and is never published). */
export const LICENSES = ['CC0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'PD', 'permission', 'permission-legacy'] as const;

export const LAYER_KINDS = ['satellite', 'aerial', 'map'] as const;

/** The four generated colour schemes of a city theme. */
export const THEME_SCHEMES = ['light', 'dark', 'highContrastLight', 'highContrastDark'] as const;

export const MAX_LAYERS = 100;
export const MAX_PHOTOS = 5000;

const MAPBOX_STYLE = /^mapbox:\/\/styles\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const TILESET_ID = /^[a-z0-9_-]{1,32}\.[A-Za-z0-9_-]{1,64}$/;
const STYLE_CONFIG_KEY = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

export const creditSchema = z.strictObject({ label: localized(300), url: httpsUrlSchema.optional() });

export const themeSchema = z.strictObject({
    seedColor: hexColorSchema,
    tokens: z.strictObject({
        light: tokenMapSchema,
        dark: tokenMapSchema,
        highContrastLight: tokenMapSchema,
        highContrastDark: tokenMapSchema,
    }),
});

export const basemapSchema = z.strictObject({
    /** `mapbox://styles/<owner>/<style>` or an https style URL. */
    style: z
        .string()
        .max(2048)
        .refine((style) => MAPBOX_STYLE.test(style) || isHttpsUrl(style), coded('validation.format')),
    /** Mapbox Standard configuration properties (`lightPreset`, `show3dObjects`, ...), set on the `basemap` import. */
    config: z
        .record(z.string().regex(STYLE_CONFIG_KEY), z.union([z.string().max(64), z.number(), z.boolean()]))
        .refine((config) => Object.keys(config).length <= 30, coded('validation.tooBig'))
        .optional(),
});

/** GA4 (loaded only after consent) and the crash-report endpoint (`telemetry.reportError`). */
export const analyticsSchema = z.strictObject({
    measurementId: measurementIdSchema.optional(),
    errorEndpoint: httpsUrlSchema.optional(),
    firebase: firebaseAppIdsSchema.optional(),
});

export const citySchema = z
    .strictObject({
        id: idSchema,
        name: localized(100),
        center: lngLatSchema,
        zoom: zoomSchema,
        minZoom: zoomSchema,
        maxZoom: zoomSchema,
        bounds: bboxSchema,
        about: localizedMarkdown(10_000),
        credits: z.array(creditSchema).max(50),
        privacy: localizedMarkdown(10_000),
        theme: themeSchema,
        basemap: basemapSchema,
        /** The URL-restricted public token of the viewer. */
        mapbox: z.strictObject({ publicToken: mapboxPublicTokenSchema }),
        analytics: analyticsSchema,
        engine: z.strictObject({ minVersion: versionSchema.optional() }).optional(),
    })
    .refine((city) => city.minZoom <= city.zoom && city.zoom <= city.maxZoom, coded('validation.zoomRange', ['zoom']))
    .refine((city) => bboxContains(city.bounds, city.center), coded('validation.centerOutside', ['center']));

const tileTemplateSchema = httpsUrlSchema.refine(
    (template) => ['{z}', '{x}', '{y}'].every((part) => template.includes(part)),
    coded('validation.tileTemplate'),
);

export const layerSourceSchema = z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('mapbox'), tilesetId: z.string().regex(TILESET_ID) }),
    z.strictObject({
        type: z.literal('xyz'),
        tiles: z.array(tileTemplateSchema).min(1).max(4),
        tileSize: z.union([z.literal(256), z.literal(512)]),
    }),
    z.strictObject({ type: z.literal('pmtiles'), url: assetUrlSchema }),
]);

/**
 * The ranges and neutral values of the raster image adjustments (Mapbox `raster-brightness-min/max`, `raster-contrast`,
 * `raster-saturation`). The schema refuses a value outside its range; `rasterAdjustmentPaint` clamps live slider values.
 */
export const LAYER_ADJUSTMENT_RANGES = {
    brightnessMin: { min: 0, max: 1, neutral: 0 },
    brightnessMax: { min: 0, max: 1, neutral: 1 },
    contrast: { min: -1, max: 1, neutral: 0 },
    saturation: { min: -1, max: 1, neutral: 0 },
} as const;

export type LayerAdjustmentName = keyof typeof LAYER_ADJUSTMENT_RANGES;

function adjustmentSchema(name: LayerAdjustmentName) {
    const range = LAYER_ADJUSTMENT_RANGES[name];
    return z.number().min(range.min).max(range.max).optional();
}

/** Raster paint adjustments applied live by the viewer (PLAN Addendum 3); brightness min never above max. */
export const layerAdjustmentsSchema = z
    .strictObject({
        brightnessMin: adjustmentSchema('brightnessMin'),
        brightnessMax: adjustmentSchema('brightnessMax'),
        contrast: adjustmentSchema('contrast'),
        saturation: adjustmentSchema('saturation'),
    })
    .refine((adjust) => (adjust.brightnessMin ?? 0) <= (adjust.brightnessMax ?? 1), coded('validation.value', ['brightnessMax']));

export const layerSchema = z
    .strictObject({
        id: idSchema,
        year: yearSchema,
        date: isoDateSchema.optional(),
        label: localized(200),
        description: localized(5000).optional(),
        kind: z.enum(LAYER_KINDS),
        sensor: plainText(100).optional(),
        attribution: plainText(500),
        source: layerSourceSchema,
        minzoom: zoomSchema,
        maxzoom: zoomSchema,
        bounds: bboxSchema.optional(),
        order: z.number().int(),
        defaultVisible: z.boolean(),
        opacity: opacitySchema,
        adjustments: layerAdjustmentsSchema.optional(),
    })
    .refine((layer) => layer.minzoom <= layer.maxzoom, coded('validation.zoomRange', ['maxzoom']))
    .refine((layer) => layer.date === undefined || layer.date.startsWith(String(layer.year)), coded('validation.value', ['date']));

const photoImageSchema = z.strictObject({
    web: assetUrlSchema,
    thumb: assetUrlSchema,
    w: z.number().int().min(1).max(20_000),
    h: z.number().int().min(1).max(20_000),
});

export const photoSchema = z
    .strictObject({
        id: idSchema,
        title: localizedPartial(200),
        description: localizedPartial(5000).optional(),
        year: yearSchema.optional(),
        yearEnd: yearSchema.optional(),
        /** How the source dates the photo when that is more than a year (`Iulie 1936`). */
        dateText: localizedPartial(100).optional(),
        author: plainText(200).optional(),
        license: z.enum(LICENSES),
        rightsHolder: plainText(200).optional(),
        /** True while the rights of a migrated photo are being confirmed (the viewer shows a note). */
        rightsReview: z.boolean().optional(),
        links: z.array(linkSchema).max(MAX_LINKS),
        location: latLngSchema,
        bearing: bearingSchema.optional(),
        fov: fovSchema.optional(),
        image: photoImageSchema,
    })
    .refine(validYearRange, coded('validation.yearRange', ['yearEnd']));

export const manifestSchema = z
    .strictObject({
        version: z.literal(MANIFEST_VERSION),
        city: citySchema,
        layers: z.array(layerSchema).max(MAX_LAYERS),
        photos: z.array(photoSchema).max(MAX_PHOTOS),
        /** Defaults of the photos overlay; without it the photos start fully opaque. */
        photosOverlay: photosOverlaySchema.optional(),
        poiCategories: z.array(poiCategorySchema).max(MAX_POI_CATEGORIES).optional(),
        pois: z.array(poiSchema).max(MAX_POIS).optional(),
    })
    .superRefine((manifest, context) => {
        for (const issue of manifestRuleIssues(manifest)) {
            context.addIssue({ code: 'custom', ...coded(issue.code, [...issue.path]) });
        }
    });

export type Manifest = z.infer<typeof manifestSchema>;
export type City = z.infer<typeof citySchema>;
export type Credit = z.infer<typeof creditSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type ThemeTokens = Theme['tokens'];
export type ThemeScheme = (typeof THEME_SCHEMES)[number];
export type Basemap = z.infer<typeof basemapSchema>;
export type Layer = z.infer<typeof layerSchema>;
export type LayerKind = (typeof LAYER_KINDS)[number];
export type LayerSource = z.infer<typeof layerSourceSchema>;
export type LayerAdjustments = z.infer<typeof layerAdjustmentsSchema>;
export type Photo = z.infer<typeof photoSchema>;
export type PhotoImage = z.infer<typeof photoImageSchema>;
export type PhotoLink = z.infer<typeof linkSchema>;
export type License = (typeof LICENSES)[number];
