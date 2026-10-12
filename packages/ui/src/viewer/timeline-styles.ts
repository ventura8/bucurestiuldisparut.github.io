/**
 * Styles of `<hcm-timeline>`. The thumb is the hero moment: a pill that morphs into a rounded square and grows while
 * it is dragged, on the M3 Expressive "fast spatial" spring converted for the web (cubic-bezier(0.42, 1.67, 0.21,
 * 0.9), 350 ms); `prefers-reduced-motion: reduce` turns every transition off.
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

        :host([orientation='vertical']) {
            block-size: 100%;
            padding-block: 32px;
            padding-inline: 8px 56px;
        }

        .track {
            position: relative;
            block-size: 48px;
            cursor: pointer;
        }

        :host([orientation='vertical']) .track {
            inline-size: 48px;
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
            inset-inline-start: 22px;
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
            transform: translateX(-50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
            font-size: var(--md-sys-typescale-label-small-size, 0.6875rem);
            color: var(--md-sys-color-on-surface-variant, GrayText);
            white-space: nowrap;
        }

        :host([orientation='vertical']) .stop {
            inset-inline-start: 20px;
            inset-block: auto var(--hcm-stop);
            transform: translateY(50%);
            flex-direction: row;
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

        .thumb {
            position: absolute;
            inset-inline-start: var(--hcm-position);
            inset-block-start: 4px;
            transform: translateX(-50%);
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
            inset-inline-start: 4px;
            inset-block: auto var(--hcm-position);
            transform: translateY(50%);
        }

        :host([dragging]) .thumb {
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            transform: translateX(-50%) scale(1.12);
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
