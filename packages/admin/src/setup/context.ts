/**
 * What every step flow shares: the ports, the state store, and the few writes a flow makes (patch a step, count an
 * input or a consent, change a slice). In bootstrap mode every change is mirrored into the bootstrap record, so a
 * reload keeps what the steps detected (`docs/research/M2b-interfaces.md` §3.2).
 */
import type { SetupStatusView } from '@hcm/shared';

import { writeBootstrapRecord } from './bootstrap-record.js';
import type { StepFailure } from './messages.js';
import type { SetupDeps } from './ports.js';
import { applyStatusView, bootstrapRecordOf } from './records.js';
import { withCount, withStep, type SetupState, type StepCounts, type StepPatch } from './state.js';
import type { SetupStepId } from './steps.js';

export interface SetupStore {
    get(): SetupState;
    set(next: SetupState): void;
    subscribe(listener: (state: SetupState) => void): () => void;
}

/**
 * A plain observable value; listeners run synchronously after every change. A change made by a listener is delivered
 * after the current round, to every listener, so nobody ever sees an older state after a newer one.
 */
export function createSetupStore(initial: SetupState): SetupStore {
    let current = initial;
    let notifying = false;
    let again = false;
    const listeners = new Set<(state: SetupState) => void>();
    /** A listener changed the state during the round just delivered (read through a call: listeners set it). */
    const changedMeanwhile = (): boolean => again;
    const notify = (): void => {
        notifying = true;
        try {
            do {
                again = false;
                for (const listener of [...listeners]) {
                    listener(current);
                }
            } while (changedMeanwhile());
        } finally {
            notifying = false;
        }
    };
    return {
        get: () => current,
        set(next) {
            current = next;
            if (notifying) {
                again = true;
                return;
            }
            notify();
        },
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export interface SetupContext {
    readonly deps: SetupDeps;
    state(): SetupState;
    /** Replaces the state through `change` (and mirrors it into the bootstrap record in bootstrap mode). */
    update(change: (state: SetupState) => SetupState): void;
    patchStep(id: SetupStepId, patch: StepPatch): void;
    /** Counts one in-app input or Google consent on step `id` (the e2e input budget). */
    count(id: SetupStepId, kind: keyof StepCounts): void;
    /** Records a failed check or action on step `id` (Continue when the Google token expired). */
    fail(id: SetupStepId, failure: StepFailure): void;
    /** Normal mode: the server's `setup/status` replaces what the cards show. */
    applyStatus(view: SetupStatusView): void;
    /** ISO 8601 of the clock's now. */
    nowIso(): string;
}

export function createSetupContext(deps: SetupDeps, store: SetupStore): SetupContext {
    const nowIso = (): string => new Date(deps.clock.now()).toISOString();
    const update = (change: (state: SetupState) => SetupState): void => {
        const next = change(store.get());
        store.set(next);
        if (next.mode === 'bootstrap') {
            writeBootstrapRecord(deps.session, bootstrapRecordOf(next, nowIso()));
        }
    };
    return {
        deps,
        state: () => store.get(),
        update,
        patchStep(id, patch) {
            update((state) => withStep(state, id, patch));
        },
        count(id, kind) {
            update((state) => withCount(state, id, kind));
        },
        fail(id, failure) {
            if (failure.expired) {
                deps.google.drop();
            }
            update((state) => withStep(state, id, { busy: false, error: failure.message, needsContinue: failure.expired }));
        },
        applyStatus(view) {
            update((state) => applyStatusView(state, view, deps.clock.now()));
        },
        nowIso,
    };
}
