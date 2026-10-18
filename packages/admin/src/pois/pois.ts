/**
 * The places area (docs/research/M2c-interfaces.md §7; behaviours A32, A33, A34, A38): `#/pois` lists the city's places
 * (category chips, Unpublished, a search of the loaded page) with every one on the map; `#/pois/<id>` opens a place's
 * editor (`PlaceEditor`), a new one included before its first Save. Places are drawn with the map's tools or entered
 * in the vertex list, saved published by default, deleted with Undo, changed in bulk, and imported from or exported to
 * GeoJSON. The store is DOM-free: the page hands it the map's host and the chosen file.
 */
import {
    cityDocSchema,
    FIRESTORE_PATHS,
    isId,
    photoDocSchema,
    poiCategoryDocSchema,
    poiDocSchema,
    type CityDoc,
    type PhotoDoc,
    type PoiCategoryDoc,
    type PoiDoc,
} from '@hcm/shared';

import type { AreaModule, AreaStore } from '../content/areas.js';
import { LiveDoc } from '../content/doc.js';
import { LiveList, type ListState, type LiveListDeps } from '../content/list.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { Store } from '../state/store.js';
import { LAST_CATEGORY_KEY, PlaceActions } from './actions.js';
import type { BulkAction } from './bulk.js';
import type { PoiContext } from './draft.js';
import { PlaceEditor, type PlaceEditorState } from './editor.js';
import { exportFileName, exportText, GEOJSON_MEDIA_TYPE } from './geojson.js';
import { Importer } from './importer.js';
import { PoisMap, UNCATEGORISED_COLOR, type EditTarget } from './map-session.js';
import { categoryItemOf, cityFrameOf, drawLimitsOf, poiItemOf, type CategoryItem, type PoiItem, type PoiValue } from './model.js';
import {
    importOverlays,
    notFound,
    photoChoiceOf,
    placeOverlays,
    poisQuery,
    shownPlaces,
    type PhotoChoice,
    type PoisFilter,
} from './places.js';
import {
    INITIAL_POIS_STATE,
    type FileIntent,
    type ListIntent,
    type PoisIntents,
    type PoisServices,
    type PoisState,
    type SavedFile,
} from './state.js';
import type { PlaceShape } from './vertices.js';

class PoisStore implements AreaStore<PoisState, PoisIntents> {
    readonly #services: PoisServices;
    readonly #cell: Store<PoisState>;
    readonly #list: LiveList<PoiDoc, PoiItem>;
    readonly #categories: LiveList<PoiCategoryDoc, CategoryItem>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #photos: LiveList<PhotoDoc, PhotoChoice>;
    readonly #map: PoisMap;
    readonly #importer: Importer;
    readonly #actions: PlaceActions;
    /** New places not opened yet (Add place, then the page opens its address). */
    readonly #fresh = new Map<string, PlaceEditor>();
    #editor: PlaceEditor | null = null;
    #clicks = 0;
    readonly intents: PoisIntents;

