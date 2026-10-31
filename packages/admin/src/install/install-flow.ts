/**
 * One install target as its card follows it (`docs/research/M6-interfaces.md` §1.5, §1.7): with the owner's live
 * token it looks every 10 s while a build runs and every 60 s otherwise (the tab visible; the injected clock), reads
 * the build's log only when it matters (a server build at work, for the retry lines; a build that stopped, for its
 * step's last lines and `verify`'s missing functions), and derives the card's state. A click installs, updates or
 * tries again: one click, the consent popup only when the token is gone; a build already queued or working is
 * followed, never doubled, and a target newer than the admin is never replaced. A build Google itself ended
 * (`INTERNAL_ERROR`, `EXPIRED`) is submitted again once, without a click.
 */
import {
    installReleaseSlug,
    parseInstallLogLine,
    type InstallLogEvent,
    type InstallState,
    type InstallStepId,
    type InstallTarget,
    type Logger,
} from '@hcm/shared';

import type { CloudBuild } from '../google/cloud-build.js';
import { stepTail, type BuildLogLine } from '../google/logging.js';
import { googleFailure } from '../setup/messages.js';
import { createPoller, type PollOutcome, type Poller } from '../setup/poll.js';
import type { SetupClock, VisibilityPort } from '../setup/ports.js';
import { InstallBundleError } from './bundle.js';
import {
    deriveInstallState,
    endedByGoogle,
    failedStepOf,
    hasEnded,
    initialTargetView,
    isRunning,
    missingFunctions,
    pendingRetry,
    stepsOf,
    type InstallTargetView,
} from './model.js';
import type { InstallAccess, InstallerPort, ServerProgress, TargetObservation } from './ports.js';

/** How often the card looks while a build runs, and otherwise (§1.7). */
export const RUNNING_LOOK_MS = 10_000;
export const IDLE_LOOK_MS = 60_000;
/** The one blocker a card re-checks without a Google token (`InstallerPort.localBlocker`). */
const LOCAL_BLOCKER = 'apiError.install.nothingToShow';
/** How long a card follows its target after the last start (a build may queue for an hour and run for another). */
const WATCH_FOR_MS = 3 * 60 * 60_000;

/** The states a click may install from (anything else is in place, running, or newer than the admin). */
const SUBMITTABLE: ReadonlySet<InstallState> = new Set<InstallState>(['notInstalled', 'updateAvailable', 'failed', 'unavailable']);

export interface InstallFlowDeps {
    readonly target: InstallTarget;
    readonly installer: InstallerPort;
    readonly clock: SetupClock;
    readonly visibility: VisibilityPort;
    readonly log: Logger;
    /** The admin's own release. */
    readonly release: string;
    /** The live `cloudPlatform` token with enough life left, or null (no popup). */
    readonly liveAccess: () => InstallAccess | null;
    /** From a click: the live token, else Google's consent, opened in the call's synchronous part; null without one. */
    readonly clickAccess: () => Promise<InstallAccess | null>;
    /** Every new view, with the server's functions (the server only). */
    readonly report: (view: InstallTargetView, progress: ServerProgress | null) => void;
    /** Google refused the token (401): the card offers Continue. */
    readonly expired: () => void;
}

export interface InstallFlow {
    /** Follows the target with the live token (no click); a running watch goes on. */
    watch(): void;
    /** One look now with the live token (Check again); none without one. */
    refresh(): Promise<void>;
    /** Install, Update or Try again: one click (and the consent when the token is gone). */
    install(): Promise<void>;
    /** As `install`, with a token the caller already holds (Update the map asks once for every target). */
    installWith(access: InstallAccess): Promise<void>;
    view(): InstallTargetView;
    dispose(): void;
}

/** What the log of the build the card shows says. */
interface LogSummary {
    readonly retry: Extract<InstallLogEvent, { event: 'retry' }> | null;
    /** When the retry line was written (ISO 8601), or ''. */
    readonly retryLineAt: string;
    readonly missing: readonly string[];
    readonly failedStep: InstallStepId | null;
    readonly tail: readonly string[];
}

const NO_LOG: LogSummary = { retry: null, retryLineAt: '', missing: [], failedStep: null, tail: [] };

function eventsOf(lines: readonly BuildLogLine[]): { readonly events: InstallLogEvent[]; readonly lastAt: string } {
    const events: InstallLogEvent[] = [];
    let lastAt = '';
    for (const line of lines) {
        const event = parseInstallLogLine(line.text);
        if (event !== null) {
            events.push(event);
            lastAt = line.time;
        }
    }
    return { events, lastAt };
}

/** A build that ended without success (its log names why). */
function stoppedBuild(build: CloudBuild): boolean {
    return hasEnded(build) && build.status !== 'SUCCESS';
}

/**
 * The release the card names: the installed one, or, for a target newer than the admin, the newest any part names (a
 * newer server missing a function has no complete release, yet the card says which release it is: finding 2 of the M6
 * security review).
 */
