/**
 * Step (c), Provision cloud (`docs/research/M2b-interfaces.md` §3.3 c, §3.4): one click and one `cloudPlatform`
 * consent run the provisioner, which reports every doctor item as it settles; Retry what failed (one click) runs only
 * the items that are not `ok`; Continue after an expired token does the same. The scheduler item stays `pending` until
 * the first deploy creates its job, and the doctor checks it once step (d) is done. In normal mode the card's Re-check
 * runs the read-only doctor, and every result is recorded at once with `setup.recordCloud`.
 */
import { isApiErrorCode, type ProvisionItem, type RecordCloudRequest } from '@hcm/shared';

import type { SetupContext } from './context.js';
import { googleAccess, liveAccess } from './google-access.js';
import { apiFailure, googleFailure } from './messages.js';
import type { GoogleAccess, ProvisionItemResult } from './ports.js';
import { itemMessage } from './records.js';
import { provisionHealth, type ProvisionItemState, type SetupState } from './state.js';

export interface ProvisionFlow {
    /** "Prepare the project", "Retry what failed" and Continue: one click, one consent. */
    run(): Promise<void>;
    /** Normal mode's Re-check: the read-only doctor (one click, one consent). */
    recheck(): Promise<void>;
    /** After the deployment, with the live token: the scheduler's job now exists. */
    checkScheduler(): Promise<void>;
}

/** The reason of an item Google refused with 401: the step's token expired. */
const EXPIRED = 'adminShell.session.googleExpired';

type Runner = (
    access: GoogleAccess,
    only: readonly ProvisionItem[] | null,
    onItem: (item: ProvisionItemResult) => void,
) => Promise<unknown>;

function withItem(state: SetupState, item: ProvisionItemResult): SetupState {
    const detail = itemMessage(item);
    const items = state.provision.items.map((current): ProvisionItemState =>
        current.id === item.id ? { id: item.id, state: item.state, detail } : current,
    );
    return { ...state, provision: { items } };
}

/** An item no run reported (`missing` with no reason): the record predates it, or the doctor found it absent. */
function unreported(item: ProvisionItemState): boolean {
    return item.state === 'missing' && item.detail === null;
}

/**
 * The items a rerun touches: those not `ok`; every item (null) when none is `ok` yet, or when one was never reported
 * (`unreported`). A record from before an item existed is stale as a whole: Provision's items of M6 also changed what an
 * `ok` of before meant (the installer's account in `service-accounts`, its roles and `roles/run.invoker` in `iam`), so
 * re-running only the new item would never create them (finding 2 of the M6 review). Every item is idempotent.
 */
function pendingItems(items: readonly ProvisionItemState[]): readonly ProvisionItem[] | null {
    const todo = items.filter((item) => item.state !== 'ok');
    const stale = todo.length === items.length || todo.some(unreported);
    return stale ? null : todo.map((item) => item.id);
}

type RecordedItem = NonNullable<RecordCloudRequest['provision']>['items'][number];

/** An item as `setup.recordCloud` accepts it: its reason only when that is an API error code. */
function recordedItem(item: ProvisionItemState): RecordedItem {
    const detail = item.detail;
    if (detail === null || !isApiErrorCode(detail.key)) {
        return { id: item.id, state: item.state };
    }
    return detail.params === undefined
        ? { id: item.id, state: item.state, detail: detail.key }
        : { id: item.id, state: item.state, detail: detail.key, params: detail.params };
}

/** `setup.recordCloud`'s request: the items the provisioner reported (null before any). */
function provisionRequest(items: readonly ProvisionItemState[]): RecordCloudRequest | null {
    const reported = items.filter((item) => item.state !== 'missing');
    return reported.length === 0 ? null : { provision: { items: reported.map(recordedItem) } };
}

class Provision implements ProvisionFlow {
    constructor(private readonly ctx: SetupContext) {}

    async run(): Promise<void> {
        await this.start((access, only, onItem) => this.ctx.deps.cloud.provision(access, only, onItem), true);
    }

    async recheck(): Promise<void> {
        await this.start((access, _only, onItem) => this.ctx.deps.cloud.doctor(access, null, onItem), false);
    }

    async checkScheduler(): Promise<void> {
        const access = liveAccess(this.ctx, 'cloudReadOnly');
        if (access === null) {
            return;
        }
        try {
            await this.ctx.deps.cloud.doctor(access, ['scheduler'], (item) => {
                this.onItem(item);
            });
            this.settle();
        } catch (error) {
            this.ctx.deps.log.warn('scheduler not checked', { reason: googleFailure(error).message.key });
        }
    }

    private async start(runner: Runner, onlyPending: boolean): Promise<void> {
        this.ctx.count('provision', 'inputs');
        this.ctx.patchStep('provision', { busy: true, error: null });
        const access = await googleAccess(this.ctx, 'provision', 'cloudPlatform', true);
        if (access === null) {
            return;
        }
        const only = onlyPending ? pendingItems(this.ctx.state().provision.items) : null;
        try {
            await runner(access, only, (item) => {
                this.onItem(item);
            });
            // The card stays busy until the run is recorded: a Retry what failed clicked while the record is on its way
            // could be overwritten by it, the server applying the older run last (S-A04-BAD-API-STILL-DISABLED).
            this.settle(true);
            const expired = this.stoppedExpired();
            await this.record();
            this.ctx.patchStep('provision', { busy: false });
            if (expired) {
                this.ctx.fail('provision', googleFailure({ kind: 'unauthorized' }));
            }
        } catch (error) {
            this.settle();
            this.ctx.fail('provision', googleFailure(error));
        }
    }

    /**
     * Whether the provisioner stopped at an item Google answered 401 (the token expired mid-run, S-A04-BAD-TOKEN-
     * EXPIRED-MID-RUN): then the token is dropped and the card offers Continue, which asks Google again and runs what
     * is not done. Read before the run is recorded (the record keeps API error codes only).
     */
    private stoppedExpired(): boolean {
        return this.ctx.state().provision.items.some((item) => item.detail?.key === EXPIRED);
    }

    private onItem(item: ProvisionItemResult): void {
        this.ctx.update((state) => withItem(state, item));
    }

    /** The step's state from its items; `busy` while what follows the run (its record) is still on its way. */
    private settle(busy = false): void {
        const state = provisionHealth(this.ctx.state().provision.items);
        this.ctx.patchStep('provision', { state, busy, checkedAt: this.ctx.nowIso() });
    }

    private async record(): Promise<void> {
        const request = provisionRequest(this.ctx.state().provision.items);
        if (this.ctx.state().mode !== 'normal' || request === null) {
            return;
        }
        try {
            const { status } = await this.ctx.deps.backend.recordCloud(request);
            this.ctx.applyStatus(status);
        } catch (error) {
            this.ctx.fail('provision', apiFailure(error));
        }
    }
}

export function createProvisionFlow(ctx: SetupContext): ProvisionFlow {
    return new Provision(ctx);
}
