/**
 * What a signed-in admin may write directly with the Firestore SDK, field by field (every other write goes through a
 * callable or a server trigger). `create` lists the fields a new document may contain, `update` the fields an update
 * may change (`request.resource.data.diff(resource.data).affectedKeys()` in the rules); an empty list means the
 * operation is never allowed from a client. Every field outside these lists is server-owned.
 *
 * `firebase/firestore.rules` mirrors this table and `firebase/rules-tests` imports it, so a field added to a document
 * schema (`firestore.ts`, `firestore-ops.ts`) is added here, to the rules and to their tests in the same change
 * (CR-1 and CR-4 of `docs/research/M1-interfaces.md`, resolved in `docs/research/M2-interfaces.md` §2.3).
 */

/** Every client write stamps who and when (`updatedBy == request.auth.uid`, `updatedAt == request.time`). */
const STAMP = ['updatedBy', 'updatedAt'] as const;

const CITY_EDITABLE = [
    'name',
    'bounds',
    'center',
    'zoom',
    'minZoom',
    'maxZoom',
    'about',
    'privacy',
    'credits',
    'theme',
    'basemap',
    'photosOverlay',
    /** M3: auto-publish, its RMSE threshold and the target years (`cityImagerySchema`; CR-M3-2). */
    'imagery',
    'published',
    ...STAMP,
] as const;

const PHOTO_EDITABLE = [
    'title',
    'description',
    'year',
    'yearEnd',
    'dateText',
    'author',
    'license',
    'rightsHolder',
    'sourceUrl',
    'sourceLabel',
    'permissionNote',
    'legacyId',
    'links',
    'location',
    'bearing',
    'fov',
    'published',
    'rightsReview',
    ...STAMP,
] as const;

const LAYER_EDITABLE = [
    'label',
    'description',
    'attribution',
    'year',
    'date',
    'order',
    'opacity',
    'defaultVisible',
    'adjustments',
    'published',
    ...STAMP,
] as const;

const POI_EDITABLE = [
    'category',
    'geometry',
    'title',
    'description',
    'yearStart',
    'yearEnd',
    'links',
    'photoIds',
    'published',
    ...STAMP,
] as const;

const POI_CATEGORY_EDITABLE = ['label', 'icon', 'color', 'defaultOpacity', 'order', ...STAMP] as const;

export interface ClientWrites {
    readonly create: readonly string[];
    readonly update: readonly string[];
}

export const CLIENT_WRITES = {
    /** Cities are created and deleted by callables (M5); admins edit the settings. */
    city: { create: [], update: CITY_EDITABLE },
    /** A new photo starts `processing: 'pending'`, unpublished; `photos.onUpload` owns the image fields. */
    photo: { create: [...PHOTO_EDITABLE, 'processing', 'createdAt', 'createdBy'], update: PHOTO_EDITABLE },
    /** Layers are created by the pipeline; admins edit presentation, default opacity and image adjustments. */
    layer: { create: [], update: LAYER_EDITABLE },
    poi: { create: [...POI_EDITABLE, 'createdAt', 'createdBy'], update: POI_EDITABLE },
    poiCategory: { create: [...POI_CATEGORY_EDITABLE, 'createdAt'], update: POI_CATEGORY_EDITABLE },
    /**
     * Jobs are created by the callables and triggers that check their parameters, the budget guard, the daily cap and
     * their version in one transaction (`docs/research/M3-interfaces.md` §2.8, CR-M3-2); admins only ask one to stop.
     */
    job: { create: [], update: ['cancelRequested', ...STAMP] },
    usgsScene: { create: [], update: ['status', 'note', ...STAMP] },
} as const satisfies Readonly<Record<string, ClientWrites>>;

export type ClientCollection = keyof typeof CLIENT_WRITES;
