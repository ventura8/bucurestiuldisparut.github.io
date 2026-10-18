import type { SetupArea } from '@hcm/shared';

import type { GoogleScope } from '../google/scopes.js';

/**
 * The Setup Assistant's steps in screen order (`docs/research/M2b-interfaces.md` §3.3): (a) sign-in and ownership,
 * (b) billing and budget, (c) provisioning, (d) the server's deployment, (d2) the automatic owner claim, (e) Mapbox,
 * (f) USGS, (g) analytics and crash reports, (h) the legacy Bucharest import.
 */
export const SETUP_STEPS = ['signIn', 'billing', 'provision', 'deploy', 'claim', 'mapbox', 'usgs', 'analytics', 'legacyImport'] as const;

export type SetupStepId = (typeof SETUP_STEPS)[number];

export interface SetupStepSpec {
    /** The step's letter in the contract. */
    readonly letter: 'a' | 'b' | 'c' | 'd' | 'd2' | 'e' | 'f' | 'g' | 'h';
    /** False for the bootstrap steps: they work with no deployed function and no Firestore access (Google REST only). */
    readonly needsBackend: boolean;
    /** The `setup/status` area that records the step's result, if any. */
    readonly area: SetupArea | null;
    /** The Google scope the step asks for when it runs; null for none. */
    readonly scope: GoogleScope | null;
    /** In-app inputs of the happy path (clicks, fills, pastes, file choices; following a deep link is not counted). */
    readonly inputs: number;
    /** Google consent popups of the happy path. */
    readonly consents: number;
    /** The steps that must be done first. */
    readonly after: readonly SetupStepId[];
    /** An optional step never holds back `ready` (`SETUP_REQUIRED_AREAS`). */
    readonly optional: boolean;
}

export const SETUP_STEP_SPECS: Readonly<Record<SetupStepId, SetupStepSpec>> = {
    signIn: { letter: 'a', needsBackend: false, area: null, scope: 'cloudReadOnly', inputs: 1, consents: 1, after: [], optional: false },
    billing: {
        letter: 'b',
        needsBackend: false,
        area: 'billing',
        scope: 'cloudBilling',
        inputs: 1,
        consents: 1,
        after: ['signIn'],
        optional: false,
    },
    provision: {
        letter: 'c',
        needsBackend: false,
        area: 'provision',
        scope: 'cloudPlatform',
        inputs: 1,
        consents: 1,
        after: ['billing'],
        optional: false,
    },
    deploy: {
        letter: 'd',
        needsBackend: false,
        area: null,
        scope: 'cloudPlatform',
        inputs: 0,
        consents: 0,
        after: ['provision'],
        optional: false,
    },
    claim: {
        letter: 'd2',
        needsBackend: true,
        area: null,
        scope: 'cloudReadOnly',
        inputs: 0,
        consents: 0,
        after: ['deploy'],
        optional: false,
    },
    mapbox: { letter: 'e', needsBackend: true, area: 'mapbox', scope: null, inputs: 1, consents: 0, after: ['claim'], optional: false },
    usgs: { letter: 'f', needsBackend: true, area: 'usgs', scope: null, inputs: 3, consents: 0, after: ['claim'], optional: false },
    analytics: {
        letter: 'g',
        needsBackend: true,
        area: 'analytics',
        scope: 'analyticsEdit',
        inputs: 1,
        consents: 1,
        after: ['claim'],
        optional: true,
    },
    legacyImport: { letter: 'h', needsBackend: true, area: null, scope: null, inputs: 1, consents: 0, after: ['claim'], optional: true },
};

/** The first step not done whose prerequisites are all done, in screen order; null once every step is done. */
export function nextSetupStep(done: ReadonlySet<SetupStepId>): SetupStepId | null {
    return SETUP_STEPS.find((id) => !done.has(id) && SETUP_STEP_SPECS[id].after.every((before) => done.has(before))) ?? null;
}

/** The happy-path input budget of a run through `steps` (the e2e `inputBudget` limits, §3.5). */
export function setupInputBudget(steps: readonly SetupStepId[] = SETUP_STEPS): { readonly inputs: number; readonly consents: number } {
    return steps.reduce(
        (total, id) => ({ inputs: total.inputs + SETUP_STEP_SPECS[id].inputs, consents: total.consents + SETUP_STEP_SPECS[id].consents }),
        { inputs: 0, consents: 0 },
    );
}
