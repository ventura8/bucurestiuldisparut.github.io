/**
 * The photo editor's draft (`docs/research/M2c-interfaces.md` §5.1, §5.3, §6.3; behaviour A38 for photos): every edit
 * changes the draft only (the page's map previews it), Save writes the changed fields in one transaction that refuses a
 * document another admin changed meanwhile. A snapshot that arrives while editing merges the fields the draft does not
 * change; one that changed a field the draft changed too raises the conflict, which the admin resolves (keep mine or
 * take theirs), never a silent overwrite. The whole document is validated with `photoDocSchema` before anything is sent,
 * and the place against the city. The editing kit's generic `DraftEditor` (ops-screens) may replace this class once it
 * lands; the behaviour is the contract's.
 */
import { FIRESTORE_PATHS, photoDocSchema, validate, type BBox, type PhotoDoc, type ValidationIssue } from '@hcm/shared';

import { insideCity } from './autofill.js';
import { publishBlock } from './model.js';
import type { ContentStore, Stored, WriteOutcome } from '../content/services.js';

/** The fields the editor changes (`CLIENT_WRITES.photo.update` without the stamp and `legacyId`). */
const PHOTO_EDITABLE = [
    'title',
    'description',
    'dateText',
    'year',
    'yearEnd',
    'author',
    'license',
    'rightsHolder',
    'sourceUrl',
    'sourceLabel',
    'permissionNote',
    'links',
    'location',
    'bearing',
    'fov',
    'published',
    'rightsReview',
] as const;

export type PhotoEditable = (typeof PHOTO_EDITABLE)[number];

export type PhotoValue = Pick<PhotoDoc, PhotoEditable>;

/** A change the editor sends; `undefined` clears an optional field. */
export type PhotoPatch = { readonly [K in PhotoEditable]?: PhotoValue[K] | undefined };

export interface DraftConflict {
    readonly by: string;
    readonly at: string;
    readonly fields: readonly PhotoEditable[];
}

export interface PhotoDraftState {
    readonly id: string;
    /** The first snapshot has arrived (before it, the editor shows its loading state). */
    readonly loaded: boolean;
    readonly base: Stored<PhotoDoc> | null;
    readonly value: PhotoValue | null;
    readonly dirty: readonly PhotoEditable[];
    /** The admin changed something (a preset such as publish on save alone is not an unsaved edit). */
    readonly touched: boolean;
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    readonly conflict: DraftConflict | null;
    /** Deleted elsewhere while open: Save is off. */
    readonly gone: boolean;
}

export interface PhotoDraftDeps {
    readonly store: Pick<ContentStore, 'update'>;
    readonly cityId: string;
    readonly bounds: () => BBox | null;
    /** What the draft starts with on top of the stored photo while untouched (Published on for a new photo, §5.4). */
    readonly preset: (photo: Stored<PhotoDoc>) => PhotoPatch;
    readonly changed: (state: PhotoDraftState) => void;
}

/** A stable text of a value, keys sorted, so two equal objects compare equal whatever their key order. */
function canonical(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(canonical).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const entries = Object.entries(value).filter(([, field]) => field !== undefined);
        return `{${entries
            .toSorted(([a], [b]) => a.localeCompare(b))
            .map(([key, field]) => `${key}:${canonical(field)}`)
            .join(',')}}`;
    }
    return JSON.stringify(value);
}

export function sameValue(a: unknown, b: unknown): boolean {
    return canonical(a) === canonical(b);
}

/** The editable fields of a photo, absent ones left out. */
export function valueOf(photo: PhotoDoc): PhotoValue {
    const entries = PHOTO_EDITABLE.flatMap((field) => (photo[field] === undefined ? [] : [[field, photo[field]] as const]));
    return Object.fromEntries(entries) as PhotoValue;
}

/** `value` with `patch` applied; an `undefined` in the patch removes the field. */
export function patched(value: PhotoValue, patch: PhotoPatch): PhotoValue {
    const merged: Record<string, unknown> = { ...value, ...patch };
    return Object.fromEntries(Object.entries(merged).filter(([, field]) => field !== undefined)) as PhotoValue;
}

/** The fields where `value` differs from `photo`. */
function changedFields(value: PhotoValue, photo: PhotoDoc): PhotoEditable[] {
    return PHOTO_EDITABLE.filter((field) => !sameValue(value[field], photo[field]));
}

function placeIssues(value: PhotoValue, bounds: BBox | null): ValidationIssue[] {
    return bounds === null || insideCity(value.location, bounds) ? [] : [{ path: 'location', code: 'validation.outsideCity' }];
}

/** Published needs a processed image and a known licence (the rules' publish gate). */
function publishIssues(base: Stored<PhotoDoc>, value: PhotoValue): ValidationIssue[] {
    return value.published && publishBlock({ ...base.data, license: value.license }, false) !== null
        ? [{ path: 'published', code: 'validation.value' }]
        : [];
}

/** The whole document as it would be stored, validated, plus the place inside the city and the publish gate. */
export function draftIssues(base: Stored<PhotoDoc>, value: PhotoValue, bounds: BBox | null): readonly ValidationIssue[] {
    const kept = Object.fromEntries(Object.entries(base.data).filter(([field]) => !(PHOTO_EDITABLE as readonly string[]).includes(field)));
    const result = validate(photoDocSchema, { ...kept, ...value });
    return [...(result.ok ? [] : result.issues), ...placeIssues(value, bounds), ...publishIssues(base, value)];
}

export class PhotoDraft {
    readonly #deps: PhotoDraftDeps;
    #state: PhotoDraftState;