function shownRelease(observation: TargetObservation, state: InstallState): string | null {
    const { installed } = observation;
    return state === 'newerInstalled' ? (installed.newest ?? installed.release) : installed.release;
}

/** A failed build's step and its last lines; nothing for any other state. */
function failureFields(summary: LogSummary, state: InstallState): Pick<InstallTargetView, 'failedStep' | 'log'> {
    return state === 'failed' ? { failedStep: summary.failedStep, log: summary.tail } : { failedStep: null, log: [] };
}

/** When a retry that `waitSeconds` after `writtenAt` tries again, or null without a time. */
function retryTime(writtenAt: string, waitSeconds: number): string | null {
    const written = Date.parse(writtenAt);
    return Number.isNaN(written) ? null : new Date(written + waitSeconds * 1000).toISOString();
}

/** A retrying build's reason and when it tries again; nothing for any other state. */
function retryFields(summary: LogSummary, state: InstallState): Pick<InstallTargetView, 'retryReason' | 'retryAt'> {
    const retry = state === 'retrying' ? summary.retry : null;
    if (retry === null) {
        return { retryReason: null, retryAt: null };
    }
    return { retryReason: retry.reason, retryAt: retryTime(summary.retryLineAt, retry.waitSeconds) };
}

class TargetFlow implements InstallFlow {
    readonly #deps: InstallFlowDeps;
    readonly #slug: string;
    readonly #poller: Poller;
    #view: InstallTargetView;
    #lastLook = Number.NEGATIVE_INFINITY;
    /** The summaries of builds that ended (their log does not change). */
    readonly #ended = new Map<string, LogSummary>();
    /** Builds Google ended that were submitted again: once since the last click (a second such ending stays failed). */
    readonly #resubmitted = new Set<string>();
    #resubmitAllowed = true;

