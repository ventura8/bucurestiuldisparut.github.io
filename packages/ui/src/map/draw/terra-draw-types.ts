/**
 * The part of Terra Draw 1.37.0 and `terra-draw-mapbox-gl-adapter` 1.5.0 the draw adapter uses, typed structurally
 * (as `mapbox-types.ts` types the global `mapboxgl`): `terra-draw-adapter.ts` takes these constructors from the admin's
 * lazy loader, and its tests take a fake of them. The names and shapes follow Terra Draw's 1.x API as documented
 * (`new TerraDraw({adapter, modes, idStrategy})`, `start`, `setMode`, `getSnapshot`, `addFeatures`, `removeFeatures`,
 * `selectFeature`, the `change`, `finish`, `select` and `deselect` events; modes with `styles`, `validation` and the
 * select mode's per-mode `flags`). **UNVERIFIED** until the packages are installed: the loader's
 * `satisfies TerraDrawModules` then checks the real modules against these types, and a browser test drives them.
 */

export type TdFeatureId = string | number;

/** A feature of Terra Draw's store: GeoJSON whose `properties.mode` names the mode that owns it. */
export interface TdFeature {
    readonly id?: TdFeatureId;
    readonly type: 'Feature';
    readonly geometry: { readonly type: string; readonly coordinates: unknown };
    readonly properties: Readonly<Record<string, unknown>>;
}

export interface TdValidationResult {
    readonly valid: boolean;
    readonly reason?: string;
}

/** A mode's `validation` option: called for every new or moved coordinate; an invalid result refuses the change. */
export type TdValidation = (feature: TdFeature, context: { readonly updateType?: string }) => TdValidationResult;

/** What `finish` reports: `draw` for a new shape, `dragFeature`, `dragCoordinate` and the like for an edit. */
export interface TdFinishContext {
    readonly mode: string;
    readonly action: string;
}

export interface TdAddResult {
    readonly id?: TdFeatureId;
    readonly valid: boolean;
    readonly reason?: string;
}

interface TdIdStrategy {
    isValidId(id: TdFeatureId): boolean;
    getId(): TdFeatureId;
}

export interface TdInstance {
    start(): void;
    stop(): void;
    setMode(mode: string): void;
    getSnapshot(): readonly TdFeature[];
    addFeatures(features: readonly TdFeature[]): readonly TdAddResult[];
    removeFeatures(ids: readonly TdFeatureId[]): void;
    selectFeature(id: TdFeatureId): void;
    deselectFeature(id: TdFeatureId): void;
    on(event: 'change', listener: (ids: readonly TdFeatureId[], type: string) => void): void;
    on(event: 'finish', listener: (id: TdFeatureId, context: TdFinishContext) => void): void;
    on(event: 'select', listener: (id: TdFeatureId) => void): void;
    on(event: 'deselect', listener: () => void): void;
}

export interface TdOptions {
    readonly adapter: unknown;
    readonly modes: readonly unknown[];
    readonly idStrategy: TdIdStrategy;
}

/** Styles of the point, line and polygon modes (Terra Draw colours are `#rrggbb`). */
export type TdStyles = Readonly<Record<string, string | number>>;

export interface TdModeOptions {
    readonly modeName?: string;
    readonly styles?: TdStyles;
    readonly validation?: TdValidation;
    readonly flags?: Readonly<Record<string, unknown>>;
}

type TdModeConstructor = new (options?: TdModeOptions) => unknown;

/** The constructors the adapter needs: `terra-draw`'s and the Mapbox GL adapter's. */
export interface TerraDrawModules {
    readonly TerraDraw: new (options: TdOptions) => TdInstance;
    readonly TerraDrawPointMode: TdModeConstructor;
    readonly TerraDrawLineStringMode: TdModeConstructor;
    readonly TerraDrawPolygonMode: TdModeConstructor;
    readonly TerraDrawRectangleMode: TdModeConstructor;
    readonly TerraDrawSelectMode: TdModeConstructor;
    readonly TerraDrawRenderMode: TdModeConstructor;
    readonly TerraDrawMapboxGLAdapter: new (options: { readonly map: unknown; readonly coordinatePrecision: number }) => unknown;
}
