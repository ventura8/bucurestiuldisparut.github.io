/**
 * Styles of `<hcm-timeline>`. The thumb is the hero moment: a pill that morphs into a rounded square and grows while
 * it is dragged, on the M3 Expressive "fast spatial" spring converted for the web (cubic-bezier(0.42, 1.67, 0.21,
 * 0.9), 350 ms); `prefers-reduced-motion: reduce` turns every transition off. The horizontal timeline is exactly 84 px
 * tall (8 + 48 + 28) and the vertical one 68 px wide (8 + 52 + 8): the viewer docks its FAB and chip with those numbers
 * (`--hcm-timeline-block`, `--hcm-top-start`). The pill never hides another year's label (the owner's phone,
 * 2026-11-08: "1980" over 1979 and 1982): lying, the labels are a row below it; standing, the years are the ruler in
 * the pill's lane, whose stops the phone's height spaces wider than the pill. The list of stops has no margin of its own: the
 * browser's 1em of an `ol` collapsed through the track, made the timeline 100 px tall with a 16 px page font and more
 * with a larger one, and left no room for the open FAB menu above it on a 568 px phone. The card holds a scroller with
 * the padding: the track fits it unless the years are closer than 14 px (`density`, `timeline-model.ts`), and only then
 * scrolls, under a finger too, behind a mask that fades the edge with more years beyond (`--hcm-fade-start`, `-end`).
 * A year with several dates has a badge on its point (V13); on a phone, idle, the card collapses to its pill (V12).
 * The year chip (`.tip`) is an M3 plain tooltip outside the scroller, so the card's mask never clips it.
 */
import { css } from 'lit';

import { touchTarget, visuallyHidden } from '../components/styles.js';
import { baseStyles } from './shared-styles.js';

