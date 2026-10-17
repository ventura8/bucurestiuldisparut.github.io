/**
 * Styles of `<hcm-lightbox>`: an opaque scrim over the whole viewer, the image centred, controls in its corners. The scrim
 * is dark in every theme, so nothing is drawn on it in a theme colour: the header and the error message sit on a
 * surface of their own and the arrows are tonal buttons (the e2e tour found the title, the position and the arrows
 * unreadable on the scrim in the dark and the light theme). The scrim is opaque: at 92 % the docked pane, the menu
 * button and the sheet's own copy of the photo showed through around the image (UX review). The stage's one track is
 * `minmax(0, 1fr)`, so the image's `max-block-size: 100%` resolves against the stage: with an `auto` track a landscape
 * photo on a short window (a landscape phone) overflowed the stage and was cropped instead of fitted. The title wraps
 * instead of ending in an ellipsis: with wider text spacing (WCAG 1.4.12) a phone cut it (the tour). The header is a
 * plain box, not a `header`, which would be a second page banner beside the page's own.
 */
import { css } from 'lit';

import { baseStyles } from './shared-styles.js';

export const lightboxStyles = [
    baseStyles,
    css`
        :host {
            display: none;
        }

        :host([open]) {
            position: absolute;
            inset: 0;
            z-index: 30;
            display: block;
        }

        .lightbox {
            display: grid;
            grid-template-rows: auto 1fr auto;
            block-size: 100%;
            background: var(--md-sys-color-scrim, CanvasText);
            color: var(--md-sys-color-inverse-on-surface, Canvas);
        }

        .header {
            display: flex;
            align-items: center;
            gap: 16px;
            padding-block: 8px;
            padding-inline: 16px 8px;
            background: var(--md-sys-color-surface-container, Canvas);
            color: var(--md-sys-color-on-surface, CanvasText);
        }

        .title {
            flex: 1;
            min-inline-size: 0;
            overflow-wrap: anywhere;
        }

        .stage {
            position: relative;
            display: grid;
            grid-template: minmax(0, 1fr) / minmax(0, 1fr);
            place-items: center;
            overflow: hidden;
            touch-action: none;
            cursor: zoom-in;
        }

        img {
            max-inline-size: 100%;
            max-block-size: 100%;
            inline-size: auto;
            block-size: auto;
            transform-origin: center;
            user-select: none;
        }

        .error {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 16px 24px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            background: var(--md-sys-color-surface-container, Canvas);
            color: var(--md-sys-color-on-surface, CanvasText);
        }

        .nav {
            display: flex;
            justify-content: center;
            gap: 24px;
            padding: 8px;
        }
    `,
];