    constructor(deps: InstallFlowDeps) {
        this.#deps = deps;
        this.#slug = installReleaseSlug(deps.release);
        this.#view = initialTargetView(deps.target);
        this.#poller = createPoller(
            deps,
            { intervalMs: RUNNING_LOOK_MS, stopAfterMs: WATCH_FOR_MS },
            () => this.#tick(),
            () => undefined,
        );
    }

    watch(): void {
        if (!this.#poller.isRunning()) {
            this.#poller.start(true);
        }
    }

    async refresh(): Promise<void> {
        const access = this.#deps.liveAccess();
        if (access !== null) {
            await this.#guarded(() => this.#look(access));
        }
    }

    async install(): Promise<void> {
        const pending = this.#deps.clickAccess();
        this.#set({ busy: true, error: null });
        const access = await pending;
        if (access === null) {
            this.#set({ busy: false });
            return;
        }
        await this.installWith(access);
    }

    async installWith(access: InstallAccess): Promise<void> {
        this.#set({ busy: true, error: null });
        this.#resubmitAllowed = true;
        await this.#guarded(async () => {
            await this.#look(access);
            if (SUBMITTABLE.has(this.#view.state) && this.#view.blocker === null) {
                this.#applyBuild(await this.#deps.installer.submit(this.#deps.target, access));
            }
        });
        this.#set({ busy: false });
        // A click restarts the watch: its next look comes one running interval later, whatever wait a failed look before
        // the click (an API not on yet, a missing account) had set.
        this.#poller.start(false);
    }

    view(): InstallTargetView {
        return this.#view;
    }

    dispose(): void {
        this.#poller.stop();
    }

    async #tick(): Promise<PollOutcome> {
        const access = this.#deps.liveAccess();
        if (access === null) {
            return this.#lookWithoutToken();
        }
        const wait = isRunning(this.#view.state) ? RUNNING_LOOK_MS : IDLE_LOOK_MS;
        if (this.#deps.clock.now() - this.#lastLook < wait) {
            return 'next';
        }
        return (await this.#guarded(() => this.#look(access))) ? 'next' : this.#afterFailure();
    }

    /**
     * With no Google token the card cannot look at Google, but a blocker of its own data can still lift (the first city
     * published while the token was gone, finding 13's journey): the watch goes on, once an idle interval, until it has.
     */
    async #lookWithoutToken(): Promise<PollOutcome> {
        if (this.#view.blocker?.key !== LOCAL_BLOCKER) {
            return 'stop';
        }
        if (this.#deps.clock.now() - this.#lastLook < IDLE_LOOK_MS) {
            return 'next';
        }
        this.#lastLook = this.#deps.clock.now();
        const blocker = await this.#deps.installer.localBlocker(this.#deps.target).catch(() => this.#view.blocker);
        this.#set({ blocker });
        return blocker === null ? 'stop' : 'next';
    }

    /** Runs `work`; a failure is shown on the card. True when it worked. */
    async #guarded(work: () => Promise<void>): Promise<boolean> {
        try {
            await work();
            return true;
        } catch (error) {
            this.#fail(error);
            return false;
        }
    }

    #afterFailure(): PollOutcome {
        return this.#view.error?.key === 'adminShell.session.googleExpired' ? 'stop' : 'backoff';
    }

    #fail(error: unknown): void {
        if (error instanceof InstallBundleError) {
            this.#set({ error: { key: error.code } });
            return;
        }
        const failure = googleFailure(error);
        this.#deps.log.warn('install check failed', { target: this.#deps.target, key: failure.message.key });
        if (failure.expired) {
            this.#deps.expired();
        }
        this.#set({ error: failure.message, ...(failure.state === 'unavailable' ? { state: 'unavailable' as const } : {}) });
    }

    async #look(access: InstallAccess): Promise<void> {
        const observation = await this.#deps.installer.observe(this.#deps.target, access);
        this.#lastLook = this.#deps.clock.now();
        const summary = await this.#summary(observation.build, access);
        const state = deriveInstallState({
            installed: observation.installed,
            build: observation.build,
            bundleRelease: this.#deps.release,
            bundleSlug: this.#slug,
            retrying: summary.retry !== null,
            missing: summary.missing,
        });
        this.#show(this.#viewOf(observation, summary, state), observation.progress);
        await this.#resubmitIfGoogleEnded(observation.build, state, access);
    }

    #viewOf(observation: TargetObservation, summary: LogSummary, state: InstallState): InstallTargetView {
        return {
            ...this.#view,
            state,
            installedRelease: shownRelease(observation, state),
            ...this.#buildFields(observation.build),
            ...failureFields(summary, state),
            missing: summary.missing,
            ...retryFields(summary, state),
            blocker: observation.blocker,
            error: null,
            checkedAt: new Date(this.#deps.clock.now()).toISOString(),
        };
    }

    #buildFields(build: CloudBuild | null): Pick<InstallTargetView, 'buildId' | 'consoleUrl' | 'startedAt' | 'finishedAt' | 'steps'> {
        const steps = stepsOf(this.#deps.target, build);
        if (build === null) {
            return { buildId: null, consoleUrl: null, startedAt: null, finishedAt: null, steps };
        }
        const times = { startedAt: build.createTime ?? null, finishedAt: build.finishTime ?? null };
        return { buildId: build.id, consoleUrl: this.#deps.installer.consoleUrl(build.id), ...times, steps };
    }

    /** The log's summary for `build`: read while a server build works (its retries) and once a build stopped. */
    async #summary(build: CloudBuild | null, access: InstallAccess): Promise<LogSummary> {
        if (build === null || !this.#readsLog(build)) {
            return NO_LOG;
        }
        return this.#ended.get(build.id) ?? (await this.#readSummary(build, access));
    }

    #readsLog(build: CloudBuild): boolean {
        return stoppedBuild(build) || (build.status === 'WORKING' && this.#deps.target === 'server');
    }

    async #readSummary(build: CloudBuild, access: InstallAccess): Promise<LogSummary> {
        const summary = this.#summarise(build, await this.#deps.installer.buildLog(build.id, access), stoppedBuild(build));
        if (hasEnded(build)) {
            this.#ended.set(build.id, summary);
        }
        return summary;
    }

    #summarise(build: CloudBuild, lines: readonly BuildLogLine[], stopped: boolean): LogSummary {
        const { events, lastAt } = eventsOf(lines);
        const failedStep = stopped ? failedStepOf(this.#deps.target, build) : null;
        return {
            retry: stopped ? null : pendingRetry(events),
            retryLineAt: lastAt,
            missing: missingFunctions(events),
            failedStep,
            tail: failedStep === null ? [] : stepTail(lines, failedStep),
        };
    }

    /** A failed build of the admin's own release that Google ended (its state says so) and that was not resubmitted yet. */
    #googleEnded(build: CloudBuild | null, state: InstallState): build is CloudBuild {
        return this.#resubmitAllowed && build !== null && state === 'failed' && endedByGoogle(build) && !this.#resubmitted.has(build.id);
    }

    async #resubmitIfGoogleEnded(build: CloudBuild | null, state: InstallState, access: InstallAccess): Promise<void> {
        if (!this.#googleEnded(build, state)) {
            return;
        }
        this.#resubmitted.add(build.id);
        this.#resubmitAllowed = false;
        this.#deps.log.warn('install build ended by Google: submitted again', { target: this.#deps.target, status: build.status });
        this.#applyBuild(await this.#deps.installer.submit(this.#deps.target, access));
    }

    /** A build just submitted: queued, its steps waiting. */
    #applyBuild(build: CloudBuild): void {
        this.#show(
            {
                ...this.#view,
                state: 'queued',
                ...this.#buildFields(build),
                failedStep: null,
                log: [],
                missing: [],
                retryReason: null,
                retryAt: null,
                error: null,
            },
            null,
        );
        this.#lastLook = this.#deps.clock.now();
    }

    #set(patch: Partial<InstallTargetView>): void {
        this.#show({ ...this.#view, ...patch }, null);
    }

    #show(view: InstallTargetView, progress: ServerProgress | null): void {
        this.#view = view;
        this.#deps.report(view, progress);
    }
}

/** The flow of one install target. */
export function createInstallFlow(deps: InstallFlowDeps): InstallFlow {
    return new TargetFlow(deps);
}
