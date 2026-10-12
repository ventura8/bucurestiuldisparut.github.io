/**
 * Where the steps' health comes from (`docs/research/M2b-interfaces.md` §3.2): in normal mode the server's
 * `setup/status` (through `setup.status`, `setup.selfTest`, `setup.recordCloud`), in bootstrap mode the bootstrap
 * record in `sessionStorage`; and what `setup.recordCloud` stores from that record after the claim.
 */
import {
    PROVISION_ITEMS,
    USGS_EXPIRY_REMINDER_DAYS,
    isApiErrorCode,
    type ApiErrorCode,
    type RecordCloudRequest,
    type ServiceState,
    type SetupStatusView,
} from '@hcm/shared';

import { BOOTSTRAP_STEPS, type BootstrapRecord, type StepHealth } from './bootstrap-record.js';
import { isSetupMessageKey, setupMessage, type MessageParams, type SetupMessage, type SetupMessageKey } from './messages.js';
import type { ProvisionItemResult } from './ports.js';
import {
    provisionHealth,
    withStep,
    type BillingSlice,
    type DeploySlice,
    type ProvisionItemState,
    type SetupState,
    type StepPatch,
    type UsgsSlice,
} from './state.js';
import type { SetupStepId } from './steps.js';

const DAY_MS = 86_400_000;

/** A health record as zod infers it (an optional field may hold `undefined`). */
interface Health {
    readonly state: ServiceState;
    readonly checkedAt?: string | null | undefined;
    readonly detail?: SetupMessageKey | undefined;
    readonly params?: MessageParams | undefined;
}

function messageOf(health: Health): SetupMessage | null {
    return health.detail === undefined ? null : setupMessage(health.detail, health.params);
}

function healthPatch(health: Health): StepPatch {
    return { state: health.state, checkedAt: health.checkedAt ?? null, detail: messageOf(health) };
}

/**
 * Why a doctor item is in its state: its reason, or, for an item waiting for another (`params.item`, no reason), the
 * one it waits for (CR-M2b-16).
 */
export function itemMessage(item: ProvisionItemResult): SetupMessage | null {
    const waitingFor = item.params?.['item'];
    if (item.detail !== undefined || waitingFor === undefined) {
        return messageOf(item);
    }
    return setupMessage('adminSetup.provision.waiting', { item: waitingFor });
}

/** Every doctor item in screen order, the reported ones with their state, the others `missing`. */
export function mergeItems(reported: readonly ProvisionItemResult[]): readonly ProvisionItemState[] {
    const byId = new Map(reported.map((item) => [item.id, item]));
    return PROVISION_ITEMS.map((id) => {
        const item = byId.get(id);
        return item === undefined ? { id, state: 'missing', detail: null } : { id, state: item.state, detail: itemMessage(item) };
    });
}

function withSteps(state: SetupState, patches: readonly (readonly [SetupStepId, StepPatch])[]): SetupState {
    return patches.reduce((current, [id, patch]) => withStep(current, id, patch), state);
}

function billingFromView(billing: BillingSlice, view: SetupStatusView['billing']): BillingSlice {
    return {
        ...billing,
        budgetId: view.budgetId ?? billing.budgetId,
        amount: view.budgetAmount ?? billing.amount,
        currency: view.currency ?? billing.currency,
    };
}

function expiresSoon(tokenExpiresAt: string | null, now: number): boolean {
    return tokenExpiresAt !== null && Date.parse(tokenExpiresAt) - now <= USGS_EXPIRY_REMINDER_DAYS * DAY_MS;
}

/** The USGS slice from a `setup/status` or `setup.saveUsgs` view (the expiry reminder from `now`). */
export function usgsFromView(usgs: UsgsSlice, view: SetupStatusView['usgs'], now: number): UsgsSlice {
    const tokenExpiresAt = view.tokenExpiresAt ?? null;
    return {
        ...usgs,
        role: view.role ?? null,
        nextCheckAt: view.nextCheckAt ?? null,
        tokenExpiresAt,
        expiresSoon: expiresSoon(tokenExpiresAt, now),
    };
}

/** Normal mode: the server's record. The bootstrap steps and the claim are done (the server answers an admin). */
export function applyStatusView(state: SetupState, view: SetupStatusView, now: number): SetupState {
    const done: StepPatch = { state: 'ok', checkedAt: view.generatedAt, detail: null };
    const items = mergeItems(view.provision.items);
    const next = withSteps(state, [
        ['signIn', done],
        ['deploy', done],
        ['claim', done],
        ['billing', healthPatch(view.billing)],
        ['provision', { ...healthPatch(view.provision), state: provisionHealth(items) }],
        ['mapbox', healthPatch(view.mapbox)],
        ['usgs', healthPatch(view.usgs)],
        ['analytics', healthPatch(view.analytics)],
    ]);
    return {
        ...next,
        billing: billingFromView(next.billing, view.billing),
        provision: { items },
        mapbox: { ...next.mapbox, user: view.mapbox.user ?? null },
        usgs: usgsFromView(next.usgs, view.usgs, now),
        analytics: { ...next.analytics, measurementId: view.analytics.measurementId ?? next.analytics.measurementId },
        crashes: { ...next.crashes, lastReportAt: view.crash.lastReportAt ?? null },
    };
}

