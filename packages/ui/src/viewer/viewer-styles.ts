/**
 * Styles of `<hcm-map-viewer>`. The host is a size container (`hcm-viewer`): window classes come from the viewer's own
 * box, never the browser window, so an embedded map adapts to the space it is given. The panes are a grid
 * (`data-layout` from `layoutFor`); the container queries set the gutters and pane widths of each class (M3: 16 dp on
 * compact, 24 dp from medium; supporting pane 360 px, 412 px from large; on extra-large a 360 px layers pane and a
 * 400 px detail pane). Floating controls keep a strip at the bottom of the map free for the Mapbox logo and
 * attribution (scenario V18) and respect the safe areas of notched phones.
 */
import { css } from 'lit';

import { baseStyles, sheetStyles } from './shared-styles.js';

export const viewerStyles = [
    baseStyles,
    sheetStyles,
    css`
        :host {
            /* The kit's modal sheets cover the whole viewer, above the floating controls (z-index up to 26). */
            --hcm-sheet-z-index: 28;
            --hcm-gutter: 16px;
            --hcm-map-chrome: 36px;
            --hcm-pane-leading: 360px;
            --hcm-pane-trailing: 360px;

            position: relative;
            display: block;
            box-sizing: border-box;
            inline-size: 100%;
            block-size: 100%;
            min-block-size: 320px;
            overflow: hidden;
            container: hcm-viewer / size;
            background: var(--md-sys-color-surface, Canvas);
        }

        @container hcm-viewer (width >= 600px) {
            .frame {
                --hcm-gutter: 24px;
            }
        }

        @container hcm-viewer (width >= 1200px) {
            .frame {
                --hcm-pane-trailing: 412px;
            }
        }

        @container hcm-viewer (width >= 1600px) {
            .frame {
                --hcm-pane-trailing: 400px;
            }
        }

        .frame {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            block-size: 100%;
        }

        .frame[data-panes='leading'] {
            grid-template-columns: var(--hcm-pane-leading) minmax(0, 1fr);
        }

        .frame[data-panes='trailing'] {
            grid-template-columns: minmax(0, 1fr) var(--hcm-pane-trailing);
        }

        .frame[data-panes='both'] {
            grid-template-columns: var(--hcm-pane-leading) minmax(0, 1fr) var(--hcm-pane-trailing);
        }

        .pane {
            min-inline-size: 0;
            overflow: hidden;
        }

        .pane.leading .docked {
            border-inline: 0 1px solid var(--md-sys-color-outline-variant, GrayText);
        }

        .map-pane {
            position: relative;
            min-inline-size: 0;
            overflow: hidden;
        }

        .map {
            position: absolute;
            inset: 0;
        }

        .skip {
            position: absolute;
            inset-block-start: 8px;
            inset-inline-start: 8px;
            z-index: 40;
            min-block-size: 48px;
            padding-inline: 16px;
            border: 0;
            border-radius: var(--md-sys-shape-corner-full, 9999px);
            background: var(--md-sys-color-primary, Highlight);
            color: var(--md-sys-color-on-primary, HighlightText);
            font: inherit;
            transform: translateY(-200%);
        }

        .skip:focus-visible {
            transform: none;
        }

        .status {
            position: absolute;
            inset: 0;
            z-index: 5;
            display: grid;
            place-items: center;
            box-sizing: border-box;
            padding: var(--hcm-gutter);
            overflow: auto;
            background: var(--md-sys-color-surface, Canvas);
        }

        .skeleton {
            display: grid;
            justify-items: center;
            gap: 16px;
        }

        .skeleton .shimmer {
            inline-size: min(320px, 70cqi);
            block-size: 12px;
            border-radius: 6px;
            background: linear-gradient(
                90deg,
                var(--md-sys-color-surface-container-high, Canvas),
                var(--md-sys-color-surface-container-highest, GrayText),
                var(--md-sys-color-surface-container-high, Canvas)
            );
            background-size: 200% 100%;
            animation: hcm-shimmer 1.4s linear infinite;
        }

        @keyframes hcm-shimmer {
            to {
                background-position: -200% 0;
            }
        }

        /* Without WebGL the photo list scrolls under the menu button: its last row can scroll clear of it. */
        .fallback {
            display: flex;
            flex-direction: column;
            gap: 16px;
            inline-size: min(560px, 100%);
            align-self: start;
            padding-block-end: calc(var(--hcm-map-chrome) + 56px);
        }

        .dock {
            position: absolute;
            z-index: 10;
        }

        .dock.timeline {
            inset-inline: var(--hcm-gutter);
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
        }

        /* No layers yet: a small note where the timeline will be, clear of the FAB menu on the trailing side. */
        .dock.timeline-note {
            inset-inline: var(--hcm-gutter) calc(var(--hcm-gutter) + 72px);
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
            display: flex;
            justify-content: flex-start;
            pointer-events: none;
        }

        .note {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            min-block-size: 40px;
            box-sizing: border-box;
            padding: 8px 16px 8px 12px;
            border-radius: var(--md-sys-shape-corner-full, 9999px);
            background: var(--md-sys-color-surface-container-high, Canvas);
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            box-shadow: var(--md-sys-elevation-level2, 0 2px 6px rgb(0 0 0 / 30%));
            font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
            line-height: 1.4;
            pointer-events: auto;
        }

        .dock.menu {
            /* Above the consent banner and the snackbar: the open menu grows upwards over them (kit-integration test). */
            z-index: 26;
            inset-inline-end: var(--hcm-gutter);
            inset-block-end: calc(var(--hcm-map-chrome) + 100px + env(safe-area-inset-bottom, 0px));
        }

        .frame:not([data-timeline]) .dock.menu {
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
        }

        /*
         * Compact: one row above the menu button, which shares the row above the timeline (the tour found them
         * overlapping at 320 px).
         */
        .dock.chip {
            inset-inline-start: var(--hcm-gutter);
            inset-block-end: calc(var(--hcm-map-chrome) + 100px + 64px + env(safe-area-inset-bottom, 0px));
        }

        .dock.consent {
            inset-inline: var(--hcm-gutter);
            inset-block-start: var(--hcm-gutter);
            max-inline-size: 480px;
            z-index: 20;
        }

        .dock.toast {
            inset-inline: var(--hcm-gutter);
            inset-block-start: var(--hcm-gutter);
            display: grid;
            justify-items: center;
            z-index: 25;
        }

        /*
         * The kit's snackbar places itself at the bottom of its container; here it flows in the top dock (the tour
         * found it above the top edge of the map).
         */
        .dock.toast hcm-snackbar {
            position: static;
        }

        @container hcm-viewer (width >= 600px) {
            .dock.timeline {
                inset-inline: calc(var(--hcm-gutter) + 72px);
                max-inline-size: 640px;
                margin-inline: auto;
            }

            .dock.menu,
            .frame:not([data-timeline]) .dock.menu {
                inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
            }

            .dock.chip {
                inset-inline-start: calc(var(--hcm-gutter) + 72px);
                inset-block-end: calc(var(--hcm-map-chrome) + 100px + env(safe-area-inset-bottom, 0px));
            }

            .dock.timeline-note {
                justify-content: center;
            }
        }

        .frame[data-compact-height] .dock.timeline {
            inset-block: var(--hcm-gutter) var(--hcm-map-chrome);
            inset-inline: auto var(--hcm-gutter);
            max-inline-size: none;
            margin-inline: 0;
        }

        /*
         * A landscape phone is too short for the whole menu: below the top gutter its items continue in a second
         * column (the tour found items off screen). The menu is docked on the leading edge, so the FAB and the items
         * line up there: aligned to the end, the wider two-column menu pushed the FAB 300 px away from where it was
         * tapped (UX review).
         */
        .frame[data-compact-height] .dock.menu {
            inset-inline: var(--hcm-gutter) auto;
            inset-block-end: calc(var(--hcm-map-chrome) + 8px);

            --hcm-fab-menu-align: flex-start;
            --hcm-fab-menu-max-block-size: calc(100cqb - var(--hcm-map-chrome) - 8px - 56px - 8px - var(--hcm-gutter));
        }

        .frame[data-compact-height] .dock.chip {
            inset-inline-start: calc(var(--hcm-gutter) + 72px);
            inset-block-end: calc(var(--hcm-map-chrome) + 8px);
        }

        @media (prefers-reduced-motion: reduce) {
            .skeleton .shimmer {
                animation: none;
            }
        }
    `,
];
