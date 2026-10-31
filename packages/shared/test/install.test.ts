import { describe, expect, it } from 'vitest';

import {
    INSTALL_STEP_IDS,
    INSTALL_STEPS,
    INSTALL_TARGETS,
    compareRelease,
    installLogLine,
    installManifestSchema,
    installRecordSchema,
    installReleaseSlug,
    parseInstallLogLine,
    releaseOfSlug,
    setupInstallSchema,
    transientDeployReason,
    type InstallManifest,
} from '../src/schemas/install.js';

const NODE = `node:24-bookworm-slim@sha256:${'d'.repeat(64)}`;

function manifest(changes: Partial<Record<keyof InstallManifest, unknown>> = {}): Record<string, unknown> {
    return {
        format: 1,
        release: '1.0.0+abc1234',
        slug: '1-0-0-abc1234',
        projectId: 'demo-hcm',
        files: {
            server: { name: 'server.tgz', bytes: 1000, sha256: 'a'.repeat(64) },
            pipeline: { name: 'pipeline.tgz', bytes: 2000, sha256: 'b'.repeat(64) },
            site: { name: 'hosting.tgz', bytes: 3000, sha256: 'c'.repeat(64) },
        },
        functions: ['admin-session', 'setup-status'],
        tools: { firebaseTools: '15.33.0', node: NODE, docker: null },
        estimates: { server: { buildMinutes: 85 }, pipeline: { buildMinutes: 20 }, site: { buildMinutes: 5 } },
        ...changes,
    };
}

describe('the install release', () => {
    it('happyPath_aReleaseBecomesASlugSafeInAPathATagAndALabel', () => {
        expect(installReleaseSlug('1.0.0+abc1234')).toBe('1-0-0-abc1234');
        expect(installReleaseSlug('0.0.0')).toBe('0-0-0');
        expect(installReleaseSlug('--A.B--')).toBe('a-b');
    });

    it('badPath_aSlugNeverEndsInAHyphenNorRunsLongerThanALabel', () => {
        const slug = installReleaseSlug(`${'a'.repeat(62)}.b`);

        expect(slug).toBe('a'.repeat(62));
        expect(installReleaseSlug('+++')).toBe('release');
    });

    it('happyPath_aSlugGoesBackToItsRelease_badPath_anyOtherSlugHasNone', () => {
        expect(releaseOfSlug('1-0-0-abc1234')).toBe('1.0.0+abc1234');
        expect(releaseOfSlug('0-0-0')).toBe('0.0.0');
        expect(releaseOfSlug('release')).toBeNull();
        expect(releaseOfSlug(installReleaseSlug('2.10.3+0f1e2d3'))).toBe('2.10.3+0f1e2d3');
    });

    it('happyPath_theVersionDecidesFirst', () => {
        expect(compareRelease('1.0.0+aaaaaaa', '1.1.0+bbbbbbb')).toBe(-1);
        expect(compareRelease('2.0.0+aaaaaaa', '1.9.9+bbbbbbb')).toBe(1);
        expect(compareRelease('1.0.0+abc1234', '1.0.0+abc1234')).toBe(0);
    });

    it('badPath_anotherBuildOfTheSameVersionCountsAsOlder', () => {
        expect(compareRelease('1.0.0+aaaaaaa', '1.0.0+bbbbbbb')).toBe(-1);
        expect(compareRelease('1.0.0', '1.0.0+bbbbbbb')).toBe(-1);
    });

    it('badPath_anInstalledReleaseThatDoesNotParseIsOlder_aBundleThatDoesNotParseIsNever', () => {
        expect(compareRelease('e2e', '1.0.0+abc1234')).toBe(-1);
        expect(compareRelease('1.0.0+abc1234', 'not a release')).toBe(1);
    });
});

