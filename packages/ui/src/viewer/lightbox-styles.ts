/** Styles of `<hcm-lightbox>`: a dark scrim over the whole viewer, the image centred, controls in its corners. */
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
            background: color-mix(in srgb, var(--md-sys-color-scrim, CanvasText) 92%, transparent);
            color: var(--md-sys-color-inverse-on-surface, Canvas);
        }

        header {
            display: flex;
            align-items: center;
            gap: 16px;
            padding-block: 8px;
            padding-inline: 16px 8px;
        }

        .title {
            flex: 1;
            min-inline-size: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .stage {
            position: relative;
            display: grid;
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
        }

        .nav {
            display: flex;
            justify-content: center;
            gap: 24px;
            padding: 8px;
        }
    `,
];
