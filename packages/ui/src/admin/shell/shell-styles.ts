/**
 * The styles of `<hcm-admin-shell>` (`docs/research/M2b-interfaces.md` §1.2): the frame is a grid as tall as the window
 * whose navigation sits at the bottom (the compact bar) or on the leading edge (the rails); the top app bar holds the
 * page title and the account button. Only the page in `<main>` scrolls (an app shell): the bars and the rail keep their
 * own rows and the snackbar its own place below the page, so no content ever scrolls under them, where a focused
 * control would be hidden (WCAG 2.4.11) and a target half covered (the user's report of 2026-10-12 and
 * `docs/research/layout-a11y-findings.md`). On the screens without the frame (sign-in, claim, blocked) the page itself
 * scrolls and the snackbar floats at the bottom of the window.
 */
import { css } from 'lit';

import { adminBase } from './admin-styles.js';

export const shellStyles = [
    adminBase,
    css`
        :host {
            display: block;
            position: relative;
            min-block-size: 100dvh;
            background: var(--md-sys-color-surface, Canvas);
            color: var(--md-sys-color-on-surface, CanvasText);
        }

        /* The frame is the positioned container of the navigation's More sheet, which covers it. */
        .frame {
            display: grid;
            position: relative;
            block-size: 100dvh;
        }

        .frame[data-nav='bar'] {
            grid-template-rows: minmax(0, 1fr) auto;
        }

        .frame[data-nav='rail'],
        .frame[data-nav='expanded'] {
            grid-template-columns: auto minmax(0, 1fr);
        }

        .frame hcm-admin-nav {
            min-block-size: 0;
        }

        .column {
            display: flex;
            flex-direction: column;
            min-inline-size: 0;
            min-block-size: 0;
        }

        .top-bar {
            flex: none;
            display: flex;
            align-items: center;
            gap: 8px;
            min-block-size: 64px;
            padding-block-start: env(safe-area-inset-top);
            padding-inline: 16px max(4px, env(safe-area-inset-right));
            background: var(--md-sys-color-surface, Canvas);
        }

        .top-bar h1 {
            flex: 1 1 auto;
            min-inline-size: 0;
            font-size: var(--md-sys-typescale-title-large-size, 1.375rem);
            font-weight: var(--md-sys-typescale-title-large-weight, 400);
            line-height: var(--md-sys-typescale-title-large-line-height, 1.75rem);
            overflow-wrap: anywhere;
        }

        .banner {
            margin: 8px 16px 0;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-tertiary-container, Canvas);
            color: var(--md-sys-color-on-tertiary-container, CanvasText);
        }

        .content {
            display: flex;
            flex: 1 1 auto;
            flex-direction: column;
            min-inline-size: 0;
            min-block-size: 0;
        }

        /* The one scrolling region: the page, with the start-up banner above it. */
        .scroller {
            flex: 1 1 auto;
            min-block-size: 0;
            overflow-y: auto;
        }

        .loading {
            display: grid;
            place-content: center;
            justify-items: center;
            gap: 16px;
            min-block-size: 100dvh;
            padding: 24px;
            text-align: center;
        }

        hcm-consent-banner {
            flex: none;
            margin: 8px;
        }

        /*
         * The kit's snackbar centres itself at the bottom of its positioned container. In the frame it is docked below
         * the page instead (it takes no room while nothing shows), so it never covers a control of the page; on the
         * other screens it floats at the bottom of the window.
         */
        .content hcm-snackbar {
            position: static;
            flex: none;
        }

        .content hcm-snackbar::part(snackbar) {
            margin-block: 8px;
        }

        .screen hcm-snackbar {
            position: fixed;
            bottom: 16px;
        }
    `,
];
