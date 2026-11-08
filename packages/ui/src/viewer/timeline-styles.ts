/**
 * Styles of `<hcm-timeline>`. The thumb is the hero moment: a pill that morphs into a rounded square and grows while
 * it is dragged, on the M3 Expressive "fast spatial" spring converted for the web (cubic-bezier(0.42, 1.67, 0.21,
 * 0.9), 350 ms); `prefers-reduced-motion: reduce` turns every transition off. The horizontal timeline is exactly 84 px
 * tall (8 + 48 + 28) and the vertical one 68 px wide (8 + 52 + 8): the viewer docks its FAB and chip with those numbers
 * (`--hcm-timeline-block`, `--hcm-top-start`). The pill never hides another year's label (the owner's phone,
 * 2026-11-08: "1980" over 1979 and 1982): lying, the labels are a row below it; standing, the years are the ruler in
 * the pill's lane, whose stops the phone's height spaces wider than the pill. The list of stops has no margin of its own: the
 * browser's 1em of an `ol` collapsed through the track, made the timeline 100 px tall with a 16 px page font and more
 * with a larger one, and left no room for the open FAB menu above it on a 568 px phone.
 */
import { css } from 'lit';

import { touchTarget } from '../components/styles.js';
import { baseStyles } from './shared-styles.js';

export const timelineStyles = [
    baseStyles,
    // The thumb is 40 px tall; its touch target is 48 × 48 px (the tour checks every target on compact).
    touchTarget,
    css`
        :host {
            --hcm-timeline-spring: cubic-bezier(0.42, 1.67, 0.21, 0.9);

            /* What centres a stop or the thumb on its place: right to left, inline-start is the right edge. */
            --hcm-x: -50%;

            display: block;
            box-sizing: border-box;
            padding-block: 8px 28px;
            padding-inline: 44px;
            border-radius: var(--md-sys-shape-corner-extra-large, 28px);
            background: var(--md-sys-color-surface-container, Canvas);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--md-sys-color-shadow, CanvasText) 30%, transparent);
            touch-action: none;
            user-select: none;
        }

        :host(:dir(rtl)) {
            --hcm-x: 50%;
        }

        :host([orientation='vertical']) {
            block-size: 100%;
            padding: 24px 8px;
        }

        .track {
            position: relative;
            block-size: 48px;
            cursor: pointer;
        }

        .stops {
            margin: 0;
            padding: 0;
            list-style: none;
        }

        :host([orientation='vertical']) .track {
            inline-size: 52px;
            block-size: 100%;
        }

        .rail,
        .active {
            position: absolute;
            inset-inline: 0;
            inset-block-start: 22px;
            block-size: 4px;
            border-radius: 2px;
            background: var(--md-sys-color-secondary-container, GrayText);
        }

        .active {
            inset-inline-end: auto;
            inline-size: var(--hcm-position);
            background: var(--md-sys-color-primary, Highlight);
            transition: inline-size 350ms var(--hcm-timeline-spring);
        }

        :host([orientation='vertical']) .rail,
        :host([orientation='vertical']) .active {
            inset-block: 0;
            inset-inline-start: 24px;
            inline-size: 4px;
            block-size: auto;
        }

        :host([orientation='vertical']) .active {
            inset-block-start: auto;
            block-size: var(--hcm-position);
            transition-property: block-size;
        }

        .stop {
            position: absolute;
            inset-inline-start: var(--hcm-stop);
            inset-block-start: 20px;
            transform: translateX(var(--hcm-x));
            display: flex;
            flex-direction: column;
            align-items: center;

            /* The label's row begins below the pill (4 to 44 px), not beside it. */
            gap: 20px;
            font-size: var(--md-sys-typescale-label-small-size, 0.6875rem);
            color: var(--md-sys-color-on-surface-variant, GrayText);
            white-space: nowrap;
        }

        /* Standing, a year is its own mark on the rail, which its label's ground interrupts. */
        :host([orientation='vertical']) .stop {
            inset-inline: 0;
            inset-block: auto var(--hcm-stop);
            transform: translateY(50%);
        }

        .tick {
            inline-size: 8px;
            block-size: 8px;
            border-radius: 50%;
            background: var(--md-sys-color-on-secondary-container, GrayText);
        }

        .stop.selected .label {
            visibility: hidden;
        }

        :host([orientation='vertical']) .tick {
            display: none;
        }

        :host([orientation='vertical']) .label {
            padding-block: 2px;
            background: var(--md-sys-color-surface-container, Canvas);
        }

        .thumb {
            position: absolute;
            inset-inline-start: var(--hcm-position);
            inset-block-start: 4px;
            transform: translateX(var(--hcm-x));
            display: grid;
            place-items: center;
            box-sizing: border-box;
            min-inline-size: 64px;
            block-size: 40px;
            padding-inline: 12px;
            border-radius: var(--md-sys-shape-corner-full, 9999px);
            background: var(--md-sys-color-primary, Highlight);
            color: var(--md-sys-color-on-primary, HighlightText);
            font-weight: 600;
            cursor: grab;
            transition:
                inset-inline-start 350ms var(--hcm-timeline-spring),
                inset-block-end 350ms var(--hcm-timeline-spring),
                border-radius 350ms var(--hcm-timeline-spring),
                transform 350ms var(--hcm-timeline-spring);
        }

        :host([orientation='vertical']) .thumb {
            inset-inline-start: 0;
            inset-block: auto var(--hcm-position);
            min-inline-size: 100%;
            padding: 0;
            transform: translateY(50%);
        }

        :host([dragging]) .thumb {
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            transform: translateX(var(--hcm-x)) scale(1.12);
            cursor: grabbing;
        }

        :host([dragging][orientation='vertical']) .thumb {
            transform: translateY(50%) scale(1.12);
        }

        @media (prefers-reduced-motion: reduce) {
            .active,
            .thumb {
                transition: none;
            }
        }

        @media (forced-colors: active) {
            .thumb {
                border: 2px solid ButtonText;
            }
        }
    `,
];
