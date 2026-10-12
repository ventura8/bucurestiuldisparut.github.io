export { DEFAULT_LOCALE, LOCALES, resolveLocale, translate } from './i18n/index.js';
export type { Locale, MessageKey, Messages } from './i18n/index.js';
export { REDACTED, consoleSink, createLogger, redact } from './log.js';
export type { LogData, LogLevel, LogRecord, LogSink, Logger, LoggerOptions } from './log.js';

export { EARTH_RADIUS_M, MAX_MERCATOR_LAT, bearingDelta, clamp, roundTo, toDegrees, toRadians, wrapBearing } from './geo/math.js';
export type { LngLat } from './geo/math.js';
export { bearingBetween, destinationPoint, distanceMeters } from './geo/bearing.js';
export { DEFAULT_FOV, MAX_FOV, MIN_FOV, angularSpan, coneFromPolygon, conePolygon, findConeApex, openRing } from './geo/cone.js';
export type { MeasuredCone, ViewCone } from './geo/cone.js';
export { bboxCenter, bboxContains, bboxExpand, bboxFromRecord, bboxIntersects, bboxOf, bboxToRecord, clampToBBox } from './geo/bbox.js';
export type { BBox, BoundsRecord } from './geo/bbox.js';

export { DEFAULT_HASH_LIMITS, MAX_HASH_LENGTH, MAX_OVERLAY_ENTRIES, decodeHash, encodeHash } from './url/hash.js';
export type { DecodedHash, HashLimits, HashState, MapView } from './url/hash.js';

export { MAX_URL_LENGTH, isHostOf, isHttpsUrl, isRelativeUrl, toHttpsUrl } from './text/urls.js';
export { markdownToPlainText, parseMarkdown } from './text/markdown.js';
export type { InlineNode, MarkdownDocument, MarkdownParagraph } from './text/markdown.js';

export { ID_PATTERN, MAX_LINKS, MAX_TOKENS, PHOTOS_OVERLAY_ID, TOKEN_NAME_PATTERN, isId } from './schemas/primitives.js';
export type { ValidationCode } from './schemas/primitives.js';
export {
    LAYER_ADJUSTMENT_RANGES,
    LAYER_KINDS,
    LICENSES,
    MANIFEST_VERSION,
    MAX_LAYERS,
    MAX_PHOTOS,
    THEME_SCHEMES,
    citySchema,
    layerSchema,
    manifestSchema,
    photoSchema,
    themeSchema,
} from './schemas/manifest.js';
export { PHOTO_LOCATION_SLACK_DEG } from './schemas/manifest-rules.js';
export {
    GEOMETRY_TYPES,
    MAX_GEOMETRY_VERTICES,
    MAX_POLYGON_RINGS,
    geometryDocSchema,
    geometryFromDoc,
    geometryPositions,
    geometrySchema,
    geometryToDoc,
} from './schemas/geometry.js';
export type { Geometry, GeometryDoc, GeometryType } from './schemas/geometry.js';
export {
    DEFAULT_POI_ICON,
    ICON_NAME_PATTERN,
    MAX_POIS,
    MAX_POI_CATEGORIES,
    MAX_POI_PHOTOS,
    POI_ICONS,
    photosOverlaySchema,
    poiCategorySchema,
    poiSchema,
} from './schemas/poi.js';
export type { PhotosOverlay, Poi, PoiCategory, PoiIcon } from './schemas/poi.js';
export type {
    Basemap,
    City,
    Credit,
    Layer,
    LayerAdjustmentName,
    LayerAdjustments,
    LayerKind,
    LayerSource,
    License,
    Manifest,
    Photo,
    PhotoImage,
    PhotoLink,
    Theme,
    ThemeScheme,
    ThemeTokens,
} from './schemas/manifest.js';
export { DEFAULT_CONTAINER_SELECTOR, engineConfigSchema } from './schemas/config.js';
export type { EngineConfig } from './schemas/config.js';
export {
    ADMIN_ROLES,
    FIRESTORE_LICENSES,
    GEOREF_METHODS,
    HISTORY_ACTIONS,
    HISTORY_ENTITIES,
    JOB_STATUSES,
    JOB_TYPES,
    LAYER_STATUSES,
    PROCESSING_STATES,
    SERVICE_STATES,
    USGS_DATASETS,
    USGS_SCENE_STATUSES,
    adminDocSchema,
    cityDocSchema,
    historyEntryDocSchema,
    jobDocSchema,
    layerDocSchema,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    setupStatusDocSchema,
    timestampSchema,
    usgsSceneDocSchema,
} from './schemas/firestore.js';
export type {
    AdminDoc,
    CityDoc,
    FirestoreLicense,
    HistoryAction,
    HistoryEntity,
    HistoryEntryDoc,
    JobDoc,
    JobStatus,
    JobType,
    LayerDoc,
    PhotoDoc,
    PoiCategoryDoc,
    PoiDoc,
    SetupStatusDoc,
    TimestampLike,
    UsgsSceneDoc,
} from './schemas/firestore.js';
export { formatPath, isValidationCode, parseManifestJson, toValidationIssues, validate, validateManifest } from './schemas/validation.js';
export type { ValidationIssue, ValidationResult } from './schemas/validation.js';
export { checkManifestCompat, compareVersions, parseVersion } from './schemas/compat.js';
export type { ManifestCompat } from './schemas/compat.js';

export {
    DEFAULT_PHOTOS_OPACITY,
    OVERLAY_KINDS,
    findOverlay,
    hashOverlayOpacity,
    opacityPercent,
    overlayLabel,
    overlaysFromManifest,
    resetOverlays,
    withHashOpacity,
    withOverlayOpacity,
    withOverlayVisibility,
} from './overlays/model.js';
export type { Overlay, OverlayKind, OverlayLabel } from './overlays/model.js';
export { MAP_LAYER_TYPES, OPACITY_PROPERTIES, OVERLAY_LAYER_TYPES, overlayOpacityPaint, rasterAdjustmentPaint } from './overlays/paint.js';
export type { MapLayerType, OpacityBase, OpacityProperty, PaintUpdate, RasterAdjustmentPaint } from './overlays/paint.js';
export { isPhotoNearYear, PHOTO_YEAR_WINDOW } from './overlays/photos.js';
export { poiIcon, poiInYear } from './overlays/poi.js';

export * from './migration/index.js';
