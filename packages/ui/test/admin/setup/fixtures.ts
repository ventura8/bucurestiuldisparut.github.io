// A Setup Assistant state as the admin's controller builds it (packages/admin/src/setup/state.ts; the ui tests cannot
// import the admin), and a fake port that records every intent the elements call.
import { PROVISION_ITEMS, type ServiceState } from '@hcm/shared';

import type { SetupIntentsPort, SetupPort, SetupStepId, SetupStepView, SetupViewState } from '../../../src/admin/setup/setup-port.js';

export const STEP_IDS: readonly SetupStepId[] = [
    'signIn',
    'billing',
    'provision',
    'deploy',
    'claim',
    'mapbox',
    'usgs',
    'analytics',
    'legacyImport',
];

const LETTERS: Readonly<Record<SetupStepId, string>> = {
    signIn: 'a',
    billing: 'b',
    provision: 'c',
    deploy: 'd',
    claim: 'd2',
    mapbox: 'e',
    usgs: 'f',
    analytics: 'g',
    legacyImport: 'h',
};

const NEEDS_BACKEND: ReadonlySet<SetupStepId> = new Set(['claim', 'mapbox', 'usgs', 'analytics', 'legacyImport']);

export function stepView(id: SetupStepId, changes: Partial<SetupStepView> = {}): SetupStepView {
    return {
        id,
        letter: LETTERS[id],
        state: 'missing',
        checkedAt: null,
        detail: null,
        error: null,
        available: true,
        needsBackend: NEEDS_BACKEND.has(id),
        optional: id === 'analytics' || id === 'legacyImport',
        busy: false,
        needsContinue: false,
        scope: null,
        links: [],
        used: { inputs: 0, consents: 0 },
        budget: { inputs: 1, consents: 0 },
        ...changes,
    };
}

export type ViewChanges = Partial<Omit<SetupViewState, 'steps'>> & {
    readonly steps?: Partial<Record<SetupStepId, Partial<SetupStepView>>>;
};

/** A normal-mode state: sign-in to the claim done, the rest to do, unless `changes` says otherwise. */
export function setupView(changes: ViewChanges = {}): SetupViewState {
    const { steps: stepChanges = {}, ...rest } = changes;
    const done: ServiceState = 'ok';
    const steps = Object.fromEntries(
        STEP_IDS.map((id, index) => [id, stepView(id, { ...(index < 5 ? { state: done } : {}), ...stepChanges[id] })]),
    ) as Record<SetupStepId, SetupStepView>;
    return {
        mode: 'normal',
        projectId: 'demo-hcm',
        authDomain: 'demo-hcm.firebaseapp.com',
        openStep: 'mapbox',
        order: STEP_IDS,
        steps,
        done: 5,
        total: 9,
        ready: false,
        checking: false,
        error: null,
        used: { inputs: 0, consents: 0 },
        billing: {
            amount: 5,
            currency: 'USD',
            accounts: [],
            chosen: null,
            waitingForAccount: false,
            accountName: null,
            budgetId: null,
            needsPlatform: false,
        },
        provision: { items: PROVISION_ITEMS.map((id) => ({ id, state: 'missing', detail: null })) },
        deploy: {
            ready: 0,
            total: 32,
            failed: [],
            variables: [
                { name: 'GCP_PROJECT_ID', value: 'demo-hcm' },
                { name: 'DEPLOY_ENABLED', value: 'true' },
            ],
            watching: false,
        },
        mapbox: { user: null, requiredScopes: ['styles:read', 'tokens:write'] },
        usgs: {
            secondsLeft: null,
            expired: false,
            tokenPageUrl: 'https://ers.cr.usgs.gov/password/appgenerate',
            role: null,
            nextCheckAt: null,
            tokenExpiresAt: null,
            expiresSoon: false,
            area: '25.9600, 44.3300, 26.2300, 44.5400',
            username: '',
            expiresOn: '',
        },
        analytics: { measurementId: null, pageChangesOff: false, crashEmails: true, watching: false },
        crashes: { loaded: false, busy: false, groups: [], error: null, disabledApi: null, lastReportAt: null },
        legacyImport: { done: 0, total: 45, failed: [], running: false },
        ...rest,
    };
}

type IntentName = keyof SetupIntentsPort;

/** Every intent call, `[name, ...args]`, in order. */
export type IntentCall = readonly [IntentName, ...unknown[]];

function recordingIntents(calls: IntentCall[]): SetupIntentsPort {
    const record =
        (name: IntentName) =>
        (...args: unknown[]): void => {
            calls.push([name, ...args]);
        };
    const names: readonly IntentName[] = [
        'open',
        'recheck',
        'noteInput',
        'continueGoogle',
        'linkBilling',
        'chooseBillingAccount',
        'confirmBillingAccount',
        'provision',
        'saveMapbox',
        'startUsgsCountdown',
        'draftUsgs',
        'saveUsgs',
        'followLink',
        'disableHistoryPageViews',
        'setCrashEmails',
        'enableApi',
        'loadCrashGroups',
        'importLegacy',
    ];
    return Object.fromEntries(names.map((name) => [name, record(name)])) as unknown as SetupIntentsPort;
}

export class FakeSetupPort implements SetupPort {
    readonly calls: IntentCall[] = [];
    readonly intents: SetupIntentsPort;
    private readonly listeners = new Set<(state: SetupViewState) => void>();

    /** Records every intent; `draftUsgs` also changes the state, as the controller does (the USGS fields live there). */
    constructor(private state: SetupViewState = setupView()) {
        const recorded = recordingIntents(this.calls);
        this.intents = {
            ...recorded,
            draftUsgs: (fields) => {
                recorded.draftUsgs(fields);
                this.notify({ ...this.state, usgs: { ...this.state.usgs, ...fields } });
            },
        };
    }

    private notify(state: SetupViewState): void {
        this.state = state;
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    getState(): SetupViewState {
        return this.state;
    }

    subscribe(listener: (state: SetupViewState) => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    set(changes: ViewChanges): void {
        this.notify(setupView({ ...changes }));
    }

    listening(): number {
        return this.listeners.size;
    }
}
