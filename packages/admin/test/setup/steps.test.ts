import { SETUP_AREAS, SETUP_REQUIRED_AREAS } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { nextSetupStep, SETUP_STEP_SPECS, SETUP_STEPS, setupInputBudget, type SetupStepId } from '../../src/setup/steps.js';

const BOOTSTRAP: readonly SetupStepId[] = ['signIn', 'billing', 'provision', 'deploy'];

describe('SETUP_STEP_SPECS', () => {
    it('happyPath_theBootstrapStepsComeFirstAndNeedNoBackend', () => {
        const withoutBackend = SETUP_STEPS.filter((id) => !SETUP_STEP_SPECS[id].needsBackend);

        expect(withoutBackend).toEqual(BOOTSTRAP);
        expect(SETUP_STEPS.slice(0, BOOTSTRAP.length)).toEqual(BOOTSTRAP);
    });

    it('happyPath_everyPrerequisiteComesEarlierOnTheScreen', () => {
        const late = SETUP_STEPS.flatMap((id, index) =>
            SETUP_STEP_SPECS[id].after.filter((before) => SETUP_STEPS.indexOf(before) >= index).map((before) => `${id} after ${before}`),
        );

        expect(late).toEqual([]);
    });

    it('happyPath_everyRequiredAreaHasARequiredStep', () => {
        const required = SETUP_STEPS.filter((id) => !SETUP_STEP_SPECS[id].optional).map((id) => SETUP_STEP_SPECS[id].area);

        expect(SETUP_REQUIRED_AREAS.every((area) => required.includes(area))).toBe(true);
        const areas = SETUP_STEPS.map((id) => SETUP_STEP_SPECS[id].area).filter((area) => area !== null);

        expect(areas.every((area) => SETUP_AREAS.includes(area))).toBe(true);
    });

    it('happyPath_onlyTheStepsThatAskGoogleCountAConsent', () => {
        const consenting = SETUP_STEPS.filter((id) => SETUP_STEP_SPECS[id].consents > 0);

        expect(consenting).toEqual(['signIn', 'billing', 'provision', 'analytics']);
        expect(consenting.every((id) => SETUP_STEP_SPECS[id].scope !== null)).toBe(true);
    });
});

describe('nextSetupStep', () => {
    it('happyPath_aNewMapStartsWithSignIn', () => {
        expect(nextSetupStep(new Set())).toBe('signIn');
    });

    it('happyPath_afterTheBootstrapStepsTheClaimIsNext', () => {
        expect(nextSetupStep(new Set(BOOTSTRAP))).toBe('claim');
    });

    it('badPath_aStepWhosePrerequisiteIsMissingIsSkipped', () => {
        expect(nextSetupStep(new Set<SetupStepId>(['mapbox']))).toBe('signIn');
        expect(nextSetupStep(new Set<SetupStepId>(['signIn', 'provision']))).toBe('billing');
    });

    it('happyPath_nothingIsNextWhenEveryStepIsDone', () => {
        expect(nextSetupStep(new Set(SETUP_STEPS))).toBeNull();
    });
});

describe('setupInputBudget', () => {
    it('happyPath_theWholeSetupTakesNineInputsAndFourConsents', () => {
        expect(setupInputBudget()).toEqual({ inputs: 9, consents: 4 });
    });

    it('happyPath_theBootstrapTakesThreeInputsAndThreeConsents', () => {
        expect(setupInputBudget(BOOTSTRAP)).toEqual({ inputs: 3, consents: 3 });
    });

    it('badPath_noStepsTakeNoInput', () => {
        expect(setupInputBudget([])).toEqual({ inputs: 0, consents: 0 });
    });
});
