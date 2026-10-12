import { runAs } from '../global-options.js';

import { BACKGROUND_FUNCTIONS, FIRESTORE_PATHS, opsGuardDocSchema, systemWriter, timestampFromDate } from '@hcm/shared';
import { onMessagePublished } from 'firebase-functions/pubsub';

import type { Ports } from '../ports/index.js';

export type BudgetDeps = Pick<Ports, 'log' | 'clock' | 'documents'>;

/** The fields of a Cloud Billing budget notification the guard reads (the message carries more). */
export interface BudgetNotification {
    readonly costAmount: number;
    readonly budgetAmount: number;
}

/** The notification in a Pub/Sub message's JSON, or undefined for anything else. */
export function parseBudgetNotification(value: unknown): BudgetNotification | undefined {
    if (typeof value !== 'object' || value === null) {
        return undefined;
    }
    const { costAmount, budgetAmount } = value as Readonly<Record<string, unknown>>;
    return typeof costAmount === 'number' && typeof budgetAmount === 'number' ? { costAmount, budgetAmount } : undefined;
}

/**
 * `ops.onBudget` (security review §3.4): once the month's cost reaches the budget, `ops/guard` turns red (`reason:
 * 'budget'`), which pauses the raster pipeline, MTS publishing and AI assists from M3 on, never the public site.
 * Turning it green again is an admin action. Returns whether this notification turned it red.
 */
export async function onBudgetAlert(deps: BudgetDeps, notification: BudgetNotification): Promise<boolean> {
    if (notification.costAmount < notification.budgetAmount) {
        return false;
    }
    const now = timestampFromDate(deps.clock.now());
    const turned = await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
        if (current?.state === 'red') {
            return false;
        }
        await transaction.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            ...current,
            state: 'red',
            reason: 'budget',
            since: now,
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
