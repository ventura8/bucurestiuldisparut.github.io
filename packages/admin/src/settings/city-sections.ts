/**
 * The three settings sections that edit the city document (`docs/research/M2c-interfaces.md` §8.5): `area`, `texts` and
 * `theme`, each its own draft over its own fields with its own Save. The area's Save first reads the photos and places
 * when the bounds shrink and refuses bounds that would leave any of them out (they are listed); the theme's seed is
 * turned into the four schemes at once, previewed on the whole admin by the page, and moved to the nearest passing tone
 * when its schemes fail the contrast check.
 */
import {
    FIRESTORE_PATHS,
    MAX_PHOTOS,
    MAX_POIS,
    cityDocSchema,
    photoDocSchema,
    poiDocSchema,
    type CityDoc,
    type Credit,
    type Locale,
    type ThemeTokens,
    type ValidationIssue,
} from '@hcm/shared';

import type { ContentServices, Stored, WriteOutcome } from '../content/services.js';
import { EditDraft, EMPTY_DRAFT, type DraftState } from '../layers/draft.js';
import { AREA_FIELDS, areaIssues, areaNumberPatch, boundsGrow, contentOutside, type AreaNumberField, type Outside } from './area.js';
import { withOptionalText, withText } from './localized.js';
import { readOnce } from './read-once.js';
import { markdownLinesOf, NO_LINK_LINES, TEXT_FIELDS, type MarkdownLines } from './texts.js';
import { seedTheme, type ThemeTools } from './theme.js';

export const CITY_SECTIONS = ['area', 'texts', 'theme'] as const;

export type CitySection = (typeof CITY_SECTIONS)[number];

const SECTION_FIELDS: Readonly<Record<CitySection, readonly (keyof CityDoc)[]>> = {
    area: AREA_FIELDS,
    texts: TEXT_FIELDS,
    theme: ['theme', 'basemap'],
};

interface ThemeDraft {
    /** The seed as typed (the field shows it while it is no colour yet). */
    readonly typed: string;
    /** The typed text is no `#rrggbb`. */
    readonly invalid: boolean;
    /** The typed seed failed the contrast check: the theme uses the nearest passing tone. */
    readonly adjusted: boolean;
    /** The tokens the whole admin previews (null: the city's own). */
    readonly preview: ThemeTokens | null;
}

export interface CitySectionState {
    readonly section: CitySection | null;
    readonly draft: DraftState<CityDoc>;
    /** What smaller bounds would leave out (the area's Save is refused while there is any). */
    readonly outside: readonly Outside[];
    /** The area's Save is reading the photos and places. */
    readonly checking: boolean;
    readonly theme: ThemeDraft;
    /** The lines of About and the privacy notice, per language, whose links are not https (the texts section names them). */
    readonly linkLines: MarkdownLines;
}

const NO_THEME: ThemeDraft = { typed: '', invalid: false, adjusted: false, preview: null };

export const NO_CITY_SECTION: CitySectionState = {
    section: null,
    draft: EMPTY_DRAFT,
    outside: [],
    checking: false,
    theme: NO_THEME,
    linkLines: NO_LINK_LINES,
};

export class CitySections {
    readonly #services: ContentServices;
    readonly #tools: ThemeTools;
    readonly #changed: (state: CitySectionState) => void;
    #state: CitySectionState = NO_CITY_SECTION;
    #draft: EditDraft<CityDoc> | null = null;
    #city: Stored<CityDoc> | null = null;

    constructor(services: ContentServices, tools: ThemeTools, changed: (state: CitySectionState) => void) {
        this.#services = services;
        this.#tools = tools;
        this.#changed = changed;
    }

    get state(): CitySectionState {
        return this.#state;
    }

    get unsaved(): boolean {
        return this.#draft?.unsaved ?? false;
    }

    /** Opens `section` (null: none) over the city as last read. */
    open(section: CitySection | null): void {
        if (section === this.#state.section) {
            return;
        }
        this.#draft = section === null ? null : this.#newDraft(section);
        this.#set({ ...NO_CITY_SECTION, section });
        this.#draft?.load(this.#city);
    }

    /** A snapshot of the city (null: missing). */
    load(city: Stored<CityDoc> | null): void {
        this.#city = city;
        this.#draft?.load(city);
    }

    edit(patch: Partial<CityDoc>): void {
        this.#draft?.edit(patch);
        if ('bounds' in patch) {
            this.#set({ ...this.#state, outside: [] });
        }
    }

