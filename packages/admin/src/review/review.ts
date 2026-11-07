/**
 * The review queue's store (M13, `docs/research/M13-roles.md` §§2 to 4, §8; behaviours A90, A92, A93): what uploaders added,
 * the public's suggestions and, for the city's owners, requests for a role, each live; approve, adjust, reject, refuse, block
 * and one-click revert through the callables. The rules let the reviewers read these and the server alone write them.
 */
import {
    FIRESTORE_PATHS,
    cityDocSchema,
    historyEntryDocSchema,
    photoDocSchema,
    poiDocSchema,
    roleRequestDocSchema,
    suggestionDocSchema,
    bboxFromRecord,
    bboxCenter,
    type CallableRequest,
    type CallableResponse,
    type Schema,
    type BBox,
    type SuggestionProposal,
} from '@hcm/shared';

import { outcomeOf, type Outcome } from '../app/services.js';
import type { AreaModule, AreaStore } from '../content/areas.js';
import { LOADING_LIST, LiveList, type ListState } from '../content/list.js';
import { readOnce } from '../content/read-once.js';
import type { ContentQuery, ContentServices, Stored } from '../content/services.js';
import { PhotoMapSession, type MapStatus } from '../photos/map.js';
import { Store } from '../state/store.js';
import {
    currentMarker,
    currentOf,
    photoItem,
    poiItem,
    requestRow,
    suggestionRow,
    type ReviewItem,
    type ReviewRequest,
    type ReviewSuggestion,
} from './rows.js';

export interface ReviewState {
    readonly photos: ListState<ReviewItem>;
    readonly places: ListState<ReviewItem>;
    readonly suggestions: ListState<ReviewSuggestion>;
    readonly decided: ListState<ReviewSuggestion>;
    readonly requests: ListState<ReviewRequest> | null;
    readonly pictures: Readonly<Record<string, string>>;
    readonly selected: string | null;
    readonly current: SuggestionProposal | null;
    readonly adjusted: SuggestionProposal | null;
    readonly map: MapStatus;
    readonly busy: boolean;
}

export interface ReviewIntents {
    retry(): void;
    decideItem(item: ReviewItem, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>>;
    select(suggestionId: string): void;
    startAdjusting(): void;
    decideSuggestion(id: string, decision: 'approve' | 'adjust' | 'reject', note: string): Promise<Outcome<unknown>>;
    block(uid: string): Promise<Outcome<unknown>>;
    revert(suggestion: ReviewSuggestion): Promise<Outcome<unknown>>;
    decideRequest(uid: string, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>>;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
}

const NEWEST: NonNullable<ContentQuery['orderBy']> = [['updatedAt', 'desc']];
const PENDING: ContentQuery = { where: [['reviewStatus', '==', 'pending']], orderBy: NEWEST };
const OPEN: ContentQuery = { where: [['status', '==', 'pending']], orderBy: NEWEST };
const APPLIED: ContentQuery = { where: [['status', 'in', ['approved', 'adjusted']]], orderBy: NEWEST, limit: 10 };
const ZOOM = 14;

interface ReviewLists {
    show(): void;
    stop(): void;
    retry(): void;
}

class ReviewStore implements AreaStore<ReviewState, ReviewIntents> {
    readonly #services: ContentServices;
    readonly #cell: Store<ReviewState>;
    readonly #lists: ReviewLists;
    #map: PhotoMapSession | null = null;
    #stopPhoto: (() => void) | null = null;
    #stopCity: (() => void) | null = null;
    #bounds: BBox | null = null;
    #container: HTMLElement | null = null;
    readonly intents: ReviewIntents;

    constructor(services: ContentServices) {
        this.#services = services;
        this.#cell = new Store<ReviewState>(
            {
                photos: LOADING_LIST,
                places: LOADING_LIST,
                suggestions: LOADING_LIST,
                decided: LOADING_LIST,
                requests: services.cityRole() === 'owner' ? LOADING_LIST : null,
                pictures: {},
                selected: null,
                current: null,
                adjusted: null,
                map: 'none',
                busy: false,
            },
            services.log,
        );
        this.#lists = this.#makeLists();
        this.intents = this.#makeIntents();
    }

    #makeIntents(): ReviewIntents {
        return {
            retry: () => {
                this.#lists.retry();
            },
            decideItem: (item, decision, note) => this.#decideItem(item, decision, note),
            select: (id) => {
                this.#select(id);
            },
            startAdjusting: () => {
                this.#startAdjusting();
            },
            decideSuggestion: (id, decision, note) => this.#decideSuggestion(id, decision, note),
            block: (uid) =>
                this.#call('contributors.setBlocked', { cityId: this.#services.cityId, uid, blocked: true }, 'adminContent.review.blocked'),
            revert: (suggestion) => this.#revert(suggestion),
            decideRequest: (uid, decision, note) => this.#decideRequest(uid, decision, note),
            attachMap: (container) => {
                this.#container = container;
                this.#attach();
            },
            zoomBy: (delta) => {
                this.#map?.zoomBy(delta);
            },
        };
    }

