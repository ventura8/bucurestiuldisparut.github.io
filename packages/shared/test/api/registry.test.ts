import { describe, expect, it } from 'vitest';

import { BACKGROUND_FUNCTIONS, CALLABLES, deployedName, FUNCTION_OWNERS, HTTP_ENDPOINTS } from '../../src/api/registry.js';

const NAME = /^[a-z]+\.[a-zA-Z]+$/;

describe('the function registry', () => {
    it('happyPath_everyFunctionHasANamespacedNameAndAnOwner', () => {
        const all = { ...CALLABLES, ...HTTP_ENDPOINTS, ...BACKGROUND_FUNCTIONS };

        for (const [name, spec] of Object.entries(all)) {
            expect(name).toMatch(NAME);
            expect(FUNCTION_OWNERS).toContain(spec.owner);
        }
        expect(Object.keys(all)).toHaveLength(
            Object.keys(CALLABLES).length + Object.keys(HTTP_ENDPOINTS).length + Object.keys(BACKGROUND_FUNCTIONS).length,
        );
    });

    it('happyPath_deployedNamesUseADash', () => {
        expect(deployedName('admin.claim')).toBe('admin-claim');
        expect(Object.keys(CALLABLES).map(deployedName)).toContain('setup-saveMapbox');
    });

    it('badPath_onlyOwnershipAndJoiningAreOpenToNonAdmins', () => {
        const open = Object.entries(CALLABLES)
            .filter(([, spec]) => spec.access === 'signedIn')
            .map(([name]) => name);

        expect(open).toEqual(['admin.session', 'admin.claim', 'admin.join']);
    });

    it('badPath_everySecretPasteLayerDeletePaidOverageAndGuardResumeConsumesItsAppCheckToken', () => {
        const consuming = Object.entries(CALLABLES)
            .filter(([, spec]) => spec.appCheck === 'consume')
            .map(([name]) => name);

        expect(consuming).toEqual([
            'admin.claim',
            'admin.join',
            'setup.saveMapbox',
            'setup.saveUsgs',
            'setup.rotatePublicToken',
            'layers.delete',
            'imagery.choose',
            'imagery.resumeGuard',
        ]);
    });

    it('badPath_eachCallableValidatesItsRequest', () => {
        expect(CALLABLES['admins.invite'].request.safeParse({ email: 'x' }).success).toBe(false);
        expect(CALLABLES['admin.session'].request.safeParse({ extra: true }).success).toBe(false);
        expect(CALLABLES['setup.status'].request.safeParse({}).success).toBe(true);
    });
});
