// A recorded build at work is not shown as running before a look (the live finding of 2026-11-08: right after Setup
// opened, steps d and d3 said "Installing" with every step "next" until Cloud Build answered "An update is ready").
import { axeViolations } from '@hcm/test-support/axe';
import { html, type LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmSetupDeploy } from '../../../src/admin/setup/hcm-setup-deploy.js';
import { defineHcmSetupPipeline } from '../../../src/admin/setup/hcm-setup-pipeline.js';
import { cleanup, fixture, shadowPart } from '../../helpers.js';
import { FakeSetupPort, setupView, stepView } from './fixtures.js';
import { installSliceView, type InstallChanges } from './install-fixtures.js';

defineHcmSetupDeploy();
defineHcmSetupPipeline();

const SEEN = '2026-11-08T09:00:00.000Z';

async function card(tag: 'deploy' | 'pipeline', install: InstallChanges, locale = 'en') {
    const base = setupView({ install: installSliceView(install) });
    const port = new FakeSetupPort({ ...base, steps: { ...base.steps, pipeline: stepView('pipeline'), site: stepView('site') } });
    const templates = {
        deploy: html`<hcm-setup-deploy .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-deploy>`,
        pipeline: html`<hcm-setup-pipeline .view=${port.getState()} .intents=${port.intents} locale=${locale}></hcm-setup-pipeline>`,
    };
    return fixture<LitElement>(templates[tag]);
}

describe('a recorded build at work, before the card looks', () => {
    afterEach(cleanup);

    it('happyPath_theCardSaysItIsCheckingWithNoStepsAndWhenItWasLastSeen', async () => {
        const recorded = { state: 'working', recorded: true, checkedAt: SEEN, buildId: '0e2e0b1d-0001' } as const;
        const server = await card('deploy', { server: recorded });
        const pipeline = await card('pipeline', { pipeline: { ...recorded, state: 'queued' } }, 'ro');

        expect(shadowPart(server, '.install-state').dataset['state']).toBe('checking');
        expect(shadowPart(server, '.install-state').textContent.trim()).toBe('Checking the installation…');
        expect(shadowPart(server, '.install').textContent).toContain('Last seen at work on');
        expect(shadowPart(server, '.install').textContent).not.toContain('Installing');
        expect(server.renderRoot.querySelector('.build-steps')).toBeNull();
        expect(shadowPart(pipeline, '.install-state').textContent.trim()).toBe('Se verifică instalarea…');
        expect(pipeline.renderRoot.querySelector('.build-steps')).toBeNull();
        expect(await axeViolations(server)).toEqual([]);
    });

    it('badPath_aBuildTheCardSawAtWorkStillShowsItsSteps_andARecordedEndedOneItsState', async () => {
        const looked = await card('deploy', { server: { state: 'working', checkedAt: SEEN, startedAt: SEEN } });
        const ended = await card('pipeline', { pipeline: { state: 'installed', recorded: true, checkedAt: SEEN } });

        expect(shadowPart(looked, '.install-state').textContent.trim()).toBe('Installing');
        expect(looked.renderRoot.querySelector('.build-steps')).not.toBeNull();
        expect(shadowPart(looked, '.install').textContent).not.toContain('Last seen at work');
        expect(shadowPart(ended, '.install-state').dataset['state']).toBe('installed');
    });

    it('happyPath_aRecordedPipelineAtWorkDoesNotHoldBackTheServersUpdate_aLookedAtOneDoes', async () => {
        const update = { state: 'updateAvailable', checkedAt: SEEN } as const;
        await card('deploy', { server: update, pipeline: { state: 'working', recorded: true, checkedAt: SEEN } });
        await expect.element(page.getByRole('button', { name: 'Update the map' })).toBeVisible();
        cleanup();

        await card('deploy', { server: update, pipeline: { state: 'working', checkedAt: SEEN } });
        await expect.element(page.getByRole('button', { name: 'Update the map' })).not.toBeInTheDocument();
    });
});
