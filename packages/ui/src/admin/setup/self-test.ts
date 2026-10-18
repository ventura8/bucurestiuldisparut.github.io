/**
 * What the last self-test found, check by check (`setup.selfTest`, Check again in normal mode; `docs/research/M2-interfaces.md`
 * §3.3; S-A03-BAD-SELFTEST-FAILURE, `DECISIONS-for-review.md` §42b): every check of `SELF_TEST_CHECKS` with its state, a
 * failing check's reason in the admin's language, and a link to the step that fixes it (the cloud checks to Prepare the
 * project, Mapbox and USGS to their cards, Error Reporting to the analytics card). Text only.
 */
import type { Locale, SelfTestCheck, ServiceState } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';

import type { SetupStepId, SetupViewState } from './setup-port.js';
import { setupLabel, setupText } from './setup-text.js';

/** The step whose card fixes what a check found. */
const STEP_OF: Readonly<Record<SelfTestCheck, SetupStepId>> = {
    firestore: 'provision',
    secrets: 'provision',
    'private-bucket': 'provision',
    'public-bucket': 'provision',
    'task-queue': 'provision',
    mapbox: 'mapbox',
    usgs: 'usgs',
    'firebase-management': 'provision',
    'error-reporting': 'analytics',
};

const ICONS: Readonly<Record<ServiceState, string>> = {
    missing: 'info',
    pending: 'schedule',
    ok: 'check_circle',
    invalid: 'error',
    unavailable: 'warning',
};

type CheckView = SetupViewState['selfTest']['checks'][number];

function fix(locale: Locale, check: CheckView): TemplateResult {
    if (check.state === 'ok') {
        return EMPTY;
    }
    const step = STEP_OF[check.id];
    const name = setupLabel(locale, `adminSetup.step.${step}`);
    return html`<a class="fix" href=${['#', 'setup', step].join('/')}>${setupLabel(locale, 'adminSetup.selfTest.fix', { step: name })}</a>`;
}

function checkRow(locale: Locale, check: CheckView): TemplateResult {
    return html`<li class="check" data-check=${check.id} data-state=${check.state}>
        <hcm-icon name=${ICONS[check.state]}></hcm-icon>
        <span>${setupLabel(locale, `adminSetup.selfTest.check.${check.id}`)}</span>
        <span class="state">${setupLabel(locale, `adminSetup.state.${check.state}`)}</span>
        ${check.detail === null ? nothing : html`<span class="reason">${setupText(locale, check.detail)}</span>`} ${fix(locale, check)}
    </li>`;
}

/** The checks of the last self-test; nothing before Check again ran one. */
export function selfTestList(locale: Locale, view: SetupViewState): TemplateResult {
    const { checks } = view.selfTest;
    if (checks.length === 0) {
        return EMPTY;
    }
    return html`<section class="self-test" aria-labelledby="self-test-title">
        <h2 id="self-test-title" class="title-medium">${setupLabel(locale, 'adminSetup.selfTest.title')}</h2>
        <p class="note">${setupLabel(locale, 'adminSetup.selfTest.intro')}</p>
        <ul class="checks">
            ${checks.map((check) => checkRow(locale, check))}
        </ul>
    </section>`;
}

/** The list as the provisioning doctor's: an icon, the check, its state, its reason and the fix, each on its own line. */
export const selfTestStyles = css`
    .self-test {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
    }

    .self-test h2 {
        margin: 0;
    }

    .checks {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .check {
        display: grid;
        grid-template-columns: 24px minmax(0, 1fr);
        gap: 2px 12px;
        align-items: center;
        min-block-size: 40px;
    }

    .check .state,
    .check .reason,
    .check .fix {
        grid-column: 2;
    }

    .check .state,
    .check .reason {
        color: var(--md-sys-color-on-surface-variant);
    }

    .check .fix {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
    }

    .check[data-state='ok'] hcm-icon {
        color: var(--md-sys-color-primary);
    }

    .check[data-state='invalid'] hcm-icon,
    .check[data-state='unavailable'] hcm-icon {
        color: var(--md-sys-color-error);
    }
`;