    /** The credits changed by `change` (the texts section). */
    editCredits(change: (credits: CityDoc['credits']) => Credit[]): void {
        const city = this.#draft?.state.value ?? null;
        if (city !== null) {
            this.edit({ credits: change(city.credits) });
        }
    }

    /** The name, About or privacy text in one language (an empty English text is removed; so is an empty optional text). */
    setText(field: 'name' | 'about' | 'privacy', locale: Locale, text: string): void {
        const city = this.#draft?.state.value ?? null;
        if (city === null) {
            return;
        }
        this.edit(
            field === 'name' ? { name: withText(city.name, locale, text) } : { [field]: withOptionalText(city[field], locale, text) },
        );
    }

    /** A number of the area as typed (an edge, the centre, a zoom). */
    setNumber(field: AreaNumberField, text: string): void {
        const city = this.#draft?.state.value ?? null;
        if (city !== null) {
            this.edit(areaNumberPatch(city, field, text));
        }
    }

    /** The theme's seed as typed: a colour makes the four schemes at once (or the nearest passing tone's). */
    setSeed(typed: string): void {
        const made = seedTheme(typed, this.#tools);
        if (made === null) {
            this.#set({ ...this.#state, theme: { ...this.#state.theme, typed, invalid: true } });
            return;
        }
        this.#set({ ...this.#state, theme: { typed, invalid: false, adjusted: made.adjusted, preview: made.theme.tokens } });
        this.#draft?.edit({ theme: made.theme });
    }

    discard(): void {
        this.#draft?.discard();
        this.#set({ ...this.#state, outside: [], theme: NO_THEME });
    }

    keepMine(): void {
        this.#draft?.keepMine();
    }

    takeTheirs(): void {
        this.#draft?.takeTheirs();
    }

    async save(): Promise<WriteOutcome | null> {
        const draft = this.#draft;
        if (draft === null) {
            return null;
        }
        const refused = await this.#refusedBounds(draft);
        return refused ?? this.#saved(await draft.save());
    }

    /** A saved theme becomes the city's own: the preview ends (the shell wears the city's new tokens). */
    #saved(outcome: WriteOutcome | null): WriteOutcome | null {
        if (outcome?.ok === true) {
            this.#set({ ...this.#state, theme: NO_THEME });
        }
        return outcome;
    }

    #newDraft(section: CitySection): EditDraft<CityDoc> {
        const check = section === 'area' ? areaIssues : undefined;
        const spec = { path: FIRESTORE_PATHS.city(this.#services.cityId), schema: cityDocSchema, editable: SECTION_FIELDS[section] };
        return new EditDraft<CityDoc>(check === undefined ? spec : { ...spec, check }, {
            store: this.#services.store,
            changed: (draft) => {
                this.#set({ ...this.#state, draft });
            },
        });
    }

    /** Smaller bounds: the photos and places they would leave out refuse the save (null: none, or the bounds grew). */
    async #refusedBounds(draft: EditDraft<CityDoc>): Promise<WriteOutcome | null> {
        const smaller = this.#smallerBounds(draft);
        if (smaller === null) {
            return null;
        }
        this.#set({ ...this.#state, checking: true });
        const outside = await this.#outside(smaller);
        this.#set({ ...this.#state, checking: false, outside });
        const issues: ValidationIssue[] = [{ path: 'bounds', code: 'validation.outsideCity' }];
        return outside.length === 0 ? null : { ok: false, reason: 'invalid', issues };
    }

    /** The area's draft when its bounds no longer hold the saved ones (null otherwise, or in another section). */
    #smallerBounds(draft: EditDraft<CityDoc>): CityDoc | null {
        const { base, value } = draft.state;
        if (this.#state.section !== 'area' || base === null || value === null) {
            return null;
        }
        return boundsGrow(base.data.bounds, value.bounds) ? null : value;
    }

    async #outside(city: CityDoc): Promise<Outside[]> {
        const { store, cityId } = this.#services;
        const [photos, pois] = await Promise.all([
            readOnce(store, FIRESTORE_PATHS.photos(cityId), photoDocSchema, { limit: MAX_PHOTOS }),
            readOnce(store, FIRESTORE_PATHS.pois(cityId), poiDocSchema, { limit: MAX_POIS }),
        ]);
        return contentOutside(city.bounds, photos?.docs ?? [], pois?.docs ?? []);
    }

    #set(state: CitySectionState): void {
        this.#state = { ...state, linkLines: markdownLinesOf(state.draft.value) };
        this.#changed(this.#state);
    }
}
