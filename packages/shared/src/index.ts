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

export { ID_PATTERN, MAX_TOKENS, TOKEN_NAME_PATTERN, isId } from './schemas/primitives.js';
export type { ValidationCode } from './schemas/primitives.js';
export {
    LAYER_KINDS,
    LICENSES,
    MANIFEST_VERSION,
    MAX_LAYERS,
    MAX_LINKS,
    MAX_PHOTOS,
    PHOTO_LOCATION_SLACK_DEG,
    THEME_SCHEMES,
    citySchema,
    layerSchema,
    manifestSchema,
    photoSchema,
    themeSchema,
} from './schemas/manifest.js';
export type {
    Basemap,
    City,
    Credit,
    Layer,
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
    JOB_STATUSES,
    JOB_TYPES,
    LAYER_STATUSES,
    PROCESSING_STATES,
    SERVICE_STATES,
    USGS_DATASETS,
    USGS_SCENE_STATUSES,
    adminDocSchema,
    cityDocSchema,
    jobDocSchema,
    layerDocSchema,
    photoDocSchema,
    setupStatusDocSchema,
    timestampSchema,
    usgsSceneDocSchema,
} from './schemas/firestore.js';
export type {
    AdminDoc,
    CityDoc,
    FirestoreLicense,
    JobDoc,
    JobStatus,
    JobType,
    LayerDoc,
    PhotoDoc,
    SetupStatusDoc,
    TimestampLike,
    UsgsSceneDoc,
} from './schemas/firestore.js';
export { formatPath, isValidationCode, parseManifestJson, toValidationIssues, validate, validateManifest } from './schemas/validation.js';
export type { ValidationIssue, ValidationResult } from './schemas/validation.js';
export { checkManifestCompat, compareVersions, parseVersion } from './schemas/compat.js';
export type { ManifestCompat } from './schemas/compat.js';

export * from './migration/index.js';