    constructor(services: PoisServices) {
        this.#services = services;
        this.#cell = new Store<PoisState>(INITIAL_POIS_STATE, services.log);
        this.#list = this.#liveList(FIRESTORE_PATHS.pois(services.cityId), poiDocSchema, poiItemOf, (list) => {
            this.#cell.update({ list });
            this.#placesChanged();
        });
        this.#categories = this.#liveList(
            FIRESTORE_PATHS.poiCategories(services.cityId),
            poiCategoryDocSchema,
            categoryItemOf,
            (categories) => {
                this.#cell.update({ categories });
                this.#placesChanged();
                this.#editor?.recheck();
            },
        );
        this.#photos = this.#liveList(FIRESTORE_PATHS.photos(services.cityId), photoDocSchema, photoChoiceOf, (photos) => {
            this.#cell.update({ photos });
        });
        this.#city = new LiveDoc({
            ...this.#liveParts(),
            schema: cityDocSchema,
            changed: () => {
                this.#cityChanged();
            },
        });
        this.#map = this.#newMap();
        this.#importer = new Importer({
            ...{ store: services.store, cityId: services.cityId },
            context: () => ({ ...this.#context(), existing: new Map(this.#cell.state.list.items.map((item) => [item.id, item.value])) }),
            changed: (importing) => {
                this.#cell.update({ importing });
                this.#placesChanged();
            },
        });
        this.#actions = new PlaceActions(services, (busy) => {
            this.#cell.update({ busy });
        });
        this.intents = this.#intents();
    }

    #liveParts(): Pick<ContentServices, 'store' | 'clock'> & { readonly denied: () => void } {
        const { store, clock } = this.#services;
        return {
            store,
            clock,
            denied: () => {
                this.#services.denied();
            },
        };
    }

    #liveList<Doc, Item>(
        collection: string,
        schema: LiveListDeps<Doc, Item>['schema'],
        map: LiveListDeps<Doc, Item>['map'],
        changed: (list: ListState<Item>) => void,
    ): LiveList<Doc, Item> {
        return new LiveList<Doc, Item>({ ...this.#liveParts(), collection, schema, map, changed });
    }

    #newMap(): PoisMap {
        return new PoisMap({
            ...{ maps: this.#services.maps ?? null, locale: this.#services.locale, log: this.#services.log },
            status: (map) => {
                this.#cell.update({ map });
            },
            clicked: (id) => {
                this.#clicks += 1;
                this.#cell.update({ clicked: { id, seq: this.#clicks } });
            },
            drawn: (geometry) => {
                this.#editor?.setGeometry(geometry);
            },
            refused: (kind) => {
                this.#editor?.refused(kind);
            },
        });
    }

    get state(): PoisState {
        return this.#cell.state;
    }

    subscribe(listener: (state: PoisState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#list.active) {
            this.#list.show(poisQuery(this.#cell.state.filter));
            this.#categories.show({ orderBy: [['order', 'asc']] });
            this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
        }
        this.#select(params[0] ?? null);
    }

    close(): void {
        for (const live of [this.#list, this.#categories, this.#photos, this.#city]) {
            live.stop();
        }
        this.#map.detach();
        this.#select(null);
        this.#actions.dispose();
    }

    hasUnsavedChanges(): boolean {
        return this.#editor?.unsaved === true;
    }

    destroy(): void {
        this.close();
        for (const editor of this.#fresh.values()) {
            editor.close();
        }
        this.#fresh.clear();
    }

    /** What the draft's checks read: the drawing limits once the city is known, the city's categories once listed. */
    #context(): PoiContext {
        const { frame, categories } = this.#cell.state;
        return {
            limits: frame === null ? null : drawLimitsOf(frame),
            categories: categories.status === 'ready' ? new Set(categories.items.map((category) => category.id)) : null,
        };
    }

    #cityChanged(): void {
        const doc = this.#city.state.doc;
        if (doc !== null) {
            const frame = cityFrameOf(doc.data);
            this.#cell.update({ frame });
            this.#map.setFrame(frame);
            this.#editor?.recheck();
        }
    }

    #select(id: string | null): void {
        if (id === this.#openId()) {
            return;
        }
        this.#editor?.close();
        this.#editor = id !== null && isId(id) ? this.#editorFor(id) : null;
        this.#cell.update({ editor: this.#editorState(id) });
        this.#targetChanged();
    }

    /** The id the page shows (a not-found one included). */
    #openId(): string | null {
        return this.#cell.state.editor?.id ?? null;
    }

    #editorState(id: string | null): PlaceEditorState | null {
        if (this.#editor !== null) {
            return this.#editor.state;
        }
        return id === null ? null : notFound(id);
    }

    #editorFor(id: string): PlaceEditor {
        const fresh = this.#fresh.get(id);
        this.#fresh.delete(id);
        return fresh ?? this.#newEditor(id, null);
    }

    #newEditor(id: string, fresh: { readonly value: PoiValue; readonly shape: PlaceShape } | null): PlaceEditor {
        const { store, clock, cityId } = this.#services;
        return new PlaceEditor(id, fresh, {
            ...{ store, clock, cityId, context: () => this.#context() },
            denied: () => {
                this.#services.denied();
            },
            changed: (editor) => {
                if (this.#editor?.id === editor.id) {
                    this.#cell.update({ editor });
                    this.#targetChanged();
                }
            },
        });
    }

    /** The map's drawing tools follow the open place. */
    #targetChanged(): void {
        this.#map.edit(this.#target());
    }

    #target(): EditTarget | null {
        const editor = this.#cell.state.editor;
        const value = editor?.draft?.value;
        if (editor === null || value === undefined) {
            return null;
        }
        return {
            id: editor.id,
            category: value.category,
            geometry: value.geometry,
            shape: editor.shape,
            color: this.#colourOf(value.category),
        };
    }

    #colourOf(categoryId: string): string {
        return this.#cell.state.categories.items.find((category) => category.id === categoryId)?.color ?? UNCATEGORISED_COLOR;
    }

    /** Every category's overlay with the places the list shows, and the import's preview. */
    #placesChanged(): void {
        const { list, categories, filter, importing } = this.#cell.state;
        const locale = this.#services.locale() === 'en' ? 'en' : 'ro';
        this.#map.showPlaces([...placeOverlays(categories.items, shownPlaces(list.items, filter), locale), ...importOverlays(importing)]);
    }

    #setFilter(patch: Partial<PoisFilter>): void {
        const before = this.#cell.state.filter;
        const filter = { ...before, ...patch };
        this.#cell.update({ filter });
        if (filter.category !== before.category || filter.unpublished !== before.unpublished) {
            this.#list.show(poisQuery(filter));
        }
        this.#placesChanged();
    }

    #add(shape: PlaceShape): string {
        const id = this.#services.store.newId();
        const categories = this.#cell.state.categories.items;
        const remembered = this.#services.local.get(LAST_CATEGORY_KEY);
        const category = categories.find((item) => item.id === remembered)?.id ?? categories[0]?.id ?? '';
        const value: PoiValue = { category, geometry: null, title: { ro: '' }, links: [], photoIds: [], published: true };
        this.#fresh.set(id, this.#newEditor(id, { value, shape }));
        return id;
    }

    async #save(): Promise<WriteOutcome | null> {
        return this.#editor === null ? null : this.#actions.save(this.#editor);
    }

    async #remove(): Promise<WriteOutcome | null> {
        return this.#editor === null || this.#cell.state.busy ? null : this.#actions.remove(this.#editor);
    }

    async #bulk(action: BulkAction): Promise<void> {
        const selection = new Set(this.#cell.state.selection);
        if (selection.size === 0 || this.#cell.state.busy) {
            return;
        }
        const selected = this.#cell.state.list.items.filter((item) => selection.has(item.id));
        if (await this.#actions.bulk(action, selected, selection.size)) {
            this.#cell.update({ selection: [] });
        }
    }

    #toggle(id: string): void {
        const selection = this.#cell.state.selection;
        this.#cell.update({ selection: selection.includes(id) ? selection.filter((selected) => selected !== id) : [...selection, id] });
    }

    #export(onlySelection: boolean): SavedFile {
        const { list, categories, selection } = this.#cell.state;
        const chosen = onlySelection ? list.items.filter((item) => selection.includes(item.id)) : list.items;
        const places = chosen.map((item) => ({ id: item.id, value: item.value }));
        const { cityId, clock } = this.#services;
        return {
            name: exportFileName(cityId, new Date(clock.now())),
            type: GEOJSON_MEDIA_TYPE,
            text: exportText(cityId, places, categories.items),
        };
    }

    #retry(): void {
        this.#list.retry();
        this.#categories.retry();
        this.#editor?.retry();
    }

    /** Adds a vertex at the map's centre (the city's starting view's without a map: the keyboard path still works). */
    #addAtCentre(): boolean {
        const centre = this.#map.centre();
        return centre !== null && this.#editor?.addAt(centre) === true;
    }

    #selectAll(): void {
        this.#cell.update({ selection: shownPlaces(this.#cell.state.list.items, this.#cell.state.filter).map((item) => item.id) });
    }

    #loadPhotos(): void {
        if (!this.#photos.active) {
            this.#photos.show({ orderBy: [['updatedAt', 'desc']] });
        }
    }

    #intents(): PoisIntents {
        return { ...this.#listIntents(), ...this.#editorIntents(), ...this.#fileIntents() };
    }

    #listIntents(): Pick<PoisIntents, ListIntent> {
        return {
            setFilter: (patch) => {
                this.#setFilter(patch);
            },
            more: () => {
                this.#list.more();
            },
            retry: () => {
                this.#retry();
            },
            add: (shape) => this.#add(shape),
            toggleSelected: (id) => {
                this.#toggle(id);
            },
            selectAll: () => {
                this.#selectAll();
            },
            clearSelection: () => {
                this.#cell.update({ selection: [] });
            },
            bulk: (action) => this.#bulk(action),
            loadPhotos: () => {
                this.#loadPhotos();
            },
        };
    }

    #editorIntents(): Omit<PoisIntents, ListIntent | FileIntent> {
        return {
            edit: (patch) => {
                this.#editor?.edit(patch);
            },
            setTool: (tool) => {
                this.#map.setMode(tool);
            },
            redraw: (shape) => {
                this.#editor?.redraw(shape);
            },
            selectVertex: (index) => {
                this.#editor?.selectVertex(index);
            },
            editVertex: (edit) => this.#editor?.editVertex(edit) === true,
            addAtCentre: () => this.#addAtCentre(),
            undoLastVertex: () => this.#editor?.undoLastVertex() === true,
            save: () => this.#save(),
            discard: () => {
                this.#editor?.discard();
            },
            keepMine: () => {
                this.#editor?.keepMine();
            },
            takeTheirs: () => {
                this.#editor?.takeTheirs();
            },
            remove: () => this.#remove(),
        };
    }

    #fileIntents(): Pick<PoisIntents, FileIntent> {
        return {
            chooseImport: (file) => this.#importer.choose(file, this.#cell.state.filter.category),
            setImportCategory: (category) => {
                this.#importer.setCategory(category);
            },
            commitImport: () => this.#importer.commit(),
            closeImport: () => {
                this.#importer.close();
            },
            exportPlaces: (only) => this.#export(only),
            attachMap: (container) => {
                this.#map.attach(container);
            },
            detachMap: () => {
                this.#map.detach();
            },
            zoomBy: (delta) => {
                this.#map.zoomBy(delta);
            },
        };
    }
}

export const POIS_MODULE: AreaModule<PoisState, PoisIntents> = {
    area: 'pois',
    create: (services) => new PoisStore(services),
};
