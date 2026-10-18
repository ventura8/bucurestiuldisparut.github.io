/**
 * The categories section's moving parts (behaviours A33, A39): the order of the list (a drag, or Move up and Move down,
 * written at once in one batch), the open category's editor and its document's listener, and its deletion. The settings
 * store routes `#/settings/categories/<id>` here.
 */
import { FIRESTORE_PATHS, poiCategoryDocSchema, type Locale, type PoiCategoryDoc } from '@hcm/shared';

import { LiveDoc, type DocState } from '../content/doc.js';
import type { ContentServices, WriteOutcome } from '../content/services.js';
import { moved, moveTarget, opacityFromPercent, type MoveDirection } from '../layers/model.js';
import type { PreviewLayer } from '../layers/preview.js';
import { ascendingOrderChanges, type CategoryItem } from './categories.js';
import { CategoryDeletion, type CategoryDeletionState } from './category-deletion.js';
import { CategoryEditor, type CategoryEditorState, type CategoryPatch } from './category-editor.js';
import { withText } from './localized.js';
import { reportOutcome } from './report.js';

interface CategoryAreaState {
    readonly category: CategoryEditorState | null;
    readonly categoryDeletion: CategoryDeletionState;
    /** A reorder of the categories is being written. */
    readonly reordering: boolean;
}

export interface CategoryIntents {
    moveCategory(id: string, direction: MoveDirection): Promise<WriteOutcome | null>;
    moveCategoryTo(id: string, index: number): Promise<WriteOutcome | null>;
    editCategory(patch: CategoryPatch): void;
    setCategoryLabel(locale: Locale, text: string): void;
    setCategoryOpacity(percent: number): void;
    useProposedColor(): void;
    /** Saves the open category: its id (a new one's new id) once written, else null. */
    saveCategory(): Promise<string | null>;
    discardCategory(): void;
    askDeleteCategory(): Promise<void>;
    setDeleteTarget(target: string | null): void;
    cancelDeleteCategory(): void;
    confirmDeleteCategory(): Promise<boolean>;
}

export interface CategoryAreaDeps {
    readonly services: ContentServices;
    readonly preview: PreviewLayer;
    readonly changed: (patch: Partial<CategoryAreaState>) => void;
    /** The listed categories, in order. */
    readonly categories: () => readonly CategoryItem[];
    /** Every id of the overlay namespace already taken (layers and categories). */
    readonly taken: () => readonly string[];
}

export class CategoryArea {
    readonly #deps: CategoryAreaDeps;
    readonly #doc: LiveDoc<PoiCategoryDoc>;
    readonly #deletion: CategoryDeletion;
    #editor: CategoryEditor | null = null;
    #reordering = false;
    readonly intents: CategoryIntents;

