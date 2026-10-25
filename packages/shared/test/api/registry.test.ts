import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    BACKGROUND_FUNCTIONS,
    CALLABLES,
    CITY_ACCESSES,
    deployedName,
    FUNCTION_OWNERS,
    HTTP_ENDPOINTS,
    type CallableAccess,
} from '../../src/api/registry.js';

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
        expect(CALLABLES['admins.invite'].request.safeParse({ cityId: 'bucharest', email: 'x', role: 'editor' }).success).toBe(false);
        expect(CALLABLES['admin.session'].request.safeParse({ extra: true }).success).toBe(false);
        expect(CALLABLES['setup.status'].request.safeParse({}).success).toBe(true);
    });
});

/** The shapes a request schema may take: an object, or a discriminated union of objects. */
function requestShapes(schema: z.ZodType): readonly z.ZodObject[] {
    if (schema instanceof z.ZodDiscriminatedUnion) {
        return schema.options as readonly z.ZodObject[];
    }
    return [schema as z.ZodObject];
}

function callablesWith(access: CallableAccess): string[] {
    return Object.entries(CALLABLES)
        .filter(([, spec]) => spec.access === access)
        .map(([name]) => name);
}

describe('the M5 access of each callable (docs/research/M5-interfaces.md §1.3)', () => {
    it('happyPath_everyCityCallableNamesItsCityAtTheTopOfItsRequest', () => {
        const scoped = Object.values(CALLABLES).filter((spec) => CITY_ACCESSES.includes(spec.access));

        expect(scoped.length).toBeGreaterThan(20);
        for (const spec of scoped) {
            for (const shape of requestShapes(spec.request)) {
                expect(Object.keys(shape.shape)).toContain('cityId');
            }
        }
    });

    it('happyPath_theProjectOwnersCallablesAreTheProjectsOwnSettings', () => {
        expect(callablesWith('projectOwner')).toEqual([
            'setup.recordCloud',
            'setup.createCity',
            'setup.saveMapbox',
            'setup.saveUsgs',
            'setup.analyticsConfig',
            'imagery.resumeGuard',
            'cities.create',
            'cities.locate',
            'cities.setLimits',
        ]);
    });

    it('badPath_onlyACitysOwnerInvitesRemovesAndRotatesItsToken', () => {
        expect(callablesWith('cityOwner')).toEqual([
            'admins.invite',
            'admins.revoke',
            'setup.rotatePublicToken',
            'admins.setRole',
            'export.start',
            'export.download',
        ]);
    });

    it('badPath_projectWideFactsStayReadableByEveryAdmin', () => {
        expect(callablesWith('admin')).toEqual([
            'telemetry.listGroups',
            'setup.status',
            'setup.selfTest',
            'notify.registerDevice',
            'notify.unregisterDevice',
            'notify.sendTest',
        ]);
    });
});
