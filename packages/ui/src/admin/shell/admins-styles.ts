/** The styles of `<hcm-admins-page>`: one column of sections, rows with the name, role chips and the remove button. */
import { css } from 'lit';

import { adminBase, panelStyles } from './admin-styles.js';

export const adminsPageStyles = [
    adminBase,
    panelStyles,
    css`
        .page {
            display: flex;
            flex-direction: column;
            gap: 16px;
            max-inline-size: 840px;
            margin-inline: auto;
        }

        h2 {
            font-size: var(--md-sys-typescale-title-medium-size, 1rem);
            font-weight: var(--md-sys-typescale-title-medium-weight, 500);
        }

        .status:empty {
            display: none;
        }

        .invite,
        .invited {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        input {
            flex: 1 1 240px;
            min-inline-size: 0;
            min-block-size: 48px;
            box-sizing: border-box;
            padding-inline: 16px;
            border: 1px solid var(--md-sys-color-outline, CanvasText);
            border-radius: var(--md-sys-shape-corner-extra-small, 4px);
            background: transparent;
            color: inherit;
            font: inherit;
        }

        input:focus-visible {
            outline-offset: 0;
        }

        .rows {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .admin-row {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px 16px;
            min-block-size: 56px;
            padding-inline: 16px 4px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-surface-container-low, Canvas);
        }

        .who {
            display: flex;
            flex: 1 1 200px;
            flex-direction: column;
            min-inline-size: 0;
        }

        .detail,
        .empty {
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
        }

        .chips {
            display: flex;
            gap: 8px;
        }

        .chip {
            padding: 4px 12px;
            border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-small, 8px);
            font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        }
    `,
];
