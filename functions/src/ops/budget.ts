import { runAs } from '../global-options.js';

import { BACKGROUND_FUNCTIONS, FIRESTORE_PATHS, opsGuardDocSchema, systemWriter, timestampFromDate, type OpsGuardDoc } from '@hcm/shared';
import { onMessagePublished } from 'firebase-functions/pubsub';

import type { Ports } from '../ports/index.js';

export type BudgetDeps = Pick<Ports, 'log' | 'clock' | 'documents'>;

/** The fields of a Cloud Billing budget notification the guard reads (the message carries more). */
export interface BudgetNotification {
    readonly costAmount: number;
    readonly budgetAmount: number;
    /** The billing account's currency (`USD`), when the message says. */
    readonly currencyCode?: string;
    /** The budget period the cost counts (`costIntervalStart`, ISO 8601), when the message says. */
    readonly costIntervalStart?: string;
}

const CURRENCY = /^[A-Z]{3}$/;
const INTERVAL_MAX = 40;

/** The message's optional fields the guard keeps, when they are well formed. */
function optionalFields(record: Readonly<Record<string, unknown>>): Pick<BudgetNotification, 'currencyCode' | 'costIntervalStart'> {
    const { currencyCode, costIntervalStart } = record;
    return {
        ...(typeof currencyCode === 'string' && CURRENCY.test(currencyCode) ? { currencyCode } : {}),
        ...(typeof costIntervalStart === 'string' && costIntervalStart.length <= INTERVAL_MAX ? { costIntervalStart } : {}),
    };
}

/** The notification in a Pub/Sub message's JSON, or undefined for anything else. */
export function parseBudgetNotification(value: unknown): BudgetNotification | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const record = value as Readonly<Record<string, unknown>>;
    const { costAmount, budgetAmount } = record;
    return typeof costAmount === 'number' && typeof budgetAmount === 'number'
        ? { costAmount, budgetAmount, ...optionalFields(record) }
        : undefined;
}

/** What the red guard records of the alert: the cost, the budget, the currency and the period (the admin's banner). */
function spendOf(notification: BudgetNotification): NonNullable<OpsGuardDoc['spend']> {
    return {
        costAmount: Math.max(0, notification.costAmount),
        budgetAmount: Math.max(0, notification.budgetAmount),
        ...(notification.currencyCode === undefined ? {} : { currency: notification.currencyCode }),
        ...(notification.costIntervalStart === undefined ? {} : { interval: notification.costIntervalStart }),
    };
}

/** An admin turned the guard green for this budget period: its later alerts (Google repeats them) pause nothing. */
function accepted(current: OpsGuardDoc | undefined, notification: BudgetNotification): boolean {
    return current?.resumedFor !== undefined && current.resumedFor === notification.costIntervalStart;
}

/**
 * `ops.onBudget` (security review §3.4): once the month's cost reaches the budget, `ops/guard` turns red (`reason:
 * 'budget'`, with the alert's spend), which pauses the raster pipeline, MTS publishing and AI assists from M3 on, never
 * the public site. Turning it green again is an admin action (`imagery.resumeGuard`, CR-M3-47), which accepts that budget
 * period's spend: its repeated alerts leave the guard green, the next period's turn it red again. Returns whether this
 * notification turned it red.
 */
export async function onBudgetAlert(deps: BudgetDeps, notification: BudgetNotification): Promise<boolean> {
    if (notification.costAmount < notification.budgetAmount) {
        return false;
    }
    const now = timestampFromDate(deps.clock.now());
    const turned = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
        if (current?.state === 'red' || accepted(current, notification)) {
            return false;
        }
        await transaction.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            ...current,
            state: 'red',
            reason: 'budget',
            since: now,
            spend: spendOf(notification),
            updatedBy: systemWriter('ops'),
            updatedAt: now,
        });
        return true;
    });
    if (turned) {
        deps.log.warn('budget reached: the guard is red', { ...notification });
    }
    return turned;
}

/** The message's JSON; undefined when its data is not JSON (`Message.json` throws then). */
function jsonOf(message: { readonly json: unknown }): unknown {
    try {
        return message.json;
    } catch {
        return undefined;
    }
}

/** `ops-onBudget`: the budget's Pub/Sub topic (`budget`), one instance, no retry (the budget notifies again). */
export function onBudgetFunction(getDeps: () => BudgetDeps) {
    const options = { topic: BACKGROUND_FUNCTIONS['ops.onBudget'].source, maxInstances: 1, retry: false, ...runAs('ops.onBudget') };
    return onMessagePublished(options, async (event) => {
        const deps = getDeps();
        const notification = parseBudgetNotification(jsonOf(event.data.message));
        if (notification === undefined) {
            deps.log.warn('budget message ignored: not a budget notification');
            return;
        }
        await onBudgetAlert(deps, notification);
    });
}
