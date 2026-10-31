/**
 * Home's installation reminder (M6 installer, `docs/research/M6-interfaces.md` §1.7; A55–A57): a target recorded
 * `failed` first, else one recorded `updateAvailable`, each opening the Setup step whose card acts on it.
 */
import { describe, expect, it } from 'vitest';

import { remindersOf } from '../../src/home/reminders.js';
import { at } from '../content/world.js';

const NOW = Date.parse('2026-10-25T10:00:00Z');
const STAMP = { updatedBy: 'system:ops', updatedAt: at('2026-10-17T10:00:00Z') };
const CHECKED = '2026-10-25T09:00:00.000Z';

describe('remindersOf: the installation', () => {
    it('happyPath_anUpdateOfAnyTargetIsRemindedWithItsStep', () => {
        const install = {
            server: { state: 'installed', checkedAt: CHECKED },
            site: { state: 'updateAvailable', release: '1.0.0+abc1234', checkedAt: CHECKED },
        } as const;
        expect(remindersOf({ install, ...STAMP }, NOW)).toEqual([{ kind: 'installUpdate', step: 'site' }]);
        const server = { server: { state: 'updateAvailable', checkedAt: CHECKED } } as const;
        expect(remindersOf({ install: server, ...STAMP }, NOW)).toEqual([{ kind: 'installUpdate', step: 'deploy' }]);
    });

    it('badPath_aStoppedInstallationComesBeforeAnUpdateAndNothingInPlaceRemindsNothing', () => {
        const install = {
            server: { state: 'updateAvailable', checkedAt: CHECKED },
            pipeline: { state: 'failed', checkedAt: CHECKED, detail: 'apiError.unavailable' },
        } as const;
        expect(remindersOf({ install, ...STAMP }, NOW)).toEqual([{ kind: 'installFailed', step: 'pipeline' }]);
        const inPlace = { server: { state: 'installed', checkedAt: CHECKED }, site: { state: 'working', checkedAt: CHECKED } } as const;
        expect(remindersOf({ install: inPlace, ...STAMP }, NOW)).toEqual([]);
        expect(remindersOf({ ...STAMP }, NOW)).toEqual([]);
    });
});