    #list<Doc, Item>(
        collection: string,
        schema: Schema<Doc>,
        map: (doc: Stored<Doc>) => Item,
        changed: (list: ListState<Item>) => void,
    ): LiveList<Doc, Item> {
        const { store, clock, denied } = this.#services;
        return new LiveList({ store, clock, denied, schema, map, collection, changed });
    }

    #makeLists(): ReviewLists {
        const city = this.#services.cityId;
        const photos = this.#list(FIRESTORE_PATHS.photos(city), photoDocSchema, photoItem, (list) => {
            this.#cell.update({ photos: list });
            void this.#readPictures(list.items);
        });
        const places = this.#list(FIRESTORE_PATHS.pois(city), poiDocSchema, poiItem, (list) => {
            this.#cell.update({ places: list });
        });
        const open = this.#list(FIRESTORE_PATHS.suggestions(city), suggestionDocSchema, suggestionRow, (list) => {
            this.#cell.update({ suggestions: list });
        });
        const decided = this.#list(FIRESTORE_PATHS.suggestions(city), suggestionDocSchema, suggestionRow, (list) => {
            this.#cell.update({ decided: list });
        });
        const requests =
            this.#cell.state.requests === null
                ? null
                : this.#list(FIRESTORE_PATHS.roleRequests(city), roleRequestDocSchema, requestRow, (list) => {
                      this.#cell.update({ requests: list });
                  });
        return {
            show: () => {
                photos.show(PENDING);
                places.show(PENDING);
                open.show(OPEN);
                decided.show(APPLIED);
                requests?.show(OPEN);
            },
            stop: () => {
                for (const list of [photos, places, open, decided, requests]) {
                    list?.stop();
                }
            },
            retry: () => {
                for (const list of [photos, places, open, decided, requests]) {
                    list?.retry();
                }
            },
        };
    }

    get state(): ReviewState {
        return this.#cell.state;
    }

    subscribe(listener: (state: ReviewState) => void) {
        return this.#cell.subscribe(listener);
    }

    open(): void {
        this.#lists.show();
        this.#stopCity = this.#services.store.watchDoc(
            FIRESTORE_PATHS.city(this.#services.cityId),
            cityDocSchema,
            (doc) => {
                this.#bounds = doc === null ? null : bboxFromRecord(doc.data.bounds);
                this.#attach();
            },
            () => undefined,
        );
    }

    close(): void {
        this.#lists.stop();
        this.#stopPhoto?.();
        this.#stopPhoto = null;
        this.#stopCity?.();
        this.#stopCity = null;
        this.#map?.detach();
        this.#map = null;
        this.#container = null;
        this.#cell.update({ map: 'none', selected: null, current: null, adjusted: null });
    }

    hasUnsavedChanges(): boolean {
        return false;
    }

    destroy(): void {
        this.close();
        for (const url of Object.values(this.#cell.state.pictures)) {
            this.#services.files?.release(url);
        }
    }

    /** A held picture has no public address: its bytes come through the Storage rules, as a `blob:` address. */
    async #readPictures(items: readonly ReviewItem[]): Promise<void> {
        const paths = items.flatMap((item) => (item.thumbPath === null ? [] : [item.thumbPath]));
        for (const path of paths.filter((held) => this.#cell.state.pictures[held] === undefined)) {
            await this.#readPicture(path);
        }
    }

    async #readPicture(path: string): Promise<void> {
        const url = await this.#services.files?.url(path);
        if (url !== null && url !== undefined) {
            this.#cell.update({ pictures: { ...this.#cell.state.pictures, [path]: url } });
        }
    }

    async #call<N extends 'review.decide' | 'suggestions.decide' | 'contributors.setBlocked' | 'contribute.decide'>(
        name: N,
        request: CallableRequest<N>,
        done: 'adminContent.review.done' | 'adminContent.review.blocked',
    ): Promise<Outcome<CallableResponse<N>>> {
        this.#cell.update({ busy: true });
        const outcome = await outcomeOf(() => this.#services.callables.call(name, request));
        this.#cell.update({ busy: false });
        this.#services.notify(outcome.ok ? { key: done } : outcome.error);
        return outcome;
    }

    #decideItem(item: ReviewItem, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>> {
        const request = { cityId: this.#services.cityId, entity: item.entity, id: item.id, decision, ...this.#noted(note) };
        return this.#call('review.decide', request, 'adminContent.review.done');
    }

    #noted(note: string): { readonly note?: string } {
        return note.trim() === '' ? {} : { note: note.trim() };
    }

    #decideRequest(uid: string, decision: 'approve' | 'refuse', note: string): Promise<Outcome<unknown>> {
        return this.#call(
            'contribute.decide',
            { cityId: this.#services.cityId, uid, decision, ...this.#noted(note) },
            'adminContent.review.done',
        );
    }

    #decideSuggestion(id: string, decision: 'approve' | 'adjust' | 'reject', note: string): Promise<Outcome<unknown>> {
        const adjusted = decision === 'adjust' ? (this.#cell.state.adjusted ?? {}) : null;
        const request = {
            cityId: this.#services.cityId,
            suggestionId: id,
            decision,
            ...(adjusted === null ? {} : { adjusted }),
            ...this.#noted(note),
        };
        return this.#call('suggestions.decide', request, 'adminContent.review.done');
    }

    /** The photo's last change by its reviewer, undone with the existing history: the entry the trigger kept is the way back. */
    async #revert(suggestion: ReviewSuggestion): Promise<Outcome<unknown>> {
        const audited = { entity: 'photo', cityId: this.#services.cityId, entityId: suggestion.photoId } as const;
        const answer = await readOnce(this.#services, FIRESTORE_PATHS.history(audited), historyEntryDocSchema, {
            orderBy: NEWEST,
            limit: 5,
        });
        const entry = answer.page?.docs.find((stored) => stored.data.action === 'update' && stored.data.updatedBy === suggestion.decidedBy);
        const outcome = await outcomeOf(() =>
            this.#services.callables.call('history.revert', {
                cityId: audited.cityId,
                entity: 'photo',
                entityId: audited.entityId,
                entryId: entry?.id ?? '',
            }),
        );
        this.#services.notify(outcome.ok ? { key: 'adminContent.review.reverted' } : outcome.error);
        return outcome;
    }

    #selectedRow(): ReviewSuggestion | undefined {
        const { suggestions, selected } = this.#cell.state;
        return suggestions.items.find((row) => row.id === selected);
    }

    /** The map shows the photo as it is and the proposal side by side: a marker, and the pin. */
    #select(id: string): void {
        this.#cell.update({ selected: id, adjusted: null, current: null });
        this.#stopPhoto?.();
        const row = this.#selectedRow();
        if (row === undefined) {
            return;
        }
        this.#stopPhoto = this.#services.store.watchDoc(
            FIRESTORE_PATHS.photo(this.#services.cityId, row.photoId),
            photoDocSchema,
            (doc) => {
                this.#cell.update({ current: doc === null ? null : currentOf(doc.data) });
                this.#draw();
            },
            () => undefined,
        );
    }

    #draw(): void {
        const { current, selected } = this.#cell.state;
        this.#map?.show(currentMarker(selected ?? 'current', current));
        void this.#map?.editPin(this.#proposedPlace());
    }

    #proposedPlace(): NonNullable<SuggestionProposal['location']> | null {
        return this.#selectedRow()?.proposal.location ?? null;
    }

    #startAdjusting(): void {
        this.#cell.update({ adjusted: this.#selectedRow()?.proposal ?? {} });
    }

    /** One map per page visit, once the city and the box are both there. */
    #attach(): void {
        const bounds = this.#bounds;
        const container = this.#container;
        if (bounds === null || container === null || this.#map !== null) {
            return;
        }
        this.#map = new PhotoMapSession(this.#services.maps ?? null, {
            status: (map) => {
                this.#mapStatus(map);
            },
            select: () => undefined,
            pin: (position) => {
                this.#moved({ lat: position[1], lng: position[0] });
            },
            refused: () => {
                this.#services.notify({ key: 'apiError.suggestion.outsideCity' });
            },
        });
        const view = { center: bboxCenter(bounds), zoom: ZOOM, bearing: 0 };
        void this.#map.attach(container, { bounds, view, locale: this.#services.locale() });
    }

    #mapStatus(map: MapStatus): void {
        this.#cell.update({ map });
        if (map === 'ready') {
            this.#draw();
        }
    }

    /** The pin moved: the reviewer is adjusting. */
    #moved(location: NonNullable<SuggestionProposal['location']>): void {
        const adjusted = this.#cell.state.adjusted ?? this.#selectedRow()?.proposal ?? {};
        this.#cell.update({ adjusted: { ...adjusted, location } });
    }
}

export const REVIEW_MODULE: AreaModule<ReviewState, ReviewIntents> = {
    area: 'review',
    create: (services) => new ReviewStore(services),
};
