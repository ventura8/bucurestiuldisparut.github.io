/**
 * The styles of `<hcm-admin-shell>` (`docs/research/M2b-interfaces.md` §1.2): the frame is a grid whose navigation sits
 * at the bottom (the compact bar) or on the leading edge (the rails); the top app bar holds the page title and the
 * account button; the snackbar floats above the bar.
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

        .frame {
            display: grid;
            position: relative;
            min-block-size: 100dvh;
        }

        .frame[data-nav='bar'] {
            grid-template-rows: 1fr auto;
        }

        .frame[data-nav='rail'],
        .frame[data-nav='expanded'] {
            grid-template-columns: auto minmax(0, 1fr);
        }

        .frame[data-nav='bar'] hcm-admin-nav {
            position: sticky;
            inset-block-end: 0;
            z-index: 2;
        }

        .frame[data-nav='rail'] hcm-admin-nav,
        .frame[data-nav='expanded'] hcm-admin-nav {
            position: sticky;
            inset-block-start: 0;
            block-size: 100dvh;
        }

        .column {
            display: flex;
            flex-direction: column;
            min-inline-size: 0;
        }

        .top-bar {
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
            margin: 0 16px 8px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-tertiary-container, Canvas);
            color: var(--md-sys-color-on-tertiary-container, CanvasText);
        }

        .content {
            flex: 1 1 auto;
            min-inline-size: 0;
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
            position: sticky;
            inset-block-end: 0;
            z-index: 1;
            margin: 8px;
        }

        /* The kit's snackbar centres itself at the bottom of its container; here it floats over the window. */
        hcm-snackbar {
            position: fixed;
            bottom: 16px;
        }

        .frame[data-nav='bar'] hcm-snackbar {
            bottom: 96px;
        }
    `,
];