describe('the install manifest', () => {
    it('happyPath_aBundleManifestParses', () => {
        expect(installManifestSchema.safeParse(manifest()).success).toBe(true);
        expect(installManifestSchema.safeParse(manifest({ tools: { firebaseTools: '15.33.0', node: NODE, docker: NODE } })).success).toBe(
            true,
        );
    });

    it.each([
        ['another format', { format: 2 }],
        ['a slug of another release', { slug: '1-0-1-abc1234' }],
        [
            'a tarball under another name',
            { files: { ...(manifest()['files'] as object), site: { name: 'site.tgz', bytes: 1, sha256: 'c'.repeat(64) } } },
        ],
        ['an image by tag only', { tools: { firebaseTools: '15.33.0', node: 'node:24', docker: null } }],
        ['another firebase-tools', { tools: { firebaseTools: '15.0.0', node: NODE, docker: null } }],
        [
            'a digest that is not hex',
            { files: { ...(manifest()['files'] as object), server: { name: 'server.tgz', bytes: 1, sha256: 'z'.repeat(64) } } },
        ],
        ['no function', { functions: [] }],
    ])('badPath_aManifestWith %s is refused', (_name, changes) => {
        expect(installManifestSchema.safeParse(manifest(changes)).success).toBe(false);
    });
});

describe('the build log events', () => {
    it('happyPath_anEventRoundTripsThroughItsLogLine', () => {
        const retry = { event: 'retry', attempt: 2, waitSeconds: 120, reason: 'eventarcAgent' } as const;

        expect(installLogLine(retry)).toBe('HCM_INSTALL {"event":"retry","attempt":2,"waitSeconds":120,"reason":"eventarcAgent"}');
        expect(parseInstallLogLine(`Step #3 - "functions": ${installLogLine(retry)}`)).toEqual(retry);
        expect(parseInstallLogLine(installLogLine({ event: 'missing', name: 'ops-tick' }))).toEqual({ event: 'missing', name: 'ops-tick' });
    });

    it.each([
        ['an ordinary line', 'i  deploying functions'],
        ['a line that is not JSON', 'HCM_INSTALL {not json'],
        ['an unknown event', 'HCM_INSTALL {"event":"surprise"}'],
        ['a retry for an unknown reason', 'HCM_INSTALL {"event":"retry","attempt":1,"waitSeconds":60,"reason":"other"}'],
    ])('badPath_%s carries no event', (_name, line) => {
        expect(parseInstallLogLine(line)).toBeNull();
    });

    it('happyPath_theKnownRacesAreRecognised_badPath_anyOtherFailureIsNot', () => {
        expect(transientDeployReason('Permission denied while using the Eventarc Service Agent. ... may take a few minutes')).toBe(
            'eventarcAgent',
        );
        expect(transientDeployReason('HTTP Error: 429, Quota exceeded for quota metric')).toBe('quota');
        expect(transientDeployReason('HTTP Error: 409, unable to queue the operation')).toBe('operationInProgress');
        expect(transientDeployReason('HTTP Error: 503, The service is currently unavailable.')).toBe('unavailable');
        expect(transientDeployReason('Error: Failed to load function definition from source')).toBeNull();
    });
});

describe('the install records', () => {
    it('happyPath_eachTargetKeepsItsStateReleaseAndBuild', () => {
        const record = { state: 'installed', release: '1.0.0+abc1234', buildId: '0123abcd-0000', checkedAt: '2026-10-25T10:00:00.000Z' };

        expect(setupInstallSchema.parse({ server: record, site: { state: 'notInstalled', checkedAt: record.checkedAt } })).toEqual({
            server: record,
            site: { state: 'notInstalled', checkedAt: record.checkedAt },
        });
        expect(installRecordSchema.safeParse({ ...record, detail: 'apiError.install.failed', params: { step: 'functions' } }).success).toBe(
            true,
        );
    });

    it.each([
        ['an unknown state', { state: 'done', checkedAt: '2026-10-25T10:00:00.000Z' }],
        ['a free-text reason', { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', detail: 'it broke' }],
        [
            'too many params',
            { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', params: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' } },
        ],
        ['an unknown field', { state: 'failed', checkedAt: '2026-10-25T10:00:00.000Z', log: 'ya29.secret' }],
    ])('badPath_a record with %s is refused', (_name, record) => {
        expect(installRecordSchema.safeParse(record).success).toBe(false);
    });

    it('happyPath_everyTargetHasItsStepsAndEveryStepIsListedOnce', () => {
        expect(INSTALL_TARGETS.flatMap((target) => INSTALL_STEPS[target]).every((step) => INSTALL_STEP_IDS.includes(step))).toBe(true);
        expect(new Set(INSTALL_STEP_IDS).size).toBe(INSTALL_STEP_IDS.length);
        expect(INSTALL_STEPS.server[0]).toBe('fetch');
    });
});
