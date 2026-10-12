/** `ops.onBudget`: the month's cost reaching the budget turns `ops/guard` red; the public site never stops. */
import { FIRESTORE_PATHS, opsGuardDocSchema, timestampFromDate, type OpsGuardDoc } from '@hcm/shared';
import { Message } from 'firebase-functions/pubsub';
import { describe, expect, it } from 'vitest';

import { onBudgetAlert, onBudgetFunction, parseBudgetNotification } from '../../src/ops/budget.js';
import { opsDeps, type OpsTestDeps } from './fakes.js';

const NOW = '2026-10-12T09:00:00.000Z';

async function guard(deps: OpsTestDeps): Promise<OpsGuardDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema);
}

function published(data: string) {
    return {
        specversion: '1.0' as const,
        id: 'message-1',
        source: '//pubsub.googleapis.com/projects/demo-hcm/topics/budget',
        type: 'google.cloud.pubsub.topic.v1.messagePublished',
        time: NOW,
        data: {
            message: new Message<unknown>({
                data: Buffer.from(data).toString('base64'),
                messageId: 'm1',
                publishTime: NOW,
                attributes: {},
            }),
            subscription: 'projects/demo-hcm/subscriptions/budget',
        },
    };
}

describe('parseBudgetNotification', () => {
    it.each([
        [
            { costAmount: 5.2, budgetAmount: 5, currencyCode: 'USD' },
            { costAmount: 5.2, budgetAmount: 5 },
        ],
        [{ costAmount: '5', budgetAmount: 5 }, undefined],
        [{ costAmount: 1 }, undefined],
        ['not an object', undefined],
        [null, undefined],
    ])('%j', (value, expected) => {
        expect(parseBudgetNotification(value)).toEqual(expected);
    });
});

describe('onBudgetAlert', () => {
    it('happyPath_reachingTheBudgetTurnsTheGuardRed', async () => {
        const deps = opsDeps(NOW);
        await deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, {
            state: 'green',
            lastNightlyAt: timestampFromDate(new Date('2026-10-12T02:15:00.000Z')),
            updatedBy: 'system:ops',
            updatedAt: timestampFromDate(new Date('2026-10-12T08:45:00.000Z')),
        });

        await expect(onBudgetAlert(deps, { costAmount: 5, budgetAmount: 5 })).resolves.toBe(true);

        expect(await guard(deps)).toEqual({
            state: 'red',
            reason: 'budget',
            since: timestampFromDate(new Date(NOW)),
            lastNightlyAt: timestampFromDate(new Date('2026-10-12T02:15:00.000Z')),
            updatedBy: 'system:ops',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
        expect(deps.recording.records.at(-1)).toMatchObject({ level: 'warn', data: { costAmount: 5, budgetAmount: 5 } });
    });

    it('happyPath_aFreshProjectGetsARedGuard', async () => {
        const deps = opsDeps(NOW);

        await onBudgetAlert(deps, { costAmount: 6, budgetAmount: 5 });

        expect(await guard(deps)).toMatchObject({ state: 'red', reason: 'budget' });
    });

    it('badPath_belowTheBudgetNothingChanges', async () => {
        const deps = opsDeps(NOW);

        await expect(onBudgetAlert(deps, { costAmount: 4.99, budgetAmount: 5 })).resolves.toBe(false);
        expect(await guard(deps)).toBeUndefined();
    });

    it('badPath_anAlreadyRedGuardKeepsItsReasonAndTime', async () => {
        const deps = opsDeps(NOW);
        const red: OpsGuardDoc = {
            state: 'red',
            reason: 'manual',
            since: timestampFromDate(new Date('2026-10-01T00:00:00.000Z')),
            updatedBy: 'u-admin',
            updatedAt: timestampFromDate(new Date('2026-10-01T00:00:00.000Z')),
        };
        await deps.documents.set(FIRESTORE_PATHS.opsGuard, opsGuardDocSchema, red);

        await expect(onBudgetAlert(deps, { costAmount: 9, budgetAmount: 5 })).resolves.toBe(false);
        expect(await guard(deps)).toEqual(red);
    });
});

describe('ops-onBudget', () => {
    it('happyPath_aBudgetNotificationReachesTheGuard', async () => {
        const deps = opsDeps(NOW);

        await onBudgetFunction(() => deps).run(published(JSON.stringify({ costAmount: 5.5, budgetAmount: 5 })));

        expect((await guard(deps))?.state).toBe('red');
    });

    it.each([
        ['data that is not JSON', 'not json'],
        ['JSON that is no budget notification', '{"hello":"world"}'],
    ])('badPath_%s_isIgnored', async (_name, data) => {
        const deps = opsDeps(NOW);

        await onBudgetFunction(() => deps).run(published(data));

        expect(await guard(deps)).toBeUndefined();
        expect(deps.recording.records.at(-1)?.message).toBe('budget message ignored: not a budget notification');
    });

    it('happyPath_listensOnTheBudgetTopic', () => {
        expect(onBudgetFunction(() => opsDeps(NOW)).__endpoint.eventTrigger).toMatchObject({
            eventFilters: { topic: 'budget' },
            retry: false,
        });
    });
});
