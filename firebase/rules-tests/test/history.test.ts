/**
 * `<audited document>/history/{entry}` (PLAN Addendum 3, docs/research/M2-interfaces.md §2.2): the history.* triggers
 * and history.revert write it with the Admin SDK; admins read it, ordered by entry id, and no client creates, edits or
 * deletes an entry, not even an admin (S-A23-BAD-CLIENT-WRITE).
 */
import { FIRESTORE_PATHS, HISTORY_ENTITIES, historyEntryId, type HistoryEntity } from '@hcm/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { historyEntryDoc } from './support/documents.js';
import { EVERYONE, createWorld, expected, stampedBy, verdict, verdicts, type World } from './support/world.js';

const CITY_ID = 'rules-history';
const ENTRY_ID = historyEntryId(new Date(Date.UTC(2026, 9, 12)), 'event-1');

let world: World;

function historyOf(entity: HistoryEntity): string {
    return FIRESTORE_PATHS.history({ entity, cityId: CITY_ID, entityId: entity === 'city' ? CITY_ID : `${entity}-1` });
}

beforeAll(async () => {
    world = await createWorld('history');
    const seeds = HISTORY_ENTITIES.flatMap((entity) =>
        [ENTRY_ID, `${ENTRY_ID}x`].map((id) => world.seed(`${historyOf(entity)}/${id}`, historyEntryDoc(world.uid('admin')))),
    );
    await Promise.all(seeds);
});

afterAll(async () => {
    await world.close();
});

describe("the city's recent changes", () => {
    it('happyPath_onlyAdminsQueryEveryHistoryAtOnceNewestFirst', async () => {
        const recent = await verdicts(EVERYONE, (persona) =>
            world.db(persona).collectionGroup('history').orderBy('updatedAt', 'desc').limit(50).get(),
        );
        const deleted = await verdicts(EVERYONE, (persona) =>
            world.db(persona).collectionGroup('history').where('action', '==', 'delete').orderBy('updatedAt', 'desc').get(),
        );

        expect({ recent, deleted }).toEqual({ recent: expected(EVERYONE, ['admin']), deleted: expected(EVERYONE, ['admin']) });
    });

    it('badPath_noClientWritesAnEntryThroughTheCollectionGroupEither', async () => {
        const db = world.db('admin');
        const forged = { ...historyEntryDoc(world.uid('admin')), ...stampedBy(world.uid('admin')) };

        const create = await verdict(db.doc(`elsewhere/x/history/${ENTRY_ID}`).set(forged));

        expect(create).toBe('deny');
    });
});

describe.each(HISTORY_ENTITIES)('history of a %s', (entity) => {
    it('happyPath_onlyAdminsReadTheHistoryNewestFirst', async () => {
        const entries = await verdicts(EVERYONE, (persona) =>
            world.db(persona).collection(historyOf(entity)).orderBy('updatedAt', 'desc').get(),
        );
        const entry = await verdicts(EVERYONE, (persona) =>
            world
                .db(persona)
                .doc(`${historyOf(entity)}/${ENTRY_ID}`)
                .get(),
        );

        expect({ entries, entry }).toEqual({ entries: expected(EVERYONE, ['admin']), entry: expected(EVERYONE, ['admin']) });
    });

    it('badPath_noClientCreatesChangesOrDeletesAnEntry @S-A23-BAD-CLIENT-WRITE', async () => {
        const db = world.db('admin');
        const forged = { ...historyEntryDoc(world.uid('admin')), ...stampedBy(world.uid('admin')) };

        const create = await verdict(db.doc(`${historyOf(entity)}/forged`).set(forged));
        const update = await verdict(
            db.doc(`${historyOf(entity)}/${ENTRY_ID}`).update({ action: 'revert', ...stampedBy(world.uid('admin')) }),
        );
        const remove = await verdict(db.doc(`${historyOf(entity)}/${ENTRY_ID}x`).delete());

        expect({ create, update, remove }).toEqual({ create: 'deny', update: 'deny', remove: 'deny' });
    });
});
