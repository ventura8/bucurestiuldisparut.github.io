/**
 * The Statistics view's own styles (`#/crashes/statistics`, the owner's "prettify" of 2026-11-13), in the crashes chunk:
 * a wider pane than the editors' (1200 px), the page's head, the off note, the cards' surface, the adaptive grid (one
 * column on a phone, two or three on a wide window) and the native disclosures (a 48 px summary: Show all, the full text
 * of an error, the folded help with every wizard's step codes). The live sections' styles come with their chunk
 * (`statistics-live-styles.ts`), so this chunk stays within its 5 KB budget.
 */
import { css } from 'lit';

export const statisticsStyles = css`
    /* The crashes page fills the page area (its list and detail panes scroll): this view scrolls on its own. */
    .statistics {
        block-size: 100%;
        overflow-y: auto;
        gap: 24px;
        max-inline-size: 1200px;
    }

    /* M3's 48 px touch target for the links on their own lines (the tour's target-size check on a compact window). */
    .statistics p > a,
    .statistics a.external,
    a[data-statistics-link] {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        min-block-size: 48px;
    }

    .statistics code {
        font-family: var(--hcm-font-mono, ui-monospace, monospace);
        font-size: 0.8125em;
        color: var(--md-sys-color-on-surface-variant, CanvasText);
        overflow-wrap: anywhere;
    }

    .statistics h4,
    .statistics h5 {
        margin: 0;
        font-size: var(--md-sys-typescale-title-small-size, 0.875rem);
        line-height: var(--md-sys-typescale-title-small-line-height, 1.25rem);
        font-weight: var(--md-sys-typescale-title-small-weight, 500);
    }

    .statistics .page-head,
    .statistics .section-head {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .statistics .info {
        display: flex;
        gap: 12px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-secondary-container, Canvas);
        color: var(--md-sys-color-on-secondary-container, CanvasText);
    }

    .statistics .info a {
        color: inherit;
    }

    /* The adaptive grid: one column on a phone, two or three as the window widens. */
    .statistics .grid,
    .statistics .wizards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-inline-size: 0;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
    }

    /* Show all, the full text of an error and the help: a native disclosure with a 48 px summary. */
    .statistics details > summary {
        display: flex;
        align-items: center;
        gap: 8px;
        min-block-size: 48px;
        border-radius: var(--md-sys-shape-corner-full, 9999px);
        color: var(--md-sys-color-primary, LinkText);
        font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        font-weight: 500;
        cursor: pointer;
        list-style: none;
    }

    .statistics .help > summary {
        color: var(--md-sys-color-on-surface, CanvasText);
        font-size: var(--md-sys-typescale-title-medium-size, 1rem);
        min-block-size: 56px;
    }

    .statistics details > summary::-webkit-details-marker {
        display: none;
    }

    .statistics details > summary::before {
        content: '';
        inline-size: 8px;
        block-size: 8px;
        margin-inline: 4px;
        border-block-end: 2px solid currentcolor;
        border-inline-end: 2px solid currentcolor;
        transform: rotate(45deg);
        transition: transform 150ms;
    }

    .statistics details[open] > summary::before {
        transform: rotate(225deg);
    }

    .statistics details > summary:focus-visible {
        outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
        outline-offset: 2px;
    }

    .statistics .help {
        padding: 0 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
    }

    .statistics .help-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
        padding-block-end: 16px;
    }

    .statistics .help-body ol {
        margin: 0;
        padding-inline-start: 24px;
    }

    .statistics .wizards .card {
        background: var(--md-sys-color-surface-container, Canvas);
    }
`;
