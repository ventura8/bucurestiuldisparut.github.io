/**
 * M8 (`docs/research/M8-join-interfaces.md` §6): what the admin does about one date's frames. **Join frames** calls
 * `imagery.join` (the server imports what is missing and holds the join until its frames are ready); **Add {year}** saves
 * the year among the city's target years and searches again, because only a search ranks the scenes anew. One action
 * runs at a time; a join's refusal stays beside its button (by the request's first frame) until the next one.
 */
import { FIRESTORE_PATHS, type ImagerySettings } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';
import { callImagery, refusalOf } from './api.js';

export interface JoinActionsState {
    /** The first frame of the join on its way. */
    readonly joining: string | null;
    readonly joinRefusal: { readonly id: string; readonly notice: NoticeInput } | null;
    /** The target year being saved. */
    readonly addingYear: number | null;
}

export const IDLE_JOIN: JoinActionsState = { joining: null, joinRefusal: null, addingYear: null };

/** What Add {year} needs to know: the city's settings as read, their version, and the search that ranks again. */
export interface YearTarget {
    readonly settings: ImagerySettings;
    readonly version: string | null;
    readonly search: () => Promise<void>;
}

export class JoinActions {
    readonly #services: ContentServices;
    readonly #changed: (state: Partial<JoinActionsState>) => void;
    #busy = false;

    constructor(services: ContentServices, changed: (state: Partial<JoinActionsState>) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    /** `imagery.join` of the frames: the join version's id (the page opens it), or null when refused or not run. */
    async join(entityIds: readonly string[]): Promise<string | null> {
        const [id] = entityIds;
        if (this.#busy || id === undefined) {
            return null;
        }
        this.#busy = true;
        this.#changed({ joining: id, joinRefusal: null });
        const { cityId, callables } = this.#services;
        try {
            const answer = await callImagery(callables, 'imagery.join', { cityId, entityIds: [...entityIds] });
            this.#changed({ joining: null });
            return answer.versionId;
        } catch (error) {
            this.#changed({ joining: null, joinRefusal: { id, notice: refusalOf(error) } });
            return null;
        } finally {
            this.#busy = false;
        }
    }

    /** Saves `year` among the target years, then ranks again; true once it is saved (a search that fails says so on Find). */
    async addYear(year: number, target: YearTarget): Promise<boolean> {
        if (this.#busy) {
            return false;
        }
        this.#busy = true;
        this.#changed({ addingYear: year });
        const { settings, version, search } = target;
        const imagery = { ...settings, targetYears: [...settings.targetYears, year].toSorted((a, b) => a - b) };
        const outcome = await this.#services.store.update(FIRESTORE_PATHS.city(this.#services.cityId), { imagery }, version);
        this.#report(outcome);
        this.#changed({ addingYear: null });
        this.#busy = false;
        if (outcome.ok) {
            void search();
        }
        return outcome.ok;
    }

    /** What the snackbar says (the words of Settings, whose save this is); a refusal for access makes the shell ask again. */
    #report(outcome: WriteOutcome): void {
        const { denied, notify } = this.#services;
        if (!outcome.ok && outcome.reason === 'denied') {
            denied();
        }
        notify({ key: outcome.ok ? 'adminContent.settings.saved' : `adminContent.settings.refused.${outcome.reason}` });
    }
}
