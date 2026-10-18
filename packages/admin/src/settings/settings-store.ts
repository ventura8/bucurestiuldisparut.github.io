/**
 * The settings area's store (`./settings.ts` holds its state and intents): the city document, the layers and the POI
 * categories as live listeners, and one controller per kind of section, each with its own draft. Only the open section
 * holds edits; the shell's unsaved guard asks before a route change discards them.
 */
import {
    FIRESTORE_PATHS,
    MAX_LAYERS,
    MAX_POI_CATEGORIES,
    cityDocSchema,
    layerDocSchema,
    poiCategoryDocSchema,
    type CityDoc,
    type LayerDoc,
    type PoiCategoryDoc,
} from '@hcm/shared';

import type { AreaStore } from '../content/areas.js';
import { LiveDoc, LOADING_DOC, type DocState } from '../content/doc.js';
import { LiveList, LOADING_LIST } from '../content/list.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { layerItemOf, type LayerItem } from '../layers/model.js';
import { PreviewLayer } from '../layers/preview.js';
import { Store } from '../state/store.js';
import { viewFields } from './area.js';
import { canAdd, categoryItemOf, inOrder, type CategoryItem } from './categories.js';
import { CategoryArea } from './category-area.js';
import { CitySections, NO_CITY_SECTION, type CitySection } from './city-sections.js';
import { NO_OVERLAY_DEFAULTS, OverlayDefaults } from './overlay-defaults.js';
import { photosOpacityOf } from './overlays.js';
import { reportOutcome } from './report.js';
import { settingsRoute, type SettingsRoute } from './sections.js';
import type { SettingsIntents, SettingsState } from './state.js';
import { editedCredits, movedCredit, withCredit, withoutCredit } from './texts.js';
import { basemapFor, type ThemeTools } from './theme.js';

const INITIAL: SettingsState = {
    section: null,
    city: LOADING_DOC,
    citySection: NO_CITY_SECTION,
    layers: LOADING_LIST,
    categories: LOADING_LIST,
    canAddCategory: false,
    category: null,
    categoryDeletion: { phase: 'idle' },
    overlays: NO_OVERLAY_DEFAULTS,
    reordering: false,
};

function isCitySection(section: SettingsRoute['section']): section is CitySection {
    return section === 'area' || section === 'texts' || section === 'theme';
}

