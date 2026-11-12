/**
 * `<hcm-seam-pair>`: step 2 of the tile-import wizard (`docs/research/M20-import-local.md` §19; S-A-HAPPY-TILE-WIZARD-SEAM). One
 * weak seam at a time: the two strips side by side, cut from `seams.jpg`, with the pipeline's guess drawn as a dot on each. The
 * owner accepts the guess (Enter, the pair focused) or clicks one matching point on each strip; N goes to the next seam.
 */
import type { Locale } from '@hcm/shared';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { adminBase } from '../shell/admin-styles.js';
import { spriteProperties } from './tile-grid.js';
import { tilesText as t } from './tiles-text.js';
import { tileStyles } from './tiles-styles.js';
import type { TilePointPort, TileRectPort, TileSeamPort, TilesIntentsPort, TilesViewState } from './tiles-port.js';

export const HCM_SEAM_PAIR_TAG = 'hcm-seam-pair';

type Side = 'a' | 'b';

/** A point of the sheet's rectangle as a share of the strip shown, in per cent. */
function placeOf(point: TilePointPort, sheet: TileRectPort): Readonly<Record<string, string>> {
    return {
        '--x': `${String(((point[0] - sheet[0]) / sheet[2]) * 100)}%`,
        '--y': `${String(((point[1] - sheet[1]) / sheet[3]) * 100)}%`,
    };
}

/** Where a click on a strip lands in the oriented sheet's pixels. */
export function pointOf(event: MouseEvent, element: Element, sheet: TileRectPort): TilePointPort {
    const box = element.getBoundingClientRect();
    const across = (event.clientX - box.left) / Math.max(box.width, 1);
    const down = (event.clientY - box.top) / Math.max(box.height, 1);
    return [Math.round(sheet[0] + across * sheet[2]), Math.round(sheet[1] + down * sheet[3])];
}

/** Enter accepts the guess, N goes to the next seam (no modifier). */
function keyAction(event: KeyboardEvent): 'acceptSeam' | 'nextSeam' | undefined {
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return undefined;
    }
    const keys: Readonly<Record<string, 'acceptSeam' | 'nextSeam'>> = { Enter: 'acceptSeam', n: 'nextSeam', N: 'nextSeam' };
    return keys[event.key];
}

/** A strip's piece of the sprite as CSS properties. */
function stripProperties(rect: TileRectPort, sprite: TilesViewState['seamsSprite']): Readonly<Record<string, string>> {
    const [sx, sy, sw, sh] = rect;
    const whole = spriteProperties(sprite);
    return {
        ...{ '--sx': String(sx), '--sy': String(sy), '--sw': String(sw), '--sh': String(sh) },
        ...{ '--spw': whole['--sw'], '--sph': whole['--sh'], '--img': whole['--img'] },
    };
}

/** A dot at a point of the strip (none: nothing). */
function dot(point: TilePointPort | null, sheet: TileRectPort, classes: string): TemplateResult | string {
    return point === null ? '' : html`<span class=${classes} ${cssProperties(placeOf(point, sheet))}></span>`;
}

class HcmSeamPair extends LitElement {
    static override readonly properties = { view: { attribute: false }, intents: { attribute: false }, locale: { type: String } };

    static override readonly styles = [
        adminBase,
        tileStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .pair {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
            }

            figure {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 0;
            }

            .strip {
                position: relative;
                inline-size: calc(var(--sw) * var(--hcm-seam-side) / 256);
                block-size: calc(var(--sh) * var(--hcm-seam-side) / 256);
                background-image: var(--img);
                background-repeat: no-repeat;
                background-size: calc(var(--spw) * var(--hcm-seam-side) / 256) calc(var(--sph) * var(--hcm-seam-side) / 256);
                background-position: calc(var(--sx) * var(--hcm-seam-side) / -256) calc(var(--sy) * var(--hcm-seam-side) / -256);
                background-color: var(--md-sys-color-surface-container-highest, GrayText);
                cursor: crosshair;
            }

            .dot {
                position: absolute;
                inset-inline-start: var(--x);
                inset-block-start: var(--y);
                inline-size: 12px;
                block-size: 12px;
                margin: -6px;
                border: 2px solid var(--md-sys-color-on-primary, Canvas);
                border-radius: 50%;
                background: var(--md-sys-color-primary, Highlight);
                pointer-events: none;
            }

            .dot.guess {
                background: var(--md-sys-color-tertiary, Mark);
            }

            .pair:focus-visible {
                outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
                outline-offset: 2px;
            }

            .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
        `,
    ];

    declare view: TilesViewState | null;
    declare intents: TilesIntentsPort | null;
    declare locale: Locale;

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'ro';
    }

    override render(): TemplateResult {
        const view = this.view;
        const seam = view?.seams[view.seam];
        if (view === null || seam === undefined) {
            return html`<p class="note" role="status">${t(this.locale, 'adminTiles.noSeams')}</p>`;
        }
        const of = { n: String(view.seam + 1), total: String(view.seams.length), a: seam.nameA, b: seam.nameB };
        return html`<h3>${t(this.locale, 'adminTiles.seamOf', of)}</h3>
            <p class="note">${t(this.locale, 'adminTiles.seamHelp')}</p>
            <div class="pair" role="group" tabindex="0" aria-label=${t(this.locale, 'adminTiles.seamsLabel')} @keydown=${this.#key}>
                ${this.#strip(view, seam, 'a')} ${this.#strip(view, seam, 'b')}
            </div>
            <p class="note" role="status">${seam.answered ? t(this.locale, 'adminTiles.seamAnswered') : ''}</p>
            <div class="actions">
                <hcm-button variant="tonal" icon="check" ?disabled=${seam.suggestion === null} @click=${() => this.intents?.acceptSeam()}
                    >${t(this.locale, 'adminTiles.acceptSeam')}</hcm-button
                >
                <hcm-button variant="outlined" icon="chevron_right" @click=${() => this.intents?.nextSeam()}
                    >${t(this.locale, 'adminTiles.nextSeam')}</hcm-button
                >
            </div>`;
    }

    #strip(view: TilesViewState, seam: TileSeamPort, side: Side): TemplateResult {
        const strip = seam.strips === null ? undefined : seam.strips[side];
        if (strip === undefined) {
            return html``;
        }
        const name = side === 'a' ? seam.nameA : seam.nameB;
        const guess = seam.suggestion === null ? null : seam.suggestion[side];
        return html`<figure>
            <div
                class="strip"
                role="img"
                aria-label=${t(this.locale, 'adminTiles.strip', { name })}
                data-side=${side}
                ${cssProperties(stripProperties(strip.sprite, view.seamsSprite))}
                @click=${(event: MouseEvent) => {
                    this.intents?.pick(side, pointOf(event, event.currentTarget as Element, strip.sheet));
                }}
            >
                ${dot(guess, strip.sheet, 'dot guess')} ${dot(seam.picked[side], strip.sheet, 'dot')}
            </div>
            <figcaption class="note">${name}</figcaption>
        </figure>`;
    }

    #key = (event: KeyboardEvent): void => {
        const action = keyAction(event);
        if (action !== undefined) {
            event.preventDefault();
            this.intents?.[action]();
        }
    };
}

export function defineHcmSeamPair(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SEAM_PAIR_TAG) === undefined) {
        registry.define(HCM_SEAM_PAIR_TAG, HcmSeamPair);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-seam-pair': HcmSeamPair;
    }
}