    constructor(id: string, deps: PhotoDraftDeps) {
        this.#deps = deps;
        this.#state = {
            id,
            loaded: false,
            base: null,
            value: null,
            dirty: [],
            touched: false,
            issues: [],
            saving: false,
            conflict: null,
            gone: false,
        };
    }

    get state(): PhotoDraftState {
        return this.#state;
    }

    /** A new snapshot of the photo (null: it does not exist, or no longer). */
    rebase(remote: Stored<PhotoDoc> | null): void {
        if (remote === null) {
            this.#lost();
            return;
        }
        const following = !this.#state.touched || this.#state.value === null;
        this.#set(following ? this.#follow(remote) : this.#merge(remote));
    }

    /** Untouched: the draft is the stored photo (plus the preset). */
    #follow(remote: Stored<PhotoDoc>): Partial<PhotoDraftState> {
        return { loaded: true, base: remote, gone: false, value: patched(valueOf(remote.data), this.#deps.preset(remote)), conflict: null };
    }

    /**
     * Touched: the stored photo becomes the base; the fields the draft did not change take the stored values (another
     * admin's change merges in, never reverted by the next Save); overlapping changes are a conflict.
     */
    #merge(remote: Stored<PhotoDoc>): Partial<PhotoDraftState> {
        const { base, value } = this.#state;
        const mine = base === null || value === null ? [] : changedFields(value, base.data);
        const kept = Object.fromEntries(mine.map((field) => [field, value?.[field]])) as PhotoPatch;
        return {
            ...{ loaded: true, base: remote, gone: false, value: patched(valueOf(remote.data), kept) },
            conflict: this.#conflictWith(base, remote) ?? this.#state.conflict,
        };
    }

    /** No document: never was one (not found), or it was deleted while open (gone, the draft kept on screen). */
    #lost(): void {
        const previous = this.#state.base;
        this.#set({
            loaded: true,
            base: null,
            gone: previous !== null || this.#state.gone,
            value: previous === null ? null : this.#state.value,
        });
    }

    /** The fields another admin changed that this draft changed to something else. */
    #conflictWith(previous: Stored<PhotoDoc> | null, remote: Stored<PhotoDoc>): DraftConflict | null {
        const value = this.#state.value;
        if (previous === null || value === null) {
            return null;
        }
        const mine = new Set(changedFields(value, previous.data));
        const fields = changedFields(valueOf(remote.data), previous.data).filter(
            (field) => mine.has(field) && !sameValue(value[field], remote.data[field]),
        );
        return fields.length === 0 ? null : { by: remote.data.updatedBy, at: remote.version, fields };
    }

    edit(patch: PhotoPatch): void {
        if (this.#state.value !== null) {
            this.#set({ value: patched(this.#state.value, patch), touched: true });
        }
    }

    /** Back to the stored photo. */
    discard(): void {
        const base = this.#state.base;
        this.#set({ value: base === null ? null : valueOf(base.data), touched: false, conflict: null });
    }

    /** Keeps the draft's values over the other admin's (the next Save writes them over the newer version). */
    keepMine(): void {
        this.#set({ conflict: null });
    }

    /** Takes the other admin's values of the conflicting fields. */
    takeTheirs(): void {
        const { base, value, conflict } = this.#state;
        if (base === null || value === null || conflict === null) {
            return;
        }
        const theirs = Object.fromEntries(conflict.fields.map((field) => [field, base.data[field]])) as PhotoPatch;
        this.#set({ value: patched(value, theirs), conflict: null });
    }

    /** Writes the changed fields (§5.3); the outcome says why nothing was written. */
    async save(): Promise<WriteOutcome> {
        const target = this.#target();
        if (target === null) {
            return { ok: false, reason: 'gone' };
        }
        if (this.#state.issues.length > 0) {
            return { ok: false, reason: 'invalid', issues: this.#state.issues };
        }
        if (this.#state.conflict !== null) {
            return { ok: false, reason: 'conflict' };
        }
        const fields = Object.fromEntries(this.#state.dirty.map((field) => [field, target.value[field]]));
        this.#set({ saving: true });
        const outcome = await this.#deps.store.update(
            FIRESTORE_PATHS.photo(this.#deps.cityId, target.base.id),
            fields,
            target.base.version,
        );
        this.#saved(outcome);
        return outcome;
    }

    /** The stored photo and the draft, while the photo exists. */
    #target(): { readonly base: Stored<PhotoDoc>; readonly value: PhotoValue } | null {
        const { base, value, gone } = this.#state;
        return base === null || value === null || gone ? null : { base, value };
    }

    #saved(outcome: WriteOutcome): void {
        if (outcome.ok) {
            this.#set({ saving: false, touched: false });
            return;
        }
        const base = this.#state.base;
        const conflict =
            outcome.reason === 'conflict' && base !== null
                ? { by: base.data.updatedBy, at: base.version, fields: this.#state.dirty }
                : null;
        this.#set({ saving: false, gone: outcome.reason === 'gone', conflict, issues: outcome.issues ?? this.#state.issues });
    }

    #set(patch: Partial<PhotoDraftState>): void {
        const next = { ...this.#state, ...patch };
        const { base, value } = next;
        const derived =
            base === null || value === null
                ? { dirty: [], issues: [] }
                : { dirty: changedFields(value, base.data), issues: draftIssues(base, value, this.#deps.bounds()) };
        this.#state = { ...next, ...derived, issues: patch.issues ?? derived.issues };
        this.#deps.changed(this.#state);
    }
}