function savedBudget(billing: BillingSlice, saved: NonNullable<BootstrapRecord['billing']>): Pick<BillingSlice, 'amount' | 'currency'> {
    return { amount: saved.budgetAmount ?? billing.amount, currency: saved.currency ?? billing.currency };
}

function billingFromRecord(billing: BillingSlice, saved: BootstrapRecord['billing']): BillingSlice {
    if (saved === undefined) {
        return billing;
    }
    return { ...billing, accountName: saved.accountName ?? null, budgetId: saved.budgetId ?? null, ...savedBudget(billing, saved) };
}

function deployFromRecord(deploy: DeploySlice, saved: BootstrapRecord['deploy']): DeploySlice {
    return saved === undefined ? deploy : { ...deploy, ready: saved.ready, total: saved.total, failed: saved.failed ?? [] };
}

/** Bootstrap mode after a reload: the steps the record holds (never a token: the next step asks Google again). */
export function applyBootstrapRecord(state: SetupState, record: BootstrapRecord): SetupState {
    const patches = BOOTSTRAP_STEPS.flatMap((id) => {
        const health = record.steps[id];
        return health === undefined ? [] : [[id, healthPatch(health)] as const];
    });
    const next = withSteps(state, patches);
    return {
        ...next,
        billing: billingFromRecord(next.billing, record.billing),
        provision: { items: mergeItems(record.provision?.items ?? []) },
        deploy: deployFromRecord(next.deploy, record.deploy),
    };
}

/** A recordable reason: only keys `isSetupMessageKey` reads back, with their parameters. */
function reason(message: SetupMessage | null): { detail?: SetupMessageKey; params?: MessageParams } {
    if (message === null || !isSetupMessageKey(message.key)) {
        return {};
    }
    return message.params === undefined ? { detail: message.key } : { detail: message.key, params: message.params };
}

/** The checked bootstrap steps with their health (a step never checked is left out). */
function checkedSteps(state: SetupState): BootstrapRecord['steps'] {
    return Object.fromEntries(
        BOOTSTRAP_STEPS.flatMap((id) => {
            const { state: health, checkedAt, detail } = state.steps[id];
            return checkedAt === null ? [] : [[id, { state: health, checkedAt, ...reason(detail) } satisfies StepHealth] as const];
        }),
    );
}

function billingRecord(billing: BillingSlice): NonNullable<BootstrapRecord['billing']> {
    const { accountName, budgetId, amount, currency } = billing;
    return {
        ...(accountName === null ? {} : { accountName }),
        ...(budgetId === null ? {} : { budgetId, budgetAmount: amount, currency }),
    };
}

/** What the bootstrap steps found, for `sessionStorage` (checked steps only). */
export function bootstrapRecordOf(state: SetupState, nowIso: string): BootstrapRecord {
    const { ready, total, failed } = state.deploy;
    const items = state.provision.items.filter((item) => item.state !== 'missing');
    return {
        version: 1,
        projectId: state.projectId,
        updatedAt: nowIso,
        steps: checkedSteps(state),
        billing: billingRecord(state.billing),
        provision: { items: items.map((item) => ({ id: item.id, state: item.state, ...reason(item.detail) })) },
        deploy: { ready, total, failed },
    };
}

/** A recorded reason that `setup.recordCloud` accepts (an API error code); admin texts stay on the card only. */
function apiReason(
    detail: SetupMessageKey | undefined,
    params: MessageParams | undefined,
): { detail?: ApiErrorCode; params?: MessageParams } {
    if (!isApiErrorCode(detail)) {
        return {};
    }
    return params === undefined ? { detail } : { detail, params };
}

function budgetFields(saved: BootstrapRecord['billing']): { budgetId?: string; budgetAmount?: number; currency?: string } {
    if (saved?.budgetId === undefined) {
        return {};
    }
    return { budgetId: saved.budgetId, ...savedAmount(saved) };
}

function savedAmount(saved: NonNullable<BootstrapRecord['billing']>): { budgetAmount?: number; currency?: string } {
    const { budgetAmount, currency } = saved;
    return budgetAmount === undefined || currency === undefined ? {} : { budgetAmount, currency };
}

function billingRequest(record: BootstrapRecord): Pick<RecordCloudRequest, 'billing'> {
    const billing = record.steps.billing;
    if (billing === undefined) {
        return {};
    }
    return { billing: { state: billing.state, ...apiReason(billing.detail, billing.params), ...budgetFields(record.billing) } };
}

function provisionRequest(record: BootstrapRecord): Pick<RecordCloudRequest, 'provision'> {
    const items = record.provision?.items ?? [];
    if (items.length === 0) {
        return {};
    }
    return { provision: { items: items.map((item) => ({ id: item.id, state: item.state, ...apiReason(item.detail, item.params) })) } };
}

/** `setup.recordCloud`'s request from the bootstrap record (null when it found nothing to record). */
export function recordCloudRequestOf(record: BootstrapRecord): RecordCloudRequest | null {
    const request: RecordCloudRequest = { ...billingRequest(record), ...provisionRequest(record) };
    return request.billing === undefined && request.provision === undefined ? null : request;
}
