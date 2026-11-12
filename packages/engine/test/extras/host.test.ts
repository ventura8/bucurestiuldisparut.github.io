/** The extras' host on the page (packages/engine/src/extras/host.ts; DECISIONS-for-review.md §159). */
import { describe, expect, it } from 'vitest';

import { EXTRAS_HOST_GLOBAL, installExtrasHost } from '../../src/extras/host.js';

describe('installExtrasHost', () => {
    it('happyPath_installsLitAndSharedBindingsOnAPropertyThatIsNotPartOfTheApi', () => {
        const scope: Record<string, unknown> = {};

        const host = installExtrasHost(scope);

        expect(scope[EXTRAS_HOST_GLOBAL]).toBe(host);
        expect(Object.keys(scope)).toEqual([]);
        expect(typeof host.lit.html).toBe('function');
        expect(typeof host.lit.LitElement).toBe('function');
        expect(typeof host.shared.translate).toBe('function');
        expect(typeof host.shared.createViewerGuard).toBe('function');
        expect(host.extras).toEqual({});
    });

    it('badPath_aSecondEngineSharesTheFirstHostAndAStrangeValueIsReplaced', () => {
        const scope: Record<string, unknown> = {};
        const first = installExtrasHost(scope);
        first.extras['compare'] = { compareModule: 1 };

        expect(installExtrasHost(scope)).toBe(first);

        const strange: Record<string, unknown> = { [EXTRAS_HOST_GLOBAL]: { extras: {} } };
        const replaced = installExtrasHost(strange);
        expect(replaced).toBe(strange[EXTRAS_HOST_GLOBAL]);
        expect(typeof replaced.shared.translate).toBe('function');
        expect(installExtrasHost({ [EXTRAS_HOST_GLOBAL]: null })).toMatchObject({ extras: {} });
    });
});
