/**
 * Styles shared by the viewer elements. Colours come only from the M3 `--md-sys-color-*` tokens the city's manifest
 * carries (applied on `<hcm-map-viewer>`, inherited through every shadow root); the fallbacks are CSS system colours,
 * so an element shown before the theme is applied still has readable contrast. Shapes and type use the M3 token
 * names with plain fallbacks.
 */
import { css } from 'lit';

export const baseStyles = css`
    :host {
        font-family: var(--md-ref-typeface-plain, system-ui, sans-serif);
        color: var(--md-sys-color-on-surface, CanvasText);
    }

    /* The kit's ring (focusRing): secondary, or the colour a surface sets in --hcm-focus-ring-color. */
    :focus-visible {
        outline: 3px solid var(--hcm-focus-ring-color, var(--md-sys-color-secondary, Highlight));
        outline-offset: 2px;
    }

    a {
        color: var(--md-sys-color-primary, LinkText);
    }

    h2,
    h3,
    p {
        margin: 0;
    }

    h2 {
        font-size: var(--md-sys-typescale-title-large-size, 1.375rem);
        line-height: 1.3;
        font-weight: 500;
    }

    h3 {
        font-size: var(--md-sys-typescale-title-small-size, 0.875rem);
        font-weight: 500;
        letter-spacing: 0.01em;
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    [hidden] {
        display: none !important;
    }
`;

/** The docked (standard) side sheet: a pane next to the map, with its own heading and close button. */
export const sheetStyles = css`
    .docked {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        box-sizing: border-box;
        background: var(--md-sys-color-surface-container-low, Canvas);
        border-inline-start: 1px solid var(--md-sys-color-outline-variant, GrayText);
    }

    .docked > header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-block: 12px;
        padding-inline: 24px 12px;
    }

    .docked > header > h2 {
        flex: 1;
        min-inline-size: 0;
        overflow-wrap: anywhere;
    }

    .docked > .body {
        flex: 1;
        overflow: hidden auto;
        padding-block: 0 24px;
        padding-inline: 24px;
    }

    .sheet-title {
        overflow-wrap: anywhere;
    }
`;

/** Labelled sections of a detail sheet (links, photos, credits). */
export const detailStyles = css`
    .details {
        display: flex;
        flex-direction: column;
        gap: 12px;
        line-height: 1.5;
    }

    .details section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .details li + li {
        margin-block-start: 4px;
    }

    /* A link of a list is a target of its own: 48 px tall like every touch target (a link inside a sentence is exempt). */
    .details li > a {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    .supporting {
        color: var(--md-sys-color-on-surface-variant, GrayText);
    }

    .note {
        padding: 8px 12px;
        border-radius: var(--md-sys-shape-corner-small, 8px);
        background: var(--md-sys-color-secondary-container, Canvas);
        color: var(--md-sys-color-on-secondary-container, CanvasText);
    }
`;