    constructor(deps: CategoryAreaDeps) {
        this.#deps = deps;
        const { store, clock } = deps.services;
        const denied = (): void => {
            deps.services.denied();
        };
        this.#doc = new LiveDoc({
            ...{ store, clock, denied, schema: poiCategoryDocSchema },
            changed: (doc) => {
                this.#loaded(doc);
            },
        });
        this.#deletion = new CategoryDeletion(deps.services, (categoryDeletion) => {
            deps.changed({ categoryDeletion });
        });
        this.intents = { ...this.#moveIntents(), ...this.#editIntents(), ...this.#deleteIntents() };
    }

    get unsaved(): boolean {
        return this.#editor?.unsaved ?? false;
    }

    /** `#/settings/categories/<id>` (null: no category open). */
    open(id: string | null): void {
        if (id === this.#openId()) {
            return;
        }
        this.#editor?.stop();
        this.#doc.stop();
        this.#deletion.cancel();
        this.#editor = id === null ? null : this.#newEditor(id);
        this.#deps.changed({ category: this.#editorState() });
        this.#watch(this.#editor);
    }

    #openId(): string | null {
        return this.#editorState()?.id ?? null;
    }

    #editorState(): CategoryEditorState | null {
        return this.#editor === null ? null : this.#editor.state;
    }

    /** The open category's conflict: keep the draft's changes over the other version. */
    keepMine(): void {
        this.#editor?.keepMine();
    }

    /** The open category's conflict: take the other version where both changed. */
    takeTheirs(): void {
        this.#editor?.takeTheirs();
    }

    retry(): void {
        if (this.#doc.path !== '') {
            this.#doc.retry();
        }
    }

    #watch(editor: CategoryEditor | null): void {
        if (editor !== null && !editor.state.isNew) {
            this.#doc.show(FIRESTORE_PATHS.poiCategory(this.#deps.services.cityId, editor.state.id));
        }
    }

    #newEditor(id: string): CategoryEditor {
        const { services, preview, categories, taken } = this.#deps;
        const changed = (category: CategoryEditorState): void => {
            this.#deps.changed({ category });
        };
        return new CategoryEditor(id, { services, preview, changed, taken, categories });
    }

    #loaded(doc: DocState<PoiCategoryDoc>): void {
        if (doc.status === 'ready') {
            this.#editor?.load(doc.doc);
        }
    }

    #moveIntents(): Pick<CategoryIntents, 'moveCategory' | 'moveCategoryTo'> {
        return {
            moveCategory: (id, direction) => this.#reorder(id, (items) => moveTarget(items, id, direction)),
            moveCategoryTo: (id, index) => this.#reorder(id, () => index),
        };
    }

    #editIntents(): Omit<
        CategoryIntents,
        'moveCategory' | 'moveCategoryTo' | 'askDeleteCategory' | 'setDeleteTarget' | 'cancelDeleteCategory' | 'confirmDeleteCategory'
    > {
        return {
            editCategory: (patch) => {
                this.#editor?.edit(patch);
            },
            setCategoryLabel: (locale, text) => {
                this.#editor?.edit({ label: withText(this.#editor.state.value?.label, locale, text) });
            },
            setCategoryOpacity: (percent) => {
                this.#editor?.edit({ defaultOpacity: opacityFromPercent(percent) });
            },
            useProposedColor: () => {
                this.#editor?.useProposedColor();
            },
            saveCategory: () => this.#save(),
            discardCategory: () => {
                this.#editor?.discard();
            },
        };
    }

    #deleteIntents(): Pick<CategoryIntents, 'askDeleteCategory' | 'setDeleteTarget' | 'cancelDeleteCategory' | 'confirmDeleteCategory'> {
        const deletion = this.#deletion;
        return {
            askDeleteCategory: () => this.#askDelete(),
            setDeleteTarget: (target) => {
                deletion.setTarget(target);
            },
            cancelDeleteCategory: () => {
                deletion.cancel();
            },
            confirmDeleteCategory: () => this.#confirmDelete(),
        };
    }

    async #reorder(id: string, target: (items: readonly CategoryItem[]) => number): Promise<WriteOutcome | null> {
        const before = this.#deps.categories();
        const changes = ascendingOrderChanges(before, moved(before, id, target(before)));
        if (changes.length === 0 || this.#reordering) {
            return null;
        }
        this.#setReordering(true);
        const { store, cityId } = this.#deps.services;
        const writes = changes.map((change) => ({
            kind: 'update' as const,
            path: FIRESTORE_PATHS.poiCategory(cityId, change.id),
            fields: { order: change.order },
        }));
        const outcome = await store.batch(writes);
        this.#setReordering(false);
        reportOutcome(this.#deps.services, outcome);
        return outcome;
    }

    #setReordering(reordering: boolean): void {
        this.#reordering = reordering;
        this.#deps.changed({ reordering });
    }

    async #save(): Promise<string | null> {
        const saved = await this.#editor?.save();
        if (saved === undefined || saved === null) {
            return null;
        }
        reportOutcome(this.#deps.services, saved.outcome);
        return saved.outcome.ok ? saved.id : null;
    }

    async #askDelete(): Promise<void> {
        const target = this.#deletable();
        if (target !== null) {
            await this.#deletion.ask(target);
        }
    }

    /** The open category when it can be deleted: saved before (a new one is discarded instead). */
    #deletable(): { readonly id: string; readonly label: string } | null {
        const category = this.#editorState();
        if (category === null || category.isNew || category.value === null) {
            return null;
        }
        return { id: category.id, label: category.value.label.ro };
    }

    async #confirmDelete(): Promise<boolean> {
        const outcome = await this.#deletion.confirm();
        reportOutcome(this.#deps.services, outcome, 'adminContent.settings.categoryDeleted');
        return outcome?.ok === true;
    }
}
