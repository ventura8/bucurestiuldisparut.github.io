/**
 * What every install card shows of its target (`docs/research/M6-interfaces.md` §1.7, §1.8): the target's state with
 * an icon (never colour alone), what is installed, the build's steps while it runs (the one under way named), Google's
 * retry while a first-deploy race settles, a stopped build's step, its log's last lines (redacted by the admin, shown as
 * text only) and its page in the Google Cloud console, why the card's button is off, and the cost line. The cards'
 * bodies (`hcm-setup-deploy`, `hcm-setup-pipeline`, `hcm-setup-site`) render it with their own button.
 */
import type { InstallState, InstallTarget, Locale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import type { InstallSliceView, InstallTargetViewPort, SetupIntentsPort, SetupMessage, SetupStepId } from './setup-port.js';
import { formatDateTime, setupLabel, setupText } from './setup-text.js';

/** The state's icon. */
const STATE_ICONS: Readonly<Record<InstallState, string>> = {
    notInstalled: 'info',
    queued: 'schedule',
    working: 'pending',
    retrying: 'schedule',
    installed: 'check_circle',
    updateAvailable: 'arrow_upward',
    newerInstalled: 'info',
    failed: 'error',
    unavailable: 'warning',
};

const STEP_ICONS: Readonly<Record<InstallTargetViewPort['steps'][number]['state'], string>> = {
    done: 'check_circle',
    now: 'pending',
    waiting: 'schedule',
    failed: 'error',
};

/** The states in which a click installs (the card's own button: Install, Publish, Try again). */
export const INSTALLABLE_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['notInstalled', 'failed', 'unavailable']);

/** The blockers whose fix is Prepare the project (step c): the card links it. */
const FIXED_IN_PROVISION: ReadonlySet<string> = new Set(['apiError.install.notProvisioned', 'apiError.install.noRepository']);

const RUNNING: ReadonlySet<InstallState> = new Set<InstallState>(['queued', 'working', 'retrying']);

export const installStatusStyles = css`
    .install {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .install-state {
        display: flex;
        gap: 8px;
        align-items: center;
        margin: 0;
        font-weight: var(--md-sys-typescale-label-large-weight);

        --hcm-icon-size: 20px;
    }

    .install-state[data-state='installed'] hcm-icon,
    .build-steps [data-state='done'] hcm-icon {
        color: var(--md-sys-color-primary);
    }

    .install-state[data-state='failed'] hcm-icon,
    .build-steps [data-state='failed'] hcm-icon {
        color: var(--md-sys-color-error);
    }

    .build-steps {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .build-steps li {
        display: grid;
        grid-template-columns: 20px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
        min-block-size: 32px;

        --hcm-icon-size: 18px;
    }

    .build-steps .step-state {
        color: var(--md-sys-color-on-surface-variant);
    }

    .build-steps [data-state='now'] {
        font-weight: var(--md-sys-typescale-label-large-weight);
    }

    .log {
        box-sizing: border-box;
        max-inline-size: 100%;
        max-block-size: 320px;
        margin: 0;
        padding: 8px 12px;
        overflow: auto;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-surface-container-highest);
        color: var(--md-sys-color-on-surface);
        font-family: ui-monospace, monospace;
        font-size: var(--md-sys-typescale-body-small-size);
        line-height: var(--md-sys-typescale-body-small-line-height);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    /* Every link and disclosure of the install cards is a 48 px target (M3's minimum on a compact or medium window). */
    .install a,
    a.public-map {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
    }

    /* A disclosure keeps its marker (display: list-item): 14 px above and below its 20 px line make 48 px. */
    details.github > summary {
        box-sizing: border-box;
        min-block-size: 48px;
        padding-block: 14px;
        cursor: pointer;
    }

    .blocker {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 8px;
        align-items: center;
    }
`;

/** What a card renders the status with: its target, the slice, the language and the intents. */
export interface InstallStatusInput {
    readonly target: InstallTarget;
    readonly slice: InstallSliceView;
    readonly locale: Locale;
    readonly intents: SetupIntentsPort | null;
    /** The card's step (Update the map counts its click there). */
    readonly step: SetupStepId;
}

