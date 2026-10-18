/**
 * What the places area writes, and what it tells the admin (docs/research/M2c-interfaces.md §1.6, §5.3, §9.5): Save
 * (and the remembered category of the next new place), a delete with Undo for ten seconds, and the bulk actions, each
 * ending in one snackbar; a refused write says why, and a `denied` one makes the shell ask who this is again.
 */
import { FIRESTORE_PATHS } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import { runBulk, type BulkAction } from './bulk.js';
import type { PlaceEditor } from './editor.js';
import type { PoiItem } from './model.js';
import { WRITE_FAILURES, type WriteFailure } from './places.js';
import { DeleteUndo, UNDO_WAIT_MS } from './undo.js';

/** `localStorage`: the category a new place starts in (§5.6). */
export const LAST_CATEGORY_KEY = 'hcm:admin:lastCategory';

export type ActionServices = Pick<ContentServices, 'cityId' | 'store' | 'callables' | 'clock' | 'local' | 'notify' | 'denied'>;

export class PlaceActions {
    readonly #services: ActionServices;
    readonly #busy: (busy: boolean) => void;
    #undo: DeleteUndo | null = null;

    constructor(services: ActionServices, busy: (busy: boolean) => void) {
        this.#services = services;
        this.#busy = busy;
    }

    refused(reason: WriteFailure): void {
        if (reason === 'denied') {
            this.#services.denied();
        }
        this.#services.notify({ key: WRITE_FAILURES[reason] });
    }

    async save(editor: PlaceEditor): Promise<WriteOutcome> {
        const outcome = await editor.save();
        if (!outcome.ok) {
            this.refused(outcome.reason);
            return outcome;
        }
        const category = editor.state.draft?.value.category ?? '';
        if (category !== '') {
            this.#services.local.set(LAST_CATEGORY_KEY, category);
        }
        this.#services.notify({ key: 'adminContent.pois.saved' });
        return outcome;
    }

    /** Deletes the open place; the snackbar offers Undo for ten seconds. */
    async remove(editor: PlaceEditor): Promise<WriteOutcome | null> {
        const base = editor.state.draft?.base ?? null;
        if (base === null) {
            return null;
        }
        this.#busy(true);
        const outcome = await this.#services.store.remove(FIRESTORE_PATHS.poi(this.#services.cityId, editor.id), base.version);
        this.#busy(false);
        if (outcome.ok) {
            this.#offerUndo(editor.id);
        } else {
            this.refused(outcome.reason);
        }
        return outcome;
    }

    #offerUndo(id: string): void {
        this.dispose();
        const { cityId, store, callables, clock } = this.#services;
        const undo = new DeleteUndo(id, { cityId, store, callables, clock });
        this.#undo = undo;
        const run = (): void => {
            void this.#runUndo(undo);
        };
        this.#services.notify({ key: 'adminContent.pois.deleted', action: { key: 'adminContent.pois.undo', run } });
        clock.setTimeout(() => {
            undo.dispose();
        }, UNDO_WAIT_MS);
    }

    async #runUndo(undo: DeleteUndo): Promise<void> {
        const result = await undo.undo();
        this.#services.notify({ key: result.ok ? 'adminContent.pois.restored' : result.error });
    }

    /** A bulk action on the selected places; true when every write went through. */
    async bulk(action: BulkAction, selected: readonly PoiItem[], selectionSize: number): Promise<boolean> {
        this.#busy(true);
        const outcome = await runBulk(this.#services.store, this.#services.cityId, action, selected);
        this.#busy(false);
        const params = { changed: String(outcome.changed), skipped: String(selectionSize - outcome.changed) };
        if (outcome.failure !== null) {
            if (outcome.failure === 'denied') {
                this.#services.denied();
            }
            this.#services.notify({ key: 'adminContent.pois.bulkStopped', params });
            return false;
        }
        this.#services.notify({ key: action.kind === 'delete' ? 'adminContent.pois.bulkDeleted' : 'adminContent.pois.bulkDone', params });
        return true;
    }

    /** Stops watching for a delete's history entry (a new delete, or the page closed). */
    dispose(): void {
        this.#undo?.dispose();
        this.#undo = null;
    }
}
