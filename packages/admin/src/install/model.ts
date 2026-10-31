/**
 * What an install card shows of its target (`docs/research/M6-interfaces.md` §1.7), derived from what Google says:
 * the installed release (the functions' `HCM_RELEASE`, the jobs' `hcm-release` label, the site's `/release.json`) and
 * the target's newest build (its status, its steps, the last `HCM_INSTALL` events of its log). Pure functions over
 * plain data: the flows (`install-flow.ts`) observe, these decide.
 */
import {
    CLOUD_BUILD_FREE_MINUTES,
    compareRelease,
    INSTALL_ESTIMATES,
    INSTALL_RUNNING_STATES,
    INSTALL_STEPS,
    SITE_PUBLISH_TRANSFER_MB,
    type InstallLogEvent,
    type InstallState,
    type InstallStepId,
    type InstallTarget,
    type TransientDeployReason,
} from '@hcm/shared';

import type { CloudBuild, CloudBuildStatus } from '../google/cloud-build.js';
import type { SetupMessage } from '../setup/messages.js';

/** What the card says of one build step. */
type StepProgressState = 'done' | 'now' | 'waiting' | 'failed';

export interface StepProgress {
    readonly id: InstallStepId;
    readonly state: StepProgressState;
}

/** A message the card shows (a key of the Setup Assistant's or the API's catalogue, with its values). */
export type InstallMessage = SetupMessage;

/** What is installed of a target now. */
export interface InstalledInfo {
    /** The target is in place (every function `ACTIVE`, both jobs, a public site). */
    readonly complete: boolean;
    /** Its release; null when it names none (a deploy from before M6) or nothing is installed. */
    readonly release: string | null;
    /**
     * Part of it is in place but not all (some functions, one job): a server from before M6 that lacks the new functions,
     * or an install that stopped half way. It is offered as an update, never as a first install (finding 1 of the M6
     * review). Absent: false.
     */
    readonly partial?: boolean;
    /**
     * The newest release any installed part names, complete or not (absent: `release`). An admin older than it never
     * submits: the deploy's `--force` would delete the newer release's functions (finding 2 of the M6 security review).
     */
    readonly newest?: string | null;
}

/** One target as the card shows it. */
export interface InstallTargetView {
    readonly target: InstallTarget;
    readonly state: InstallState;
    readonly installedRelease: string | null;
    /** The build the card follows or last saw (null: none yet), and its page in the Google Cloud console. */
    readonly buildId: string | null;
    readonly consoleUrl: string | null;
    /** When that build was created, and when it finished (ISO 8601). */
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly steps: readonly StepProgress[];
    /** The step a failed build stopped at. */
    readonly failedStep: InstallStepId | null;
    /** A failed build's step's last lines (redacted, as text). */
    readonly log: readonly string[];
    /** `verify`'s missing or failed functions. */
    readonly missing: readonly string[];
    /** `retrying`: why, and when the build tries again (ISO 8601). */
    readonly retryReason: TransientDeployReason | null;
    readonly retryAt: string | null;
    /** Why the card's button is off (not provisioned, no repository, nothing to show), or null. */
    readonly blocker: InstallMessage | null;
    /** A click is being handled (the submit, or the consent before it). */
    readonly busy: boolean;
    /** The last action's or check's failure, shown until the next one. */
    readonly error: InstallMessage | null;
    /** ISO 8601 of the last observation. */
    readonly checkedAt: string | null;
}

/** A target nothing is known of yet. */
export function initialTargetView(target: InstallTarget): InstallTargetView {
    return {
        target,
        state: 'notInstalled',
        installedRelease: null,
        buildId: null,
        consoleUrl: null,
        startedAt: null,
        finishedAt: null,
        steps: INSTALL_STEPS[target].map((id) => ({ id, state: 'waiting' })),
        failedStep: null,
        log: [],
        missing: [],
        retryReason: null,
        retryAt: null,
        blocker: null,
        busy: false,
        error: null,
        checkedAt: null,
    };
}

