/**
 * The Setup Assistant's install cards (`docs/research/M6-interfaces.md` §1.7, §1.8, §4.1): Install the server (d), the
 * imagery pipeline (d3, started by the same click) and Publish the map (i), each over one install flow
 * (`../install/install-flow.ts`). Each flow's view lands in the state's `install` slice; the pipeline's and the site's
 * steps take their chip from it (the server's step is the deployment's, `deploy.ts`, which also claims). Update the map
 * submits every target that is behind with one click (one consent without a live token): the server and the pipeline
 * at once, the site once the server is installed.
 */
import { INSTALL_TARGETS, type InstallState, type InstallTarget } from '@hcm/shared';

import { createInstallFlow, type InstallFlow } from '../install/install-flow.js';
import { isRunning, type InstallTargetView } from '../install/model.js';
import type { InstallAccess } from '../install/ports.js';
import type { SetupContext } from './context.js';
import { googleAccess, liveAccess } from './google-access.js';
import { installRecordOf } from './install-records.js';
import { INSTALL_CHIP, INSTALL_STEP_OF } from './install-steps.js';
import type { SetupStepId } from './steps.js';

export interface InstallCards {
    /** Follows `targets` with the live token (no click). */
    watch(targets: readonly InstallTarget[]): void;
    /** Install the server (d): one click; the same click starts the imagery pipeline (d3). */
    installServer(): Promise<void>;
    /** Publish the map, or Try again on a card: one click. */
    install(target: InstallTarget): Promise<void>;
    /** Update the map: one click (and one consent without a live token), counted on `step`'s card. */
    updateMap(step: SetupStepId): Promise<void>;
    /** Check again on an install card: one look (the consent popup without a live token). */
    recheck(target: InstallTarget): Promise<void>;
    dispose(): void;
}

function accessOf(access: { readonly token: string } | null): InstallAccess | null {
    return access === null ? null : { token: access.token };
}

/** The states Update the map installs from: behind the admin, or stopped (its Try again, finding 1 of the M6 review). */
const UPDATE_STATES: ReadonlySet<InstallState> = new Set<InstallState>(['updateAvailable', 'failed']);

/**
 * Whether Update the map installs `view`'s target: behind or stopped, and the imagery pipeline also when a look found it
 * not installed with nothing in its way (an owner whose server came from GitHub Actions, or whose pipeline was blocked
 * at the first click: finding 3 of the M6 review). The public map's first publish stays its own click (step i).
 */
function updates(view: InstallTargetView): boolean {
    const missingPipeline = view.target === 'pipeline' && view.state === 'notInstalled' && view.checkedAt !== null && view.blocker === null;
    return UPDATE_STATES.has(view.state) || missingPipeline;
}

/**
 * The states never recorded: a passing Google outage says nothing of what is installed, and recording it would make
 * Setup look not done until the next look with a token (finding 5 of the M6 review).
 */
const UNRECORDED: ReadonlySet<InstallState> = new Set<InstallState>(['unavailable']);

class Cards implements InstallCards {
    readonly #ctx: SetupContext;
    readonly #flows: Readonly<Record<InstallTarget, InstallFlow>>;
    /** Update the map waits for the server before it republishes the site. */
    #siteAfterServer = false;
    /** The state last recorded of each target (`setup.recordCloud`, an admin session only). */
    readonly #recorded = new Map<InstallTarget, string>();
    /** The records under way, one after another: concurrent ones contend for `setup/status` and may land out of order. */
    #recording: Promise<void> = Promise.resolve();

