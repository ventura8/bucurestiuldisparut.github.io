/** The start page's REST calls against the fake Google (`docs/research/M14-start-your-map.md` §1), what its answers come to. */
import { createUpstreamFakes, GOOGLE_TOKENS } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createGoogleTransport } from '../../src/google/transport.js';
import { createStartGoogle, type StartGoogle } from '../../src/start/google.js';
import { testLog } from '../app/fakes.js';

const PROJECT = 'fostul-bacau';

function world(): { readonly google: StartGoogle; readonly fakes: ReturnType<typeof createUpstreamFakes> } {
    const fakes = createUpstreamFakes();
    fakes.scenario('firebase-hosting.fresh');
    const google = createStartGoogle(
        createGoogleTransport({ fetch: fakes.fetch, token: () => GOOGLE_TOKENS.owner, sleep: () => Promise.resolve(), log: testLog().log }),
    );
    return { google, fakes };
}

describe('the start page and Google', () => {
    it('happyPath_aProjectIsMadeOnceThenFoundAndListed', async () => {
        const { google } = world();
        expect(await google.getProject(PROJECT)).toBeNull();
        expect(await google.listProjects()).toEqual([]);
        await google.createProject(PROJECT, 'Fostul Bacău');
        expect(await google.getProject(PROJECT)).toMatchObject({ projectId: PROJECT });
        expect(await google.listProjects()).toMatchObject([{ projectId: PROJECT, displayName: 'Fostul Bacău' }]);
    });

    it('happyPath_firebaseItsAppAndItsSite', async () => {
        const { google } = world();
        expect(await google.hasFirebase(PROJECT)).toBe(false);
        expect(await google.hasWebApp(PROJECT)).toBe(false);
        expect(await google.defaultSite(PROJECT)).toBeNull();
        await google.addFirebase(PROJECT);
        await google.createWebApp(PROJECT, 'Fostul Bacău');
        expect(await google.hasFirebase(PROJECT)).toBe(true);
        expect(await google.hasWebApp(PROJECT)).toBe(true);
        expect(await google.defaultSite(PROJECT)).toBe(PROJECT);
        expect(await google.createSite('other-project')).toBe('other-project');
    });

    it('happyPath_aVersionIsPopulatedFinalizedAndReleased', async () => {
        const { google, fakes } = world();
        const version = await google.createVersion(PROJECT, { cleanUrls: true });
        const answer = await google.populate(version, { '/index.html': 'a'.repeat(64) });
        expect(answer.required).toEqual(['a'.repeat(64)]);
        expect(answer.uploadUrl).toContain('upload-firebasehosting.googleapis.com');
        await expect(google.finalize(version)).rejects.toMatchObject({ kind: 'invalid' });
        fakes.state.startWorld.hashes.add('a'.repeat(64));
        expect((await google.populate(version, { '/index.html': 'a'.repeat(64) })).required).toEqual([]);
        await google.finalize(version);
        await google.release(PROJECT, version);
        expect(fakes.state.startWorld.live.get(PROJECT)).toBe(version);
    });

    it('badPath_aReleaseOfAnUnfinishedVersionAndARuleGoogleDoesNotKnow', async () => {
        const { google } = world();
        const version = await google.createVersion(PROJECT, {});
        await expect(google.release(PROJECT, version)).rejects.toMatchObject({ kind: 'invalid' });
        await expect(google.createVersion(PROJECT, { source: 'x' } as never)).rejects.toMatchObject({ kind: 'invalid' });
    });

    it('happyPath_googleSignInIsReadFromTheProvider', async () => {
        const { google, fakes } = world();
        expect(await google.googleSignInOn(PROJECT)).toBe(false);
        fakes.scenario('firebase-hosting.googleSignInOn');
        expect(await google.googleSignInOn(PROJECT)).toBe(true);
    });
});