export const timelineStyles = [
    baseStyles,
    // The thumb is 40 px tall; its touch target is 48 × 48 px (the tour checks every target on compact).
    touchTarget,
    // The polite live region that says the year a drag or a scrub ended on.
    visuallyHidden,
    css`
        :host {
            --hcm-timeline-spring: cubic-bezier(0.42, 1.67, 0.21, 0.9);

            /* What centres a stop or the thumb on its place: right to left, inline-start is the right edge. */
            --hcm-x: -50%;

            /* The year chip is placed against the card (timeline-tip.ts). */
            position: relative;
            display: block;
            box-sizing: border-box;
            border-radius: var(--md-sys-shape-corner-extra-large, 28px);
            background: var(--md-sys-color-surface-container, Canvas);
            box-shadow: 0 4px 12px color-mix(in srgb, var(--md-sys-color-shadow, CanvasText) 30%, transparent);
            touch-action: none;
            user-select: none;
        }

        :host(:dir(rtl)) {
            --hcm-x: 50%;
        }

        /*
         * The card's touch-action reaches the track: the scroller is a scroll container, where a browser stops looking up
         * for touch-action, so without it a finger on the track panned and cancelled the scrub (lesson 642).
         */
        .scroller,
        .track {
            touch-action: inherit;
        }

        .scroller {
            --hcm-fade-to: to right;

            box-sizing: border-box;
            padding-block: 8px 28px;
            padding-inline: 44px;
            border-radius: inherit;
            overflow: auto;
            scrollbar-width: none;
        }

        :host([orientation='vertical']) {
            block-size: 100%;
        }

        :host([orientation='vertical']) .scroller {
            --hcm-fade-to: to bottom;

            block-size: 100%;
            padding: 24px 8px;
        }

        .track {
            position: relative;
            block-size: 48px;
            cursor: pointer;
        }

        /*
         * Years closer than 14 px (the review, 2026-11-08: twenty-two stops 17 px apart, the pill over its neighbours):
         * the stops keep 16 px apart, every other one labelled, and the card scrolls; a finger may scroll it along the
         * timeline (it drags the thumb itself), and the edge with more years beyond fades.
         */
        :host([density='scroll']) {
            touch-action: pan-x;
        }

        :host([density='scroll'][orientation='vertical']) {
            touch-action: pan-y;
        }

        :host([density='scroll']) .scroller {
            mask-image: linear-gradient(
                var(--hcm-fade-to),
                transparent,
                CanvasText var(--hcm-fade-start, 0%),
                CanvasText calc(100% - var(--hcm-fade-end, 0%)),
                transparent
            );
        }

        :host([density='scroll']:dir(rtl)) .scroller {
            --hcm-fade-to: to left;
        }

        :host([density='scroll']) .track {
            min-inline-size: calc(var(--hcm-gaps) * 16px);
        }

        /* No margin, padding or marker: the stops are placed on the track, the list only holds them. */
        .stops {
            all: unset;
        }

        :host([orientation='vertical']) .track {
            inline-size: 52px;
            min-inline-size: 0;
            block-size: 100%;
        }

        :host([density='scroll'][orientation='vertical']) .track {
            min-block-size: calc(var(--hcm-gaps) * 16px);
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

        /* The pill names the selected year; a dense track names every other year (a minor stop keeps its tick, unlabelled). */
        .stop.selected .label,
        .stop.minor .label {
            visibility: hidden;
        }

        :host([orientation='vertical']) .tick {
            display: none;
        }

        :host([orientation='vertical']) .label {
            padding-block: 2px;
            background: var(--md-sys-color-surface-container, Canvas);
        }

        /* Standing, an unlabelled year is a tick on the rail, centred on its place. */
        :host([orientation='vertical']) .stop.minor:not(.selected) .label {
            display: none;
        }

        :host([orientation='vertical']) .stop.minor:not(.selected) .tick {
            display: block;
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
            transition: 350ms var(--hcm-timeline-spring);
            transition-property: inset-inline-start, inset-block-end, border-radius, transform;

            /* The thumb drags under a finger also where the card scrolls. */
            touch-action: none;
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

        /*
         * V13: a year with several dates has a badge on its point, the count in a 16 px M3 badge (error colours, as M3's)
         * over its tick (standing, at the lane's end beside its label); the selected year's is on the pill's corner.
         */
        .badge {
            position: absolute;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            min-inline-size: 16px;
            block-size: 16px;
            padding-inline: 4px;
            border-radius: 8px;
            background: var(--md-sys-color-error, Mark);
            color: var(--md-sys-color-on-error, MarkText);
            font-size: 11px;
            font-weight: 600;
            line-height: 1;
            visibility: visible;

            /* A hint only (V13): a press through it lands on the year's point or the thumb, which select the year. */
            pointer-events: none;
            z-index: 1;
        }

        .thumb .badge {
            inset-block-start: -6px;
            inset-inline-end: -6px;
        }

        .stop .badge {
            inset-block-start: -4px;
            inset-inline-start: 50%;
            transform: translateX(var(--hcm-x));
        }

        :host([orientation='vertical']) .stop .badge {
            inset-block-start: 50%;
            inset-inline: auto -6px;
            transform: translateY(-50%);
        }

        /*
         * V12: on a phone, idle, the card is only the pill of its year, the rail and the years hidden; the viewer docks it
         * (timeline-dock.ts). A tap on it opens the whole card again. The owner (2026-11-13: "too small") asked for a bigger
         * one: a 56 px pill in 4 px of card (64 px tall), the year in M3 title large, 20 px either side of it.
         */
        :host([collapsed][orientation]) {
            inline-size: max-content;
            block-size: auto;
            touch-action: manipulation;
        }

        :host([collapsed][orientation]) .scroller {
            block-size: auto;
            padding: 4px;
            overflow: visible;
            mask-image: none;
        }

        :host([collapsed][orientation]) .track {
            inline-size: auto;
            min-inline-size: 0;
            block-size: 56px;
            min-block-size: 0;
        }

        :host([collapsed][orientation]) :is(.rail, .active, .stops) {
            display: none;
        }

        :host([collapsed][orientation]) .thumb {
            position: relative;
            inset: auto;
            min-inline-size: 88px;
            block-size: 56px;
            padding-inline: 20px;
            font-size: var(--md-sys-typescale-title-large-size, 1.375rem);
            line-height: var(--md-sys-typescale-title-large-line-height, 1.75rem);
            transform: none;
            transition: none;
        }

        /*
         * The year chip: an M3 plain tooltip (inverse surface, body small, 24 px tall at least, the extra-small corner), placed
         * by placeTip over the card lying and beside it standing; it never takes the pointer.
         */
        .tip {
            position: absolute;
            z-index: 1;
            box-sizing: border-box;
            min-block-size: 24px;
            padding: 4px 8px;
            border-radius: var(--md-sys-shape-corner-extra-small, 4px);
            background: var(--md-sys-color-inverse-surface, CanvasText);
            color: var(--md-sys-color-inverse-on-surface, Canvas);
            font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
            line-height: 16px;
            white-space: nowrap;
            pointer-events: none;
        }

        @media (prefers-reduced-motion: reduce) {
            .active,
            .thumb {
                transition: none;
            }
        }

        @media (forced-colors: active) {
            .thumb,
            .tip {
                border: 2px solid ButtonText;
            }
        }
    `,
];
