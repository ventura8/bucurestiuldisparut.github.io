/**
 * The Imagery area's styles (`docs/research/M3-interfaces.md` §10.2): the editing kit's rows, chips, facts and fields,
 * plus the scenes' thumbnails, the filters, the upload's drop zone, the steps of a job, the approval card and the map's
 * box, which keeps its place above the detail (one map per page visit) and gives way to the text on compact windows.
 */
import { css } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { editingStyles } from '../editing/editing-styles.js';

export const imageryStyles = [
    ...editingStyles,
    visuallyHidden,
    css`
        .imagery-map {
            flex: none;
            block-size: clamp(240px, 45vh, 480px);
        }

        .imagery-map[no-map] {
            block-size: auto;
        }

        .row.scene {
            display: grid;
            grid-template-columns: 64px 1fr;
            align-items: center;
            gap: 12px;
        }

        .thumb {
            display: grid;
            place-items: center;
            inline-size: 64px;
            block-size: 64px;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-surface-container-high, Canvas);
            object-fit: cover;
            color: var(--md-sys-color-on-surface-variant, CanvasText);
        }

        .browse {
            display: block;
            max-inline-size: 100%;
            max-block-size: 360px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            object-fit: contain;
            background: var(--md-sys-color-surface-container-high, Canvas);
        }

        /* Wrapped chip rows 16 px apart, like the kit's .chips: 8 px let a 32 px chip's 48 px target reach the next row's
           (40 px on a phone, CR-M3-35 e). */
        .filters {
            display: flex;
            flex-wrap: wrap;
            gap: 16px 8px;
            align-items: flex-end;
        }

        .scene-card {
            display: flex;
            flex-direction: column;
        }

        /* A card's Import sits under its text, past the thumbnail's column (16 + 64 + 12 px). */
        .card-import {
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding-block: 0 8px;
            padding-inline: 92px 16px;
        }

        .years {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .years .field {
            inline-size: 120px;
        }

        .reasons {
            margin: 0;
            padding-inline-start: 20px;
        }

        .drop {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
            padding: 16px;
            border: 2px dashed var(--md-sys-color-outline, CanvasText);
            border-radius: var(--md-sys-shape-corner-large, 16px);
        }

        .drop[data-over] {
            border-color: var(--md-sys-color-primary, Highlight);
            background: var(--md-sys-color-primary-container, Canvas);
        }

        .card {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            background: var(--md-sys-color-surface-container-low, Canvas);
        }

        .steps {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 0;
            list-style: none;
        }

        .steps li {
            display: flex;
            gap: 8px;
            align-items: center;
        }

        .steps li[data-state='running'] {
            font-weight: var(--md-sys-typescale-title-small-weight, 500);
        }

        .choices {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .slider-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: 8px;
        }

        .slider-row hcm-slider {
            grid-column: 1 / -1;
        }

        .section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        /* The technical detail of an error: the alert's own colour (a note's would lose its contrast there). */
        .alert .detail {
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
            line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
        }

        .section > h3 {
            padding-inline: 16px;
        }
    `,
];