export class SettingsStore implements AreaStore<SettingsState, SettingsIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<SettingsState>;
    readonly #city: LiveDoc<CityDoc>;
    readonly #layers: LiveList<LayerDoc, LayerItem>;
    readonly #categories: LiveList<PoiCategoryDoc, CategoryItem>;
    readonly #preview = new PreviewLayer();
    readonly #sections: CitySections;
    readonly #overlays: OverlayDefaults;
    readonly #categoryArea: CategoryArea;
    #open = false;
    readonly intents: SettingsIntents;

    constructor(services: ContentServices, tools: ThemeTools) {
        this.#services = services;
        this.#cell = new Store<SettingsState>(INITIAL, services.log);
        const { store, clock, cityId } = services;
        const denied = (): void => {
            services.denied();
        };
        const listsChanged = (): void => {
            this.#listsChanged();
        };
        this.#city = new LiveDoc({
            ...{ store, clock, denied, schema: cityDocSchema },
            changed: (city) => {
                this.#cityChanged(city);
            },
        });
        this.#layers = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.layers(cityId), schema: layerDocSchema, map: layerItemOf },
            ...{ pageSize: MAX_LAYERS, changed: listsChanged },
        });
        this.#categories = new LiveList({
            ...{ store, clock, denied, collection: FIRESTORE_PATHS.poiCategories(cityId), schema: poiCategoryDocSchema },
            ...{ map: categoryItemOf, pageSize: MAX_POI_CATEGORIES + 1, changed: listsChanged },
        });
        this.#sections = new CitySections(services, tools, (citySection) => {
            this.#cell.update({ citySection });
        });
        this.#overlays = new OverlayDefaults(services, this.#preview, (overlays) => {
            this.#cell.update({ overlays });
        });
        this.#categoryArea = new CategoryArea({
            ...{ services, preview: this.#preview },
            changed: (patch) => {
                this.#cell.update(patch);
            },
            categories: () => this.#cell.state.categories.items,
            taken: () => [...this.#cell.state.layers.items, ...this.#cell.state.categories.items].map((item) => item.id),
        });
        this.intents = { ...this.#cityIntents(), ...this.#creditIntents(), ...this.#categoryArea.intents, ...this.#otherIntents() };
    }

    get state(): SettingsState {
        return this.#cell.state;
    }

    subscribe(listener: (state: SettingsState) => void): () => void {
        return this.#cell.subscribe(listener);
    }

    open(params: readonly string[]): void {
        if (!this.#open) {
            this.#open = true;
            this.#city.show(FIRESTORE_PATHS.city(this.#services.cityId));
            this.#layers.show({ orderBy: [['order', 'desc']] });
            this.#categories.show({ orderBy: [['order', 'asc']] });
        }
        this.#route(settingsRoute(params));
    }

    close(): void {
        this.#open = false;
        this.#route({ section: null, category: null });
        this.#city.stop();
        this.#layers.stop();
        this.#categories.stop();
    }

    hasUnsavedChanges(): boolean {
        return this.#sections.unsaved || this.#overlays.unsaved || this.#categoryArea.unsaved;
    }

    destroy(): void {
        this.close();
        this.#preview.attach(null);
    }

    #cityIntents(): Pick<
        SettingsIntents,
        | 'editCity'
        | 'setNumber'
        | 'setText'
        | 'useView'
        | 'setSeed'
        | 'setBasemap'
        | 'saveSection'
        | 'discardSection'
        | 'keepMine'
        | 'takeTheirs'
    > {
        const sections = this.#sections;
        return {
            editCity: (patch) => {
                sections.edit(patch);
            },
            setNumber: (field, text) => {
                sections.setNumber(field, text);
            },
            setText: (field, locale, text) => {
                sections.setText(field, locale, text);
            },
            useView: (view) => {
                sections.edit(viewFields(view));
            },
            setSeed: (typed) => {
                sections.setSeed(typed);
            },
            setBasemap: (choice) => {
                sections.edit({ basemap: basemapFor(choice, sections.state.draft.value?.basemap) });
            },
            saveSection: () => this.#reported(sections.save()),
            discardSection: () => {
                sections.discard();
            },
            keepMine: () => {
                sections.keepMine();
                this.#categoryArea.keepMine();
            },
            takeTheirs: () => {
                sections.takeTheirs();
                this.#categoryArea.takeTheirs();
            },
        };
    }

    #creditIntents(): Pick<SettingsIntents, 'addCredit' | 'removeCredit' | 'moveCredit' | 'editCredit'> {
        const sections = this.#sections;
        return {
            addCredit: () => {
                sections.editCredits(withCredit);
            },
            removeCredit: (row) => {
                sections.editCredits((credits) => withoutCredit(credits, row));
            },
            moveCredit: (row, by) => {
                sections.editCredits((credits) => movedCredit(credits, row, by));
            },
            editCredit: (row, field, text) => {
                sections.editCredits((credits) => editedCredits(credits, row, field, text));
            },
        };
    }

    #otherIntents(): Pick<
        SettingsIntents,
        'retry' | 'setOverlayOpacity' | 'setShownAtStart' | 'saveOverlays' | 'discardOverlays' | 'attachPreview'
    > {
        const overlays = this.#overlays;
        return {
            retry: () => {
                this.#retry();
            },
            setOverlayOpacity: (kind, id, percent) => {
                overlays.setOpacity(kind, id, percent);
            },
            setShownAtStart: (id, visible) => {
                overlays.setShownAtStart(id, visible);
            },
            saveOverlays: () => this.#reported(overlays.save()),
            discardOverlays: () => {
                overlays.discard();
            },
            attachPreview: (sink) => {
                this.#preview.attach(sink);
            },
        };
    }

    async #reported(write: Promise<WriteOutcome | null>): Promise<WriteOutcome | null> {
        const outcome = await write;
        reportOutcome(this.#services, outcome);
        return outcome;
    }

    #route(route: SettingsRoute): void {
        this.#cell.update({ section: route.section });
        this.#sections.open(isCitySection(route.section) ? route.section : null);
        if (route.section !== 'overlays') {
            this.#overlays.discard();
        }
        this.#categoryArea.open(route.category);
    }

    #cityChanged(city: DocState<CityDoc>): void {
        this.#cell.update({ city });
        if (city.status === 'ready') {
            this.#sections.load(city.doc);
            this.#listsChanged();
        }
    }

    #listsChanged(): void {
        const layers = this.#layers.list;
        const categories = { ...this.#categories.list, items: inOrder(this.#categories.list.items) };
        this.#cell.update({ layers, categories, canAddCategory: categories.status === 'ready' && canAdd(categories.items.length) });
        const photos = photosOpacityOf(this.#city.state.doc?.data ?? null);
        this.#overlays.setBase({ layers: layers.items, categories: categories.items, photos });
    }

    #retry(): void {
        this.#city.retry();
        this.#layers.retry();
        this.#categories.retry();
        this.#categoryArea.retry();
    }
}
