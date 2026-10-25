/**
 * Orders in the Imagery area's lists (`docs/research/M4-interfaces.md` §1.7): a short chip of an order's state on the
 * scene's card, and Work's orders (every scan bought and not imported yet, live, the one that needs the admin first: an
 * order never delivered, which also counts in Work's "needs you" until it is ordered again or its mark taken back). A
 * reminder to pay is no longer the admin's to clear once it was sent: it waits like any order, and counts nowhere.
 */
import type { Locale, OrderState } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { current } from '../../editing/states.js';
import { EMPTY } from '../../shell/empty.js';
import { contentText } from '../../shell/text.js';
import type { ImageryContext } from '../context.js';
import type { ImageryViewState, SceneItemPort } from '../imagery-port.js';
import { dayText } from '../imagery-text.js';

/** The orders the admin has to act on (and can: Order it again, or Take the mark back). */
const NEEDS_YOU: readonly OrderState[] = ['expired'];

type ShownState = Exclude<OrderState, 'imported'>;

const TONES: Readonly<Record<ShownState, 'good' | 'wait' | 'error'>> = {
    ordered: 'wait',
    reminder: 'wait',
    delivered: 'good',
    importing: 'good',
    expired: 'error',
};

/** A scene's order not imported yet, by its state. */
function openState(scene: SceneItemPort): ShownState | null {
    const state = scene.order?.state ?? 'imported';
    return state === 'imported' ? null : state;
}

/** The short chip of a scene's open order (the scene's page says it in full); none without one. */
export function orderTag(locale: Locale, scene: SceneItemPort): TemplateResult {
    const state = openState(scene);
    if (state === null) {
        return EMPTY;
    }
    const label = contentText(locale, `adminContent.orders.tag.${state}`);
    return html`<span class="tag" data-tone=${TONES[state]}>${label}</span>`;
}

/** The orders not imported yet. */
function openOrders(view: ImageryViewState): SceneItemPort[] {
    return view.orders.items.filter((scene) => openState(scene) !== null);
}

/** An order never delivered. */
function needsYou(scene: SceneItemPort): boolean {
    return scene.order !== null && NEEDS_YOU.includes(scene.order.state);
}

/** How many orders need the admin (Work's count). */
export function ordersNeedingYou(view: ImageryViewState): number {
    return view.orders.items.filter(needsYou).length;
}

function orderRow(context: ImageryContext, scene: SceneItemPort): TemplateResult {
    const { locale, view } = context;
    const selected = view.detail?.kind === 'scene' && view.detail.id === scene.id;
    return html`<li data-order=${scene.id}>
        <a class="row" href=${context.href(['scene', scene.id])} aria-current=${current(selected)}>
            <span class="row-title">${scene.sensorName} · ${dayText(locale, scene.date)}</span>
            <span class="chips">${orderTag(locale, scene)}</span>
        </a>
    </li>`;
}

/** Work's orders, the ones that need the admin first; none while there is no open order. */
export function ordersGroup(context: ImageryContext): TemplateResult {
    const orders = openOrders(context.view);
    if (orders.length === 0) {
        return EMPTY;
    }
    return html`<section class="section" aria-labelledby="imagery-orders">
        <h3 id="imagery-orders">${contentText(context.locale, 'adminContent.orders.group')}</h3>
        <ul class="rows">
            ${orders.toSorted((a, b) => Number(needsYou(b)) - Number(needsYou(a))).map((scene) => orderRow(context, scene))}
        </ul>
    </section>`;
}

/** True when Work has orders to list. */
export function hasOpenOrders(view: ImageryViewState): boolean {
    return openOrders(view).length > 0;
}
