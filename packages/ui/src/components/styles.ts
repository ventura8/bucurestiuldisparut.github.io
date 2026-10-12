/**
 * Style fragments shared by the kit elements. Colours, shapes, type and motion come only from the `--md-sys-*` tokens
 * that `applyTheme` sets on the app's root (stylelint bans hex and named colours here).
 */
import { css } from 'lit';

/** Base of every element: the kit's typeface, no tap flash, `hidden` really hides. */
export const baseStyles = css`
    :host {
        font-family: var(--md-ref-typeface-plain);
        -webkit-tap-highlight-color: transparent;
    }

    :host([hidden]),
    [hidden] {
        display: none !important;
    }
`;

/** The M3 focus indicator: a 3 px secondary-colour ring outside the focused control, keyboard focus only. */
export const focusRing = css`
    :focus-visible {
        outline: var(--md-sys-state-focus-indicator-thickness) solid var(--md-sys-color-secondary);
        outline-offset: var(--md-sys-state-focus-indicator-outer-offset);
    }

    @media (forced-colors: active) {
        :focus-visible {
            outline-color: Highlight;
        }
    }
`;

/**
 * The state layer of an interactive surface: a `::before` overlay in the content colour at the M3 hover, focus and
 * pressed opacities. The surface needs `position: relative` and the class `interactive`.
 */
export const stateLayer = css`
    .interactive {
        position: relative;
        overflow: hidden;
        cursor: pointer;
    }

    .interactive::before {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: inherit;
        background: currentcolor;
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--md-sys-motion-spring-fast-effects-duration) var(--md-sys-motion-spring-fast-effects-easing);
    }

    .interactive:hover::before {
        opacity: var(--md-sys-state-hover-state-layer-opacity);
    }

    .interactive:focus-visible::before {
        opacity: var(--md-sys-state-focus-state-layer-opacity);
    }

    .interactive:active::before {
        opacity: var(--md-sys-state-pressed-state-layer-opacity);
    }

    .interactive:disabled {
        cursor: default;
    }

    .interactive:disabled::before {
        opacity: 0;
    }
`;

/** Text for screen readers only (live regions, extra labels). */
export const visuallyHidden = css`
    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
        border: 0;
    }
`;

/**
 * A 48 × 48 px touch target around a smaller visual control (M3: targets of at least 48 dp). The control needs
 * `position: relative` and the class `touch-target`.
 */
export const touchTarget = css`
    .touch-target::after {
        content: '';
        position: absolute;
        inset: 50% auto auto 50%;
        width: max(100%, 48px);
        height: max(100%, 48px);
        transform: translate(-50%, -50%);
    }
`;

/** Type roles used by several elements. */
export const typeStyles = css`
    .label-large {
        font-family: var(--md-sys-typescale-label-large-font);
        font-size: var(--md-sys-typescale-label-large-size);
        font-weight: var(--md-sys-typescale-label-large-weight);
        line-height: var(--md-sys-typescale-label-large-line-height);
        letter-spacing: var(--md-sys-typescale-label-large-tracking);
    }

    .body-medium {
        font-family: var(--md-sys-typescale-body-medium-font);
        font-size: var(--md-sys-typescale-body-medium-size);
        font-weight: var(--md-sys-typescale-body-medium-weight);
        line-height: var(--md-sys-typescale-body-medium-line-height);
        letter-spacing: var(--md-sys-typescale-body-medium-tracking);
    }

    .title-medium {
        font-family: var(--md-sys-typescale-title-medium-font);
        font-size: var(--md-sys-typescale-title-medium-size);
        font-weight: var(--md-sys-typescale-title-medium-weight);
        line-height: var(--md-sys-typescale-title-medium-line-height);
        letter-spacing: var(--md-sys-typescale-title-medium-tracking);
    }

    .headline-small {
        font-family: var(--md-sys-typescale-headline-small-font);
        font-size: var(--md-sys-typescale-headline-small-size);
        font-weight: var(--md-sys-typescale-headline-small-weight);
        line-height: var(--md-sys-typescale-headline-small-line-height);
        letter-spacing: var(--md-sys-typescale-headline-small-tracking);
    }
`;
