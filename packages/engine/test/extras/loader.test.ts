/**
 * The extras' loader (packages/engine/src/extras/loader.ts; DECISIONS-for-review.md §159): the IIFE's extras are scripts
 * beside it, added with their integrity once each, and one that fails is logged, removed and fetched afresh next time.
 */
import { describe, expect, it } from 'vitest';

import { createExtraLoader, ExtraLoadError, type ExtraFile } from '../../src/extras/loader.js';
import { recordingLog } from '../core/support.js';
import { FakeDocument, settle } from './fake-page.js';

const COMPARE: ExtraFile = { global: 'compare', file: 'extra-compare-AbCd12_-.js', integrity: 'sha384-test-compare' };
const BASE = 'https://cdn.example.org/gh/owner/repo@v1.2.3/cdn/engine/';

function world(registry: Record<string, unknown> = {}) {
    const document = new FakeDocument();
    const recording = recordingLog();
    const load = createExtraLoader({ document, base: () => BASE, registry: () => registry, log: recording.log });
    return { document, registry, load, recording };
}

describe('createExtraLoader', () => {
    it('happyPath_theFirstWishAddsOneScriptWithItsIntegrityAndResolvesWithWhatItRegistered', async () => {
        const { document, registry, load } = world();
        const module = { compareModule: 'the chunk' };

        const first = load(COMPARE);
        const second = load(COMPARE);
        registry['compare'] = module;
        document.scripts[0]?.fire('load');

        await expect(first).resolves.toBe(module);
        await expect(second).resolves.toBe(module);
        expect(document.scripts).toHaveLength(1);
        expect(document.scripts[0]).toMatchObject({
            src: `${BASE}extra-compare-AbCd12_-.js`,
            integrity: 'sha384-test-compare',
            crossOrigin: 'anonymous',
            async: true,
            removed: false,
        });
        await expect(load(COMPARE)).resolves.toBe(module);
        expect(document.scripts).toHaveLength(1);
    });

    it('happyPath_anExtraAlreadyRegisteredOnThePageNeedsNoScript', async () => {
        const module = { gamepad: true };
        const { document, load } = world({ gamepad: module });

        await expect(load({ global: 'gamepad', file: 'extra-gamepad-x.js', integrity: 'sha384-g' })).resolves.toBe(module);
        expect(document.scripts).toHaveLength(0);
    });

    it('badPath_aChunkThatFailsIsLoggedRemovedAndFetchedAfreshNextTime', async () => {
        const { document, registry, load, recording } = world();

        const failed = load(COMPARE);
        document.scripts[0]?.fire('error');

        await expect(failed).rejects.toBeInstanceOf(ExtraLoadError);
        await expect(failed).rejects.toThrow('the extra extra-compare-AbCd12_-.js could not be loaded');
        expect(document.scripts[0]?.removed).toBe(true);
        expect(recording.messages()).toEqual(['extra not loaded']);
        expect(recording.records[0]?.data).toMatchObject({ file: 'extra-compare-AbCd12_-.js' });

        const retried = load(COMPARE);
        registry['compare'] = { compareModule: 'now' };
        document.scripts[1]?.fire('load');

        await expect(retried).resolves.toEqual({ compareModule: 'now' });
        expect(document.scripts).toHaveLength(2);
    });

    it('badPath_aScriptThatRunsButRegistersNothingFails', async () => {
        const { document, load } = world();

        const loaded = load(COMPARE);
        document.scripts[0]?.fire('load');
        await settle();

        await expect(loaded).rejects.toThrow('the extra extra-compare-AbCd12_-.js registered nothing');
        expect(document.scripts[0]?.removed).toBe(true);
        const error = await loaded.catch((caught: unknown) => caught);
        expect(error).toMatchObject({ name: 'ExtraLoadError', file: 'extra-compare-AbCd12_-.js' });
    });
});
