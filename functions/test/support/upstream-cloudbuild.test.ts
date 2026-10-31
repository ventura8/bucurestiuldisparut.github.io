/**
 * The fake Cloud Build of the in-app installer (docs/research/M6-interfaces.md §1.10): a server build that would succeed
 * stops where firebase-tools' own preconditions would stop it, in the order the tool runs them: the installer's actAs on
 * the App Engine default account (finding 28 of 2026-10-31), then the discovery of the functions, which loads their
 * source and so needs their packages installed in it (finding 30).
 */
import { createUpstreamFakes, DISCOVERY_FAILURE_LINES, GOOGLE_TOKENS, type UpstreamFakes } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

const BUILDS = 'https://cloudbuild.googleapis.com/v1/projects/demo-hcm/locations/us-central1/builds';
const HEADERS = { authorization: `Bearer ${GOOGLE_TOKENS.owner}` };

/** The `functions` step's lines of the first build, as Cloud Logging answers the admin (oldest first). */
async function functionsLines(fakes: UpstreamFakes): Promise<string[]> {
    const [build] = (fakes.snapshot()['cloud-build'] as { readonly builds: readonly { readonly id: string }[] }).builds;
    const filter = `resource.type="build" AND resource.labels.build_id="${build?.id ?? ''}"`;
    const response = await fakes.fetch('https://logging.googleapis.com/v2/entries:list', {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ filter }),
    });
    const { entries = [] } = (await response.json()) as { entries?: { textPayload: string; labels: { build_step: string } }[] };
    return entries
        .filter((entry) => entry.labels.build_step.endsWith('"functions"'))
        .map((entry) => entry.textPayload)
        .reverse();
}

/** The server build's `packages` step: the functions' lock installed where firebase-tools' discovery loads them. */
const PACKAGES = { id: 'packages', entrypoint: 'npm', dir: 'server/functions/dist', args: ['ci', '--omit=dev', '--ignore-scripts'] };

/** A server build of the in-app installer, as the admin submits it, ended by the fake; its final status. */
async function serverBuild(
    fakes: UpstreamFakes,
    steps: readonly object[] = [{ id: 'fetch' }, PACKAGES, { id: 'functions' }],
): Promise<string> {
    const request = { tags: ['hcm-install', 'hcm-server', 'hcm-r-1-0-0-abc1234'], steps };
    expect((await fakes.fetch(BUILDS, { method: 'POST', headers: HEADERS, body: JSON.stringify(request) })).status).toBe(200);
    fakes.scenario('cloud-build.finish');
    const [build] = (fakes.snapshot()['cloud-build'] as { readonly builds: readonly { readonly status: string }[] }).builds;
    return build?.status ?? 'none';
}

describe("Cloud Build: firebase-tools' actAs check (finding 28 of 2026-10-31)", () => {
    it('happyPath_anInstallerMadeByPrepareTheProjectActsAsTheAppEngineAccountAndTheServerInstalls', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');
        fakes.scenario('cloud-build.installerAccount');

        expect(await serverBuild(fakes)).toBe('SUCCESS');
    });

    it('badPath_withoutTheGrantTheServerBuildStopsAtFunctionsWithFirebaseToolsLines', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');
        fakes.scenario('cloud-build.installerAccount');
        fakes.scenario('iam.appEngineActAsMissing');

        expect(await serverBuild(fakes)).toBe('FAILURE');
        expect(JSON.stringify(fakes.snapshot()['cloud-build'])).toContain('"id":"functions","status":"FAILURE"');
    });

    it.each([
        ['a project without the App Engine default account', ['iam.noAppEngineAccount', 'cloud-build.installerAccount']],
        ['a world whose IAM nothing prepared', []],
    ])('happyPath_%s_hasNoCheckToFail', async (_name, scenarios) => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');
        scenarios.forEach((scenario) => {
            fakes.scenario(scenario);
        });

        expect(await serverBuild(fakes)).toBe('SUCCESS');
    });
});

describe("Cloud Build: firebase-tools' discovery of the functions (finding 30 of 2026-10-31)", () => {
    it.each([
        ['no packages step', [{ id: 'fetch' }, { id: 'functions' }]],
        ['the packages step after functions', [{ id: 'fetch' }, { id: 'functions' }, PACKAGES]],
        ['an npm ci in another folder', [{ ...PACKAGES, dir: 'server/tools' }, { id: 'functions' }]],
        ['a step in the folder that is not npm ci', [{ ...PACKAGES, args: ['install'] }, { id: 'functions' }]],
    ])('badPath_%s_stopsTheServerBuildAtFunctionsWithFirebaseToolsLines', async (_name, steps) => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');
        fakes.scenario('cloud-build.installerAccount');

        expect(await serverBuild(fakes, steps)).toBe('FAILURE');
        expect(JSON.stringify(fakes.snapshot()['cloud-build'])).toContain('"id":"functions","status":"FAILURE"');
        expect(await functionsLines(fakes)).toEqual([...DISCOVERY_FAILURE_LINES]);
    });

    it('badPath_withoutTheActAsGrantTheActAsCheckStopsItFirst', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');
        fakes.scenario('cloud-build.installerAccount');
        fakes.scenario('iam.appEngineActAsMissing');

        expect(await serverBuild(fakes, [{ id: 'fetch' }, { id: 'functions' }])).toBe('FAILURE');
        expect((await functionsLines(fakes))[0]).toContain('Missing permissions required for functions deploy');
    });

    it('happyPath_aBuildWithoutAFunctionsStepHasNothingToDiscover', async () => {
        const fakes = createUpstreamFakes();
        fakes.scenario('google.provisioned');

        expect(await serverBuild(fakes, [{ id: 'fetch' }, { id: 'rules' }])).toBe('SUCCESS');
    });
});
