/**
 * Styles of `<hcm-map-viewer>`. The host is a size container (`hcm-viewer`): window classes come from the viewer's own
 * box, never the browser window, so an embedded map adapts to the space it is given. The panes are a grid
 * (`data-layout` from `layoutFor`); the container queries set the gutters and pane widths of each class (M3: 16 dp on
 * compact, 24 dp from medium; supporting pane 360 px, 412 px from large; on extra-large a 360 px layers pane and a
 * 400 px detail pane). Floating controls keep a strip at the bottom of the map free for the Mapbox logo and
 * attribution (scenario V18) and respect the safe areas of notched phones. They stack with M3's 8 px between touch
 * targets: the strip, the timeline, the FAB, the "photos near this year" chip (the tour found the FAB on the timeline's
 * top edge and the timeline 2 px from the collapsed attribution on phones). A dock is only a box around its control:
 * the empty part of the toast dock and the FAB menu's let taps through to the map and the timeline.
 *
 * Inside the host, `.viewer` is a two-row grid: the frame spans both rows (the map never resizes), the modal layer
 * fills the first, and the legal bar, shown while a modal surface covers the map, is the second (auto height): a
 * sheet, its scrim and the lightbox end where the bar begins, and Mapbox's own bottom controls are hidden meanwhile.
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

            /*
             * The strip at the foot of the map: Mapbox's collapsed attribution (24 px, 10 px from the edge; the logo is 23
             * px, 6 px from it) plus the 8 px every floating control keeps from it.
             */
            --hcm-map-chrome: 42px;

            /* M3: 8 dp between touch targets. */
            --hcm-dock-gap: 8px;

            /* The horizontal timeline's height (hcm-timeline: 8 + 48 + 28 px; standing, it is 8 + 52 + 8 px wide). */
            --hcm-timeline-block: 84px;
            --hcm-fab-size: 56px;
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
            background: var(--md-sys-color-surface);
        }

        /* A wrapper, not the host, is the grid: a page may set the element's own display (display: block). */
        .viewer {
            position: relative;
            display: grid;
            grid-template-rows: minmax(0, 1fr) auto;
            grid-template-columns: minmax(0, 1fr);
            block-size: 100%;
        }

        /* The modal surfaces' containing block; it lets pointers through to the map where no surface is open. */
        .modal-layer {
            position: relative;
            grid-area: 1 / 1 / 2 / 2;
            pointer-events: none;
        }

        .modal-layer > * {
            pointer-events: auto;
        }

        .legal {
            position: relative;
            z-index: 32;
            grid-area: 2 / 1 / 3 / 2;
            padding-block-end: env(safe-area-inset-bottom, 0);
            padding-inline: var(--hcm-gutter);
            border-block-start: 1px solid var(--md-sys-color-outline-variant);
            background: var(--md-sys-color-surface-container);
        }

        /* While the logo and the attribution show in the legal bar or in About, Mapbox's own stay out of sight. */
        .frame[data-legal-mirror] .mapboxgl-ctrl-bottom-left,
        .frame[data-legal-mirror] .mapboxgl-ctrl-bottom-right {
            visibility: hidden;
        }

        /*
         * Mapbox's attribution is white in every theme: its toggle and links take a ring that is dark on white in both
         * schemes, the light scheme's primary (the dark scheme's inverse primary). The dark scheme's secondary, a light
         * tone, measured 1.71:1 on the collapsed attribution's toggle (the tour).
         */
        .mapboxgl-ctrl-attrib :focus-visible {
            outline-color: light-dark(var(--md-sys-color-primary), var(--md-sys-color-inverse-primary));
        }

        /*
         * Mapbox's box hides its overflow, and the canvas fills it: the canvas's ring is drawn inside it, or none of it
         * showed (the tour's ring check found the map's focus invisible). The full attribution sits in the box's corner
         * with no space below its links: they take a ring without offset, and the attribution the 3 px it needs.
         */
        .mapboxgl-canvas:focus-visible {
            outline-offset: -3px;
        }

        .mapboxgl-ctrl-attrib:not(.mapboxgl-compact) {
            padding-block: 3px;
        }

        .mapboxgl-ctrl-attrib a:focus-visible {
            outline-offset: 0;
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

        /* The frame spans both rows of the viewer: the map keeps the whole height while the legal bar shows. */
        .frame {
            display: grid;
            grid-area: 1 / 1 / 3 / 2;
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

        /*
         * The photo list's wrapper draws no box (as the other sheets' hosts): docked, its sheet is as tall as the pane and
         * its body scrolls. As a block it grew with the list past the pane, which hides its overflow, so the photos
         * below the fold were out of reach (the tour, from expanded up).
         */
        .photos-sheet,
        .unplaced-sheet {
            display: contents;
        }

        /*
         * The minimized Layers pane (extra-large) is one floating button on the map's leading edge: the map takes the whole width
         * (its ResizeObserver resizes Mapbox), and the top docks begin after the button.
         */
        .frame:has(> .pane.leading > [minimized]) {
            --hcm-pane-leading: 0px;
            --hcm-top-start: calc(var(--hcm-gutter) + 152px);
        }

        /* The floating button lies outside the empty column: its pane must not clip it (the tour: off screen, its focus ring cut). */
        .pane.leading:has(> [minimized]) {
            overflow: visible;
        }

        .pane.leading .docked {
            border-inline: 0 1px solid var(--md-sys-color-outline-variant);
        }

        .map-pane {
            position: relative;
            min-inline-size: 0;
            overflow: hidden;
        }

        /*
         * A long press on the map opens the map's menu (map-menu-trigger.ts): it never selects a label or the credits,
         * nor offers the browser's touch callout or Touch to Search (the Pixel 9 Pro review, P4).
         */
        .map {
            position: absolute;
            inset: 0;
            user-select: none;
            -webkit-touch-callout: none;
        }

        .skip {
            position: absolute;
            inset-block-start: 8px;
            inset-inline-start: var(--hcm-top-start, 8px);
            z-index: 40;
            min-block-size: 48px;
            padding-inline: 16px;
            border: 0;
            border-radius: var(--md-sys-shape-corner-full);
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            font: inherit;
            transform: translateY(-200%);
        }

        .skip:focus-visible {
            transform: none;
        }

        /* With the Layers pane docked on the leading side the skip link shows over the map, not over the pane's heading. */
        .frame[data-panes='leading'] .skip,
        .frame[data-panes='both'] .skip {
            inset-inline-start: calc(var(--hcm-pane-leading) + 8px);
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
            background: var(--md-sys-color-surface);
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
                var(--md-sys-color-surface-container-high),
                var(--md-sys-color-surface-container-highest),
                var(--md-sys-color-surface-container-high)
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
            padding-block-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap));
        }

        .dock {
            position: absolute;
            z-index: 10;
        }

        /* The menu's and the toast's docks are as wide as their popup or their row: only what they draw takes the pointer. */
        .dock.menu,
        .dock.toast {
            pointer-events: none;
        }

        /*
         * Lying (from 600 px, and on a short window of any width) the timeline is centred at the foot of the map, at most
         * 640 px wide, with a column free on either side for the menu button.
         */
        .dock.timeline {
            inset-inline: calc(var(--hcm-gutter) + 72px);
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
            max-inline-size: 640px;
            margin-inline: auto;
        }

        /*
         * Standing (a phone held upright, the owner's request of 2026-11-08) on the leading edge, from the top gutter
         * down to the chip's row: the chip, an icon button there, docks 8 px under its foot, a row above the menu button,
         * which keeps the bottom trailing corner; the open menu grows on the trailing side, clear of the 68 px card.
         */
        .frame[data-timeline='vertical'] .dock.timeline {
            inset-inline: var(--hcm-gutter) auto;
            inset-block: var(--hcm-gutter)
                calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + 40px + 2 * var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
        }

        /* No layers yet: a small note where the timeline will be, clear of the FAB menu on the trailing side. */
        .dock.timeline-note {
            inset-inline: var(--hcm-gutter) calc(var(--hcm-gutter) + 72px);
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
            display: flex;
            justify-content: flex-start;
            pointer-events: none;
        }

        .note,
        .dock.zoom {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            box-sizing: border-box;
            border-radius: var(--md-sys-shape-corner-full);
            background: var(--md-sys-color-surface-container-high);
            color: var(--md-sys-color-on-surface-variant);
            box-shadow: var(--md-sys-elevation-level2);
        }

        .note {
            min-block-size: 40px;
            padding: 8px 16px 8px 12px;
            font-size: var(--md-sys-typescale-label-large-size);
            line-height: 1.4;
            pointer-events: auto;
        }

        .dock.menu {
            /* Above the consent banner and the snackbar: the open menu grows upwards over them (kit-integration test). */
            z-index: 26;

            /* Beside a standing timeline the dock ends 8 px from it, and an item too wide wraps (text spacing at 320 px). */
            inset-inline: var(--hcm-top-start, auto) var(--hcm-gutter);
            text-align: end;
            inset-block-end: calc(var(--hcm-map-chrome) + env(safe-area-inset-bottom, 0px));
        }

        /*
         * Beside the lying timeline, which is taller than the FAB, the open menu's items end 8 px above it (the visual
         * audit found the last item over the timeline's thumb at 768 px).
         */
        .frame[data-timeline='horizontal'] .dock.menu {
            --hcm-fab-menu-gap: calc(var(--hcm-timeline-block) - var(--hcm-fab-size) + var(--hcm-dock-gap));
        }

        /*
         * On the lying card's leading edge, 8 px above it (the owner's screenshot of 2026-11-08: 72 px in from the map's
         * edge it was aligned to nothing beside the centred card); 50 % is half the map pane, the containing block of both.
         */
        .dock.chip {
            inset-inline-start: max(var(--hcm-gutter) + 72px, 50% - 320px);
            inset-block-end: calc(
                var(--hcm-map-chrome) + var(--hcm-timeline-block) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px)
            );
        }

        /*
         * The zoom buttons (V52): a vertical group (4 px around two 40 px buttons: 48 px targets) centred over the FAB on
         * the trailing edge, 8 px above it.
         */
        .dock.zoom {
            inset-inline-end: calc(var(--hcm-gutter) + 4px);
            inset-block-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
            flex-direction: column;
            padding: 4px;
        }

        /*
         * Beside a standing timeline, above the chip's row: the group's foot is level with the card's. The chip there is a
         * 40 px icon button (the owner, 2026-11-12) centred under the 68 px card, a row above the FAB: 14 px in.
         */
        .frame[data-timeline='vertical'] .dock.zoom {
            inset-block-end: calc(
                var(--hcm-map-chrome) + var(--hcm-fab-size) + 40px + 2 * var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px)
            );
        }

        .frame[data-timeline='vertical'] .dock.chip {
            inset-inline-start: calc(var(--hcm-gutter) + 14px);
            inset-block-end: calc(var(--hcm-map-chrome) + var(--hcm-fab-size) + var(--hcm-dock-gap) + env(safe-area-inset-bottom, 0px));
        }

        .dock.consent {
            inset-inline: var(--hcm-top-start, var(--hcm-gutter)) var(--hcm-gutter);
            inset-block-start: var(--hcm-gutter);
            max-inline-size: 480px;
            z-index: 20;
        }

        .dock.toast {
            inset-inline: var(--hcm-top-start, var(--hcm-gutter)) var(--hcm-gutter);
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

        /*
         * The top docks, compare's bar, the skip link and the menu's dock begin 8 px after the standing timeline, 68 px wide
         * (the tour found the toast's dock, then the focused skip link, over the thumb of a vertical timeline).
         */
        .frame[data-timeline='vertical'] {
            --hcm-top-start: calc(var(--hcm-gutter) + 76px);
        }

        @container hcm-viewer (width >= 600px) {
            .dock.timeline-note {
                justify-content: center;
            }
        }

        /*
         * A landscape phone is too short for the whole menu: below the top gutter its items continue in a second
         * column (the tour found items off screen). The menu is docked on the leading edge, so the FAB and the items
         * line up there: aligned to the end, the wider two-column menu pushed the FAB 300 px away from where it was
         * tapped (UX review). Its items end above the chip's row (40 px and 8 more, 56 px with the gap to the card), kept
         * free when no chip shows so the menu does not move: at 568 x 320 the menu needs three columns, which reach the
         * trailing edge (the review found "Distribuie" and "Despre" over the chip).
         */
        .frame[data-compact-height] .dock.menu {
            inset-inline: var(--hcm-gutter) auto;

            --hcm-fab-menu-align: flex-start;
            --hcm-fab-menu-gap: calc(var(--hcm-timeline-block) - var(--hcm-fab-size) + 56px);
            --hcm-fab-menu-max-block-size: calc(100cqb - var(--hcm-map-chrome) - var(--hcm-timeline-block) - 56px - var(--hcm-gutter));
        }

        /*
         * The menu button is on the leading side only, so the lying card takes the trailing column too, and the chip its
         * trailing edge: 50 % - 356 px is where the centred 640 px card ends (the review at 568 x 320: 72 px in, the chip
         * sat on the map's centre point; it now ends at the gutter, with 9 px to spare in Romanian).
         */
        .frame[data-compact-height] .dock.timeline {
            inset-inline-end: var(--hcm-gutter);
        }

        .frame[data-compact-height] .dock.chip {
            inset-inline: auto max(var(--hcm-gutter), 50% - 356px);
        }

        /*
         * On a short window the FAB is on the leading side and the lying card and the chip take the trailing column: the
         * group goes over the FAB there, in the leading column the card leaves free.
         */
        .frame[data-compact-height] .dock.zoom {
            inset-inline: calc(var(--hcm-gutter) + 4px) auto;
        }

        /* Upright, the items begin above the chip's row (the owner's phone: the last item covered the chip's end). */
        .frame[data-timeline='vertical'] .dock.chip ~ .dock.menu {
            --hcm-fab-menu-gap: calc(40px + 2 * var(--hcm-dock-gap));
        }

        /* The open menu grows over the group: the group steps aside until it closes (the tour's overlap check). */
        .dock.menu:has(> [open]) + .dock.zoom {
            visibility: hidden;
        }

        @media (prefers-reduced-motion: reduce) {
            .skeleton .shimmer {
                animation: none;
            }
        }
    `,
];