    constructor(ctx: SetupContext) {
        this.#ctx = ctx;
        this.#flows = {
            server: this.#flow('server'),
            pipeline: this.#flow('pipeline'),
            site: this.#flow('site'),
        };
    }

    watch(targets: readonly InstallTarget[]): void {
        targets.forEach((target) => {
            this.#flows[target].watch();
        });
    }

    async installServer(): Promise<void> {
        this.#ctx.count('deploy', 'inputs');
        await this.#flows.server.install();
        const access = this.#live();
        if (access !== null && this.#flows.pipeline.view().blocker === null) {
            await this.#flows.pipeline.installWith(access);
        }
    }

    async install(target: InstallTarget): Promise<void> {
        this.#ctx.count(INSTALL_STEP_OF[target], 'inputs');
        await this.#flows[target].install();
    }

    async updateMap(step: SetupStepId): Promise<void> {
        this.#ctx.count(step, 'inputs');
        // What the cards show: a target recorded behind (`setup/status.install`) counts before its flow has looked.
        const behind = INSTALL_TARGETS.filter((target) => updates(this.#ctx.state().install[target]));
        if (behind.length === 0) {
            return;
        }
        const granted = accessOf(await googleAccess(this.#ctx, step, 'cloudPlatform', true));
        if (granted === null) {
            return;
        }
        this.#siteAfterServer = behind.includes('site') && behind.includes('server');
        const now = behind.filter((target) => target !== 'site' || !this.#siteAfterServer);
        await Promise.all(now.map((target) => this.#flows[target].installWith(granted)));
    }

    async recheck(target: InstallTarget): Promise<void> {
        this.#ctx.count(INSTALL_STEP_OF[target], 'inputs');
        const access = accessOf(await googleAccess(this.#ctx, INSTALL_STEP_OF[target], 'cloudPlatform', true));
        if (access !== null) {
            await this.#flows[target].refresh();
            this.#flows[target].watch();
        }
    }

    dispose(): void {
        INSTALL_TARGETS.forEach((target) => {
            this.#flows[target].dispose();
        });
    }

    #live(): InstallAccess | null {
        return accessOf(liveAccess(this.#ctx, 'cloudPlatform'));
    }

    #flow(target: InstallTarget): InstallFlow {
        const step = INSTALL_STEP_OF[target];
        const { deps } = this.#ctx;
        return createInstallFlow({
            target,
            installer: deps.installer,
            clock: deps.clock,
            visibility: deps.visibility,
            log: deps.log.child(`install-${target}`),
            release: deps.host.release,
            liveAccess: () => this.#live(),
            clickAccess: async () => accessOf(await googleAccess(this.#ctx, step, 'cloudPlatform', true)),
            report: (view) => {
                this.#report(view);
            },
            expired: () => {
                this.#ctx.deps.google.drop();
                this.#ctx.patchStep(step, { needsContinue: true });
            },
        });
    }

    #report(view: InstallTargetView): void {
        this.#ctx.update((state) => ({ ...state, install: { ...state.install, [view.target]: view } }));
        this.#record(view);
        const step = INSTALL_STEP_OF[view.target];
        if (view.target === 'server') {
            this.#ctx.patchStep(step, { busy: view.busy });
            this.#afterServer(view);
            return;
        }
        this.#ctx.patchStep(step, { state: INSTALL_CHIP[view.state], busy: view.busy, checkedAt: view.checkedAt });
    }

    /**
     * In an admin session, a target whose state changed is recorded in `setup/status` (Home reads it without a token); in
     * start-up mode the bootstrap record keeps it (`install-records.ts`).
     */
    #record(view: InstallTargetView): void {
        if (!this.#records(view)) {
            return;
        }
        this.#recorded.set(view.target, view.state);
        const install = { [view.target]: installRecordOf(view, this.#ctx.nowIso()) };
        this.#recording = this.#recording
            .then(async () => {
                await this.#ctx.deps.backend.recordCloud({ install });
            })
            .catch((error: unknown) => {
                this.#ctx.deps.log.warn('install state not recorded', { target: view.target, error: String(error) });
            });
    }

    /** An admin session records an observed target whose state changed, but never a passing outage. */
    #records(view: InstallTargetView): boolean {
        const changed = view.checkedAt !== null && this.#recorded.get(view.target) !== view.state;
        return this.#ctx.state().mode === 'normal' && changed && !UNRECORDED.has(view.state);
    }

    /** Update the map waits for the server, whose build has settled. */
    #siteDue(view: InstallTargetView): boolean {
        return this.#siteAfterServer && !isRunning(view.state) && !view.busy;
    }

    /** Update the map's site, once the server it waited for is installed (with the live token; else the card offers it). */
    #afterServer(view: InstallTargetView): void {
        if (!this.#siteDue(view)) {
            return;
        }
        this.#siteAfterServer = false;
        const access = view.state === 'installed' ? this.#live() : null;
        if (access !== null) {
            void this.#flows.site.installWith(access);
        }
    }
}

/** The install cards over the Setup Assistant's context. */
export function createInstallCards(ctx: SetupContext): InstallCards {
    return new Cards(ctx);
}
