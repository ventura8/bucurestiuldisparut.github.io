/**
 * The order card's actions (`docs/research/M4-interfaces.md` §1.4, §1.7): **I ordered it** (`usgs.markOrdered`, after the
 * admin's own purchase in EarthExplorer; its snackbar offers Undo), **Check now** (`usgs.checkOrder`) and **Take the mark
 * back** (`usgs.cancelOrder`). One action runs at a time; a refusal stays on the scene's card until the next action. A
 * frame USGS scanned meanwhile (`apiError.usgs.alreadyAvailable`) turns free and its card goes with it: that refusal is
 * also the snackbar's, so the admin reads why on the scene's page (the 2026-10-24 review). Everything after the mark is
 * the server's: the scene's live document shows each step.
 */
import type { CallableResponse } from '@hcm/shared';

import type { ContentServices } from '../../content/services.js';
import type { NoticeInput } from '../../state/state.js';
import { refusalOf } from '../api.js';

export type OrderAction = 'mark' | 'check' | 'cancel';

export interface OrderActionsState {
    /** The action running, for which scene. */
    readonly ordering: { readonly id: string; readonly action: OrderAction } | null;
    /** The last refusal, on its scene's card. */
    readonly orderRefusal: { readonly id: string; readonly notice: NoticeInput } | null;
}

export const IDLE_ORDERS: OrderActionsState = { ordering: null, orderRefusal: null };

type OrderCall = 'usgs.markOrdered' | 'usgs.checkOrder' | 'usgs.cancelOrder';

const CALLS: Readonly<Record<OrderAction, OrderCall>> = {
    mark: 'usgs.markOrdered',
    check: 'usgs.checkOrder',
    cancel: 'usgs.cancelOrder',
};

/** What "Check now" found, in words. */
function checkedNotice(answer: CallableResponse<'usgs.checkOrder'>): NoticeInput {
    if (!answer.available) {
        return { key: 'adminContent.orders.notice.waiting' };
    }
    return { key: answer.jobId === undefined ? 'adminContent.orders.notice.deliveredWaits' : 'adminContent.orders.notice.delivered' };
}

export class OrderActions {
    readonly #services: ContentServices;
    readonly #changed: (state: OrderActionsState) => void;
    #state: OrderActionsState = IDLE_ORDERS;

    constructor(services: ContentServices, changed: (state: OrderActionsState) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    /** "I ordered it": the order recorded; the snackbar's Undo takes the mark back. A frame scanned meanwhile: the snackbar says so. */
    async markOrdered(id: string): Promise<boolean> {
        const answer = await this.#run(id, 'mark');
        if (answer !== null) {
            this.#services.notify({
                key: 'adminContent.orders.notice.marked',
                action: { key: 'adminContent.orders.undo', run: () => void this.cancelOrder(id) },
            });
        } else if (this.#state.orderRefusal?.notice.key === 'apiError.usgs.alreadyAvailable') {
            this.#services.notify(this.#state.orderRefusal.notice);
        }
        return answer !== null;
    }

    /** "Check now": USGS asked at once; the answer in words. */
    async checkOrder(id: string): Promise<boolean> {
        const answer = (await this.#run(id, 'check')) as CallableResponse<'usgs.checkOrder'> | null;
        if (answer !== null) {
            this.#services.notify(checkedNotice(answer));
        }
        return answer !== null;
    }

    /** "Take the mark back" (or the snackbar's Undo). */
    async cancelOrder(id: string): Promise<boolean> {
        const answer = await this.#run(id, 'cancel');
        if (answer !== null) {
            this.#services.notify({ key: 'adminContent.orders.notice.takenBack' });
        }
        return answer !== null;
    }

    /** Runs one action (none while another runs): its answer, or null when it was refused or not run. */
    async #run(id: string, action: OrderAction): Promise<CallableResponse<OrderCall> | null> {
        if (this.#state.ordering !== null) {
            return null;
        }
        this.#set({ ordering: { id, action }, orderRefusal: null });
        try {
            const answer = await this.#services.callables.call(CALLS[action], { cityId: this.#services.cityId, entityId: id });
            this.#set({ ordering: null, orderRefusal: null });
            return answer;
        } catch (error) {
            this.#set({ ordering: null, orderRefusal: { id, notice: refusalOf(error) } });
            return null;
        }
    }

    #set(state: OrderActionsState): void {
        this.#state = state;
        this.#changed(state);
    }
}