const QUEUED: ReadonlySet<CloudBuildStatus> = new Set(['STATUS_UNKNOWN', 'PENDING', 'QUEUED']);
const FAILED: ReadonlySet<CloudBuildStatus> = new Set(['FAILURE', 'TIMEOUT', 'CANCELLED', 'INTERNAL_ERROR', 'EXPIRED']);
/** Google's side ended the build, not the build itself: the flow submits it again once, without a click (§1.5). */
const GOOGLE_ENDED: ReadonlySet<CloudBuildStatus> = new Set(['INTERNAL_ERROR', 'EXPIRED']);

const RELEASE_TAG_PREFIX = 'hcm-r-';

/** The build's release slug, from the tag `hcm-r-<slug>` it carries. */
export function buildSlug(build: CloudBuild): string | null {
    const tag = build.tags.find((candidate) => candidate.startsWith(RELEASE_TAG_PREFIX));
    return tag === undefined ? null : tag.slice(RELEASE_TAG_PREFIX.length);
}

/** Some installed part names a release newer than the admin's, whether or not the target is complete. */
function newerThanBundle(installed: InstalledInfo, bundleRelease: string): boolean {
    const newest = installed.newest ?? installed.release;
    return newest !== null && compareRelease(newest, bundleRelease) > 0;
}

/** The order of an installed release against the admin's: newer (whatever is missing), partial, installed or update. */
function installedState(installed: InstalledInfo, bundleRelease: string): InstallState {
    if (newerThanBundle(installed, bundleRelease)) {
        return 'newerInstalled';
    }
    if (!installed.complete) {
        return installed.partial === true ? 'updateAvailable' : 'notInstalled';
    }
    return completeState(installed, bundleRelease);
}

/** A complete target's release against the admin's (one naming none is from before M6: an update replaces it). */
function completeState(installed: InstalledInfo, bundleRelease: string): InstallState {
    const order = installed.release === null ? -1 : compareRelease(installed.release, bundleRelease);
    if (order === 0) {
        return 'installed';
    }
    return order < 0 ? 'updateAvailable' : 'newerInstalled';
}

export interface StateInput {
    readonly installed: InstalledInfo;
    /** The target's newest build, or null. */
    readonly build: CloudBuild | null;
    /** The admin's own release (its bundle's), and its slug. */
    readonly bundleRelease: string;
    readonly bundleSlug: string;
    /** The build's last `HCM_INSTALL` event is a retry it still waits on. */
    readonly retrying: boolean;
    /** `verify` printed missing or failed functions. */
    readonly missing: readonly string[];
}

/** A build that is queued or working. */
function isActive(build: CloudBuild | null): build is CloudBuild {
    return build !== null && (QUEUED.has(build.status) || build.status === 'WORKING');
}

/** The newest build is the admin's own and failed, or it succeeded while `verify` named missing functions. */
function failedOwnBuild(input: StateInput): boolean {
    const { build } = input;
    if (build === null) {
        return false;
    }
    const ownFailed = FAILED.has(build.status) && buildSlug(build) === input.bundleSlug;
    return ownFailed || (build.status === 'SUCCESS' && input.missing.length > 0);
}

/** States that mean the admin's release (or a newer one) is in place: a failed build before them no longer matters. */
const IN_PLACE: ReadonlySet<InstallState> = new Set<InstallState>(['installed', 'newerInstalled']);

/**
 * The target's state (§1.7): a build that runs decides first; then a failed build of the admin's own release that left
 * the target short of that release; then what is installed against the admin's release.
 */
export function deriveInstallState(input: StateInput): InstallState {
    if (isActive(input.build)) {
        return runningState(input.build, input.retrying);
    }
    const settled = installedState(input.installed, input.bundleRelease);
    return failedOwnBuild(input) && !IN_PLACE.has(settled) ? 'failed' : settled;
}

/** A build that runs: queued, at work, or waiting on a retry it printed. */
function runningState(build: CloudBuild, retrying: boolean): InstallState {
    if (QUEUED.has(build.status)) {
        return 'queued';
    }
    return retrying ? 'retrying' : 'working';
}