function label(input: InstallStatusInput, key: Parameters<typeof setupLabel>[1], params?: Readonly<Record<string, string>>): string {
    return setupLabel(input.locale, key, params);
}

function text(input: InstallStatusInput, message: SetupMessage): string {
    return setupText(input.locale, message);
}

/** The view of the input's target. */
function targetOf(input: Pick<InstallStatusInput, 'target' | 'slice'>): InstallTargetViewPort {
    return input.slice[input.target];
}

/** True while a build of the target is queued or working. */
function installRunning(view: InstallTargetViewPort): boolean {
    return RUNNING.has(view.state);
}

/** The card's own button may install now: an installable state, no blocker, no click in progress. */
export function mayInstall(view: InstallTargetViewPort): boolean {
    return INSTALLABLE_STATES.has(view.state) && view.blocker === null && !view.busy;
}

function stateLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    return html`<p class="install-state" data-state=${view.state} role="status">
        <hcm-icon name=${STATE_ICONS[view.state]}></hcm-icon>${label(input, `adminSetup.install.state.${view.state}`)}
    </p>`;
}

function installedLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const release = view.installedRelease;
    if (release === null || view.state === 'newerInstalled') {
        return EMPTY;
    }
    // A release recorded or installed elsewhere (GitHub Actions) has no build of this admin to date it.
    const text =
        view.finishedAt === null
            ? label(input, 'adminSetup.install.installedRelease', { release })
            : label(input, 'adminSetup.install.installed', { release, date: formatDateTime(input.locale, view.finishedAt) });
    return html`<p class="note">${text}</p>`;
}

function stepsList(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    return html`<ol class="build-steps" aria-label=${label(input, 'adminSetup.install.steps')}>
        ${view.steps.map(
            (step) =>
                html`<li data-step=${step.id} data-state=${step.state} aria-current=${step.state === 'now' ? 'step' : nothing}>
                    <hcm-icon name=${STEP_ICONS[step.state]}></hcm-icon><span>${label(input, `adminSetup.install.step.${step.id}`)}</span
                    ><span class="step-state">${label(input, `adminSetup.install.stepState.${step.state}`)}</span>
                </li>`,
        )}
    </ol>`;
}

function minutesBetween(from: string | null, to: string | null): number | null {
    if (from === null || to === null) {
        return null;
    }
    const minutes = Math.floor((Date.parse(to) - Date.parse(from)) / 60_000);
    return Number.isNaN(minutes) ? null : Math.max(0, minutes);
}

function runningFor(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const minutes = minutesBetween(view.startedAt, view.checkedAt);
    return minutes === null
        ? EMPTY
        : html`<p class="note">${label(input, 'adminSetup.install.runningFor', { minutes: String(minutes) })}</p>`;
}

function retryLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state !== 'retrying' || view.retryReason === null) {
        return EMPTY;
    }
    const what = label(input, `adminSetup.install.retry.${view.retryReason}`);
    const time = view.retryAt === null ? '' : formatDateTime(input.locale, view.retryAt);
    return html`<p class="note retrying">${label(input, 'adminSetup.install.retrying', { what, time })}</p>`;
}

function running(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (!installRunning(view)) {
        return EMPTY;
    }
    return html`${stepsList(input, view)}${runningFor(input, view)}${retryLine(input, view)}`;
}

function consoleLink(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.consoleUrl === null) {
        return EMPTY;
    }
    return html`<a href=${view.consoleUrl} target="_blank" rel="noopener noreferrer"
        >${label(input, 'adminSetup.install.openBuild')}<span class="visually-hidden"> ${label(input, 'adminSetup.newTab')}</span></a
    >`;
}

function logLines(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.log.length === 0) {
        return html`<p class="note">${label(input, 'adminSetup.install.logEmpty')}</p>`;
    }
    return html`<p class="note">${label(input, 'adminSetup.install.logTitle')}</p>
        <pre class="log" tabindex="0" aria-label=${label(input, 'adminSetup.install.logTitle')}>${view.log.join('\n')}</pre>`;
}

function missingLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    return view.missing.length === 0
        ? EMPTY
        : html`<p class="missing">${label(input, 'adminSetup.install.missing', { names: view.missing.join(', ') })}</p>`;
}

function stopped(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state !== 'failed') {
        return EMPTY;
    }
    const step = view.failedStep === null ? '' : label(input, `adminSetup.install.step.${view.failedStep}`);
    return html`<p class="failed-at">${label(input, 'adminSetup.install.failedAt', { step })}</p>
        ${missingLine(input, view)} ${logLines(input, view)} ${consoleLink(input, view)}`;
}

function updateLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    if (view.state === 'newerInstalled') {
        return html`<p class="note">${label(input, 'adminSetup.install.newer', { release: view.installedRelease ?? '' })}</p>`;
    }
    if (view.state !== 'updateAvailable') {
        return EMPTY;
    }
    return html`<p>${label(input, 'adminSetup.install.update', { release: input.slice.release })}</p>
        <div class="actions">
            <hcm-button
                variant="filled"
                icon="arrow_upward"
                ?disabled=${view.busy}
                @click=${() => {
                    input.intents?.updateMap(input.step);
                }}
                >${label(input, 'adminSetup.install.updateAction')}</hcm-button
            >
        </div>`;
}

/** Why the button is off, with a link to step c when Prepare the project fixes it. */
export function blockerLine(input: InstallStatusInput, view: InstallTargetViewPort): TemplateResult {
    const { blocker } = view;
    if (blocker === null) {
        return EMPTY;
    }
    const toProvision = FIXED_IN_PROVISION.has(blocker.key);
    return html`<p class="blocker" data-blocker=${blocker.key}>
        <span>${label(input, 'adminSetup.install.offReason')}</span><span>${text(input, blocker)}</span>
        ${
            toProvision
                ? html`<hcm-button
                      variant="text"
                      @click=${() => {
                          input.intents?.open('provision');
                      }}
                      >${label(input, 'adminSetup.install.openProvision')}</hcm-button
                  >`
                : nothing
        }
    </p>`;
}

/** The frame's cost line of each install card's step (the frame leaves it to the card: one cost line per card). */
const STEP_COST: Readonly<Record<InstallTarget, 'adminSetup.cost.deploy' | 'adminSetup.cost.pipeline' | 'adminSetup.cost.site'>> = {
    server: 'adminSetup.cost.deploy',
    pipeline: 'adminSetup.cost.pipeline',
    site: 'adminSetup.cost.site',
};

/** What one Publish the map moves out of Hosting's free daily transfer (the site's card only). */
function transferText(input: InstallStatusInput): string {
    return input.target === 'site'
        ? ` ${label(input, 'adminSetup.install.site.transfer', { megabytes: String(input.slice.siteTransferMegabytes) })}`
        : '';
}

/**
 * The card's one cost line (finding 10 of the M6 review: the frame's and the body's were two): the step's running cost,
 * the target's build minutes against Cloud Build's free minutes a month and, for the public map, the Hosting transfer
 * each publish moves (finding 4 of the M6 security review).
 */
export function costLine(input: InstallStatusInput): TemplateResult {
    const free = new Intl.NumberFormat(input.locale === 'ro' ? 'ro-RO' : 'en-GB').format(input.slice.freeMinutes);
    const minutes = String(input.slice.estimates[input.target]);
    const build = label(input, 'adminSetup.install.cost', { minutes, free });
    return html`<p class="note cost">${label(input, STEP_COST[input.target])} ${build}${transferText(input)}</p>`;
}

/** The status of the input's target: every part that applies to its state. */
export function installStatus(input: InstallStatusInput): TemplateResult {
    const view = targetOf(input);
    return html`<div class="install" data-target=${input.target} data-state=${view.state}>
        ${stateLine(input, view)} ${installedLine(input, view)} ${running(input, view)} ${stopped(input, view)} ${updateLine(input, view)}
        <div role="alert">${view.error === null ? nothing : html`<p class="alert">${text(input, view.error)}</p>`}</div>
    </div>`;
}
