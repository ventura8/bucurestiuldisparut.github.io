import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseProjectConfig, projectNames, SERVICE_ACCOUNT_IDS } from '../../src/provision/project-config.js';
import { REQUIRED_APIS, roleTable, SECRET_IDS } from '../../src/provision/resources.js';
import { PROJECT } from './world.js';

/** `infra/project.json` and the names and roles derived from it (docs/research/M2b-interfaces.md §3.4.1, §3.7). */

const INFRA = new URL('../../../../infra/project.json', import.meta.url);

describe('parseProjectConfig', () => {
    it('happyPath_theCommittedProjectFileIsValid', () => {
        const config = parseProjectConfig(JSON.parse(readFileSync(INFRA, 'utf8')));

        expect(config).toMatchObject({ projectId: 'bucurestiul-disparut', projectNumber: '804854330662', region: 'us-central1' });
        expect(config?.github).toMatchObject({ owner: 'ventura8', branch: 'master', environment: 'deploy' });
        expect(config?.github.ownerId).toBeGreaterThan(0);
    });

    it('badPath_unsetGithubIdsOrAnHttpOriginAreRefused', () => {
        expect(parseProjectConfig({ ...PROJECT, github: { ...PROJECT.github, repoId: 0 } })).toBeUndefined();
        expect(parseProjectConfig({ ...PROJECT, viewerOrigins: ['https://ventura8.github.io/with/a/path'] })).toBeUndefined();
        expect(parseProjectConfig('not a config')).toBeUndefined();
    });
});

describe('projectNames', () => {
    it('happyPath_theBucketsOriginsAndAccountsFollowTheProjectId', () => {
        const names = projectNames(PROJECT);

        expect([names.privateBucket, names.publicBucket]).toEqual(['demo-hcm.firebasestorage.app', 'demo-hcm-public']);
        expect(names.adminOrigins).toEqual(['https://demo-hcm.web.app', 'https://demo-hcm.firebaseapp.com']);
        expect(names.member('gh-deployer')).toBe('serviceAccount:gh-deployer@demo-hcm.iam.gserviceaccount.com');
        expect(SERVICE_ACCOUNT_IDS).toEqual(['fn-admin', 'fn-events', 'fn-crash', 'job-raster', 'gh-deployer']);
    });
});

describe('the role table', () => {
    const agents = { firebaseStorage: 'fs-agent@example.test', cloudStorage: 'gcs-agent@example.test' };

    it('happyPath_everyM2bRowIsBoundOnItsResource', () => {
        const table = roleTable(PROJECT, agents, false);
        const project = table.find((policy) => policy.kind === 'project');

        expect(table.map((policy) => `${policy.kind}:${policy.resource}`)).toEqual([
            'project:demo-hcm',
            'bucket:demo-hcm.firebasestorage.app',
            'bucket:demo-hcm-public',
            ...SECRET_IDS.map((secret) => `secret:${secret}`),
            'serviceAccount:fn-admin@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:fn-crash@demo-hcm.iam.gserviceaccount.com',
            'serviceAccount:job-raster@demo-hcm.iam.gserviceaccount.com',
        ]);
        expect(project?.bindings).toContainEqual({
            role: 'roles/firebaserules.firestoreServiceAgent',
            member: 'serviceAccount:fs-agent@example.test',
        });
        expect(project?.bindings.some((binding) => binding.role === 'roles/cloudbuild.builds.builder')).toBe(false);
        expect(table.find((policy) => policy.resource === 'mapbox-sk-bootstrap')?.bindings.map((binding) => binding.member)).not.toContain(
            'serviceAccount:fn-events@demo-hcm.iam.gserviceaccount.com',
        );
        expect(REQUIRED_APIS).toHaveLength(27);
    });

    it('badPath_theCrashEndpointsAccountHoldsNoRoleOnlyTheDeployerMayActAsIt', () => {
        const crash = 'serviceAccount:fn-crash@demo-hcm.iam.gserviceaccount.com';
        const table = roleTable(PROJECT, agents, false);

        expect(table.flatMap((policy) => policy.bindings).filter((binding) => binding.member === crash)).toEqual([]);
        expect(table.find((policy) => policy.resource === 'fn-crash@demo-hcm.iam.gserviceaccount.com')?.bindings).toEqual([
            { role: 'roles/iam.serviceAccountUser', member: 'serviceAccount:gh-deployer@demo-hcm.iam.gserviceaccount.com' },
        ]);
    });

    it('badPath_withoutDefaultGrantsTheComputeAccountBuilds', () => {
        const project = roleTable(PROJECT, agents, true)[0];

        expect(project?.bindings).toContainEqual({
            role: 'roles/cloudbuild.builds.builder',
            member: 'serviceAccount:123456789012-compute@developer.gserviceaccount.com',
        });
    });
});