/** True while a build of the target is queued or working (a click follows it instead of submitting another). */
export function isRunning(state: InstallState): boolean {
    return INSTALL_RUNNING_STATES.has(state);
}

function stepState(status: CloudBuildStatus | undefined, current: boolean): StepProgressState {
    if (status === 'SUCCESS') {
        return 'done';
    }
    if (status !== undefined && FAILED.has(status)) {
        return 'failed';
    }
    return current ? 'now' : 'waiting';
}

/** The step under way: the first one not done, while the build works. */
function currentStep(target: InstallTarget, build: CloudBuild | null, statuses: ReadonlyMap<string, CloudBuildStatus>): string | undefined {
    if (build?.status !== 'WORKING') {
        return undefined;
    }
    return INSTALL_STEPS[target].find((id) => statuses.get(id) !== 'SUCCESS');
}

/** Each step of the target's definition with its progress in `build` (the first one not done is `now` while it runs). */
export function stepsOf(target: InstallTarget, build: CloudBuild | null): readonly StepProgress[] {
    const statuses = new Map((build === null ? [] : build.steps).map((step) => [step.id, step.status]));
    const current = currentStep(target, build, statuses);
    return INSTALL_STEPS[target].map((id) => ({ id, state: stepState(statuses.get(id), id === current) }));
}

/** The step a failed build stopped at: the first failed one, else the first not done. */
export function failedStepOf(target: InstallTarget, build: CloudBuild): InstallStepId | null {
    const steps = stepsOf(target, build);
    return (steps.find((step) => step.state === 'failed') ?? steps.find((step) => step.state !== 'done'))?.id ?? null;
}

/** The last retry the log names, if it is the build's last event (a later event means the build moved on). */
export function pendingRetry(events: readonly InstallLogEvent[]): Extract<InstallLogEvent, { event: 'retry' }> | null {
    const last = events.at(-1);
    return last?.event === 'retry' ? last : null;
}

/** The functions `verify` named, in the order it named them, once each. */
export function missingFunctions(events: readonly InstallLogEvent[]): readonly string[] {
    return [...new Set(events.flatMap((event) => (event.event === 'missing' || event.event === 'failed' ? [event.name] : [])))];
}

/** Whether a build ended on Google's side (resubmitted once, §1.5). */
export function endedByGoogle(build: CloudBuild | null): boolean {
    return build !== null && GOOGLE_ENDED.has(build.status);
}

/** Whether a build has ended, one way or another. */
export function hasEnded(build: CloudBuild | null): boolean {
    return build !== null && (build.status === 'SUCCESS' || FAILED.has(build.status));
}

/** The Setup Assistant's install slice: the admin's release, where the map is published, the costs, each target. */
export interface InstallSlice {
    /** The admin's own release (what Install and Update install). */
    readonly release: string;
    /** `https://<project>.web.app/`: where Publish the map puts the public map. */
    readonly address: string;
    /** Cloud Build's free minutes a month, and each target's estimate (§1.9). */
    readonly freeMinutes: number;
    readonly estimates: Readonly<Record<InstallTarget, number>>;
    /** What one Publish the map moves out of Hosting's free daily transfer, in MB (§1.9). */
    readonly siteTransferMegabytes: number;
    readonly server: InstallTargetView;
    readonly pipeline: InstallTargetView;
    readonly site: InstallTargetView;
}

/** Nothing observed yet. */
export function initialInstallSlice(release: string, address: string): InstallSlice {
    return {
        release,
        address,
        freeMinutes: CLOUD_BUILD_FREE_MINUTES,
        estimates: {
            server: INSTALL_ESTIMATES.server.buildMinutes,
            pipeline: INSTALL_ESTIMATES.pipeline.buildMinutes,
            site: INSTALL_ESTIMATES.site.buildMinutes,
        },
        siteTransferMegabytes: SITE_PUBLISH_TRANSFER_MB,
        server: initialTargetView('server'),
        pipeline: initialTargetView('pipeline'),
        site: initialTargetView('site'),
    };
}
