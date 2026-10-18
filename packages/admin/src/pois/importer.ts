/**
 * The import dialog's session (docs/research/M2c-interfaces.md §7.4; behaviour A34): a file is checked for size before
 * it is read, parsed and planned in the page (a dry run: nothing is written while the preview shows), planned again when
 * the admin chooses the category for features without a known one, and written on Import in batches of at most
 * `MAX_BATCH_WRITES`, new places with new ids, every write stamped by the store. The total after the import may not pass
 * `MAX_POIS`, checked before the first write.
 */
import { FIRESTORE_PATHS, MAX_POIS } from '@hcm/shared';

import { MAX_BATCH_WRITES, type BatchWrite, type ContentStore } from '../content/services.js';
import { MAX_IMPORT_BYTES, planImport, readFeatures, type ImportContext, type ImportFileRefusal, type ImportPlan } from './geojson.js';
import { docFieldsOf } from './model.js';

/** A chosen file, as the page hands it over (a `File` is one). */
export interface ImportFile {
    readonly name: string;
    readonly size: number;
    text(): Promise<string>;
}

type ImportRefusalOfFile = ImportFileRefusal | 'too-many' | 'unreadable';

export interface ImportState {
    readonly status: 'reading' | 'refused' | 'preview' | 'writing' | 'done' | 'failed';
    readonly fileName: string;
    readonly refusal: ImportRefusalOfFile | null;
    readonly plan: ImportPlan | null;
    readonly fallbackCategory: string | null;
    /** Places written so far (created and updated). */
    readonly written: number;
}

export interface ImporterDeps {
    readonly store: Pick<ContentStore, 'batch' | 'newId' | 'count'>;
    readonly cityId: string;
    readonly context: () => Omit<ImportContext, 'fallbackCategory'>;
    readonly changed: (state: ImportState | null) => void;
}

function batches<T>(items: readonly T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

export class Importer {
    readonly #deps: ImporterDeps;
    #features: readonly unknown[] = [];
    #state: ImportState | null = null;

    constructor(deps: ImporterDeps) {
        this.#deps = deps;
    }

    get state(): ImportState | null {
        return this.#state;
    }

    #set(state: ImportState | null): void {
        this.#state = state;
        this.#deps.changed(state);
    }

    #update(patch: Partial<ImportState>): void {
        if (this.#state !== null) {
            this.#set({ ...this.#state, ...patch });
        }
    }

    async choose(file: ImportFile, fallbackCategory: string | null): Promise<void> {
        const base = { fileName: file.name, plan: null, fallbackCategory, written: 0 };
        if (file.size > MAX_IMPORT_BYTES) {
            this.#set({ ...base, status: 'refused', refusal: 'too-big' });
            return;
        }
        this.#set({ ...base, status: 'reading', refusal: null });
        const read = await file.text().then(readFeatures, () => ({ ok: false, reason: 'unreadable' }) as const);
        if (!read.ok) {
            this.#update({ status: 'refused', refusal: read.reason });
            return;
        }
        this.#features = read.features;
        this.#plan(fallbackCategory);
    }

    /** The plan (again, when the category for uncategorised features changes). */
    #plan(fallbackCategory: string | null): void {
        const plan = planImport(this.#features, { ...this.#deps.context(), fallbackCategory });
        this.#update({ status: 'preview', plan, fallbackCategory });
    }

    setCategory(category: string): void {
        if (this.#state?.status === 'preview') {
            this.#plan(category);
        }
    }

    /** Writes the plan; the outcome is the state (`done`, `failed`, or `refused` with `too-many`). */
    async commit(): Promise<void> {
        const plan = this.#state?.status === 'preview' ? this.#state.plan : null;
        if (plan === null) {
            return;
        }
        this.#update({ status: 'writing' });
        if (!(await this.#roomFor(plan.created.length))) {
            this.#update({ status: 'refused', refusal: 'too-many' });
            return;
        }
        await this.#write(this.#writesOf(plan));
    }

    async #roomFor(created: number): Promise<boolean> {
        const count = await this.#deps.store.count(FIRESTORE_PATHS.pois(this.#deps.cityId), {});
        return count !== null && count + created <= MAX_POIS;
    }

    #writesOf(plan: ImportPlan): BatchWrite[] {
        const { cityId, store } = this.#deps;
        const created = plan.created.map((place): BatchWrite => ({
            kind: 'create',
            path: FIRESTORE_PATHS.poi(cityId, store.newId()),
            data: docFieldsOf(place.value),
            withCreator: true,
        }));
        const updated = plan.updated.map((place): BatchWrite => ({
            kind: 'update',
            path: FIRESTORE_PATHS.poi(cityId, place.id),
            fields: docFieldsOf(place.value),
        }));
        return [...created, ...updated];
    }

    async #write(writes: readonly BatchWrite[]): Promise<void> {
        let written = 0;
        for (const batch of batches(writes, MAX_BATCH_WRITES)) {
            const outcome = await this.#deps.store.batch(batch);
            if (!outcome.ok) {
                this.#update({ status: 'failed', written });
                return;
            }
            written += batch.length;
            this.#update({ written });
        }
        this.#update({ status: 'done', written });
    }

    close(): void {
        this.#features = [];
        this.#set(null);
    }
}
