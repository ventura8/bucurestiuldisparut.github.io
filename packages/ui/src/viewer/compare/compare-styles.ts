/**
 * Styles of `<hcm-compare>` (M4, docs/research/M4-interfaces.md §3.5–§3.7). The host covers the viewer's map pane and lets
 * every pointer through; only the bar and the divider's handle take them. The second map is clipped to the right of the
 * divider and stays inert and transparent to pointers: the viewer's map, under it, takes every gesture and the second map
 * follows its camera, so the visitor drags, zooms and clicks either side alike, and Mapbox's logo and attribution of the
 * viewer's map (z-index 2 in mapbox-gl.css) stay on top of both sides at every divider position (the second map's own are
 * hidden: one logo and one attribution, Mapbox terms). The bar and the handle keep clear of the viewer's floating controls
 * through the custom properties the viewer defines (`--hcm-gutter`, `--hcm-map-chrome`, `--hcm-timeline-inline`,
 * `--hcm-dock-gap`), which reach this shadow root by inheritance; they sit below the viewer's docks (z-index 10 and up).
 */
import { css } from 'lit';

export const compareStyles = css`
    :host {
        /* The handle's 48 px target keeps the gutter at the leading edge and, beside it, at the trailing one. */
        --hcm-compare-start: var(--hcm-gutter, 16px);
        --hcm-compare-end: calc(var(--hcm-gutter, 16px) + 48px);

        position: absolute;
        inset: 0;
        display: block;
        pointer-events: none;
    }

    /* A phone held landscape: the timeline stands on the trailing edge, from the top gutter down to the legal strip. */
    :host([compact-height]) {
        --hcm-compare-end: calc(var(--hcm-gutter, 16px) + var(--hcm-timeline-inline, 112px) + var(--hcm-dock-gap, 8px) + 48px);
    }

    .second {
        position: absolute;
        inset: 0;
        pointer-events: none;
        clip-path: inset(0 0 0 var(--hcm-compare-at, 50%));
    }

    .second .mapboxgl-control-container {
        display: none;
    }

    /* A compact window's toggle: the parked second map keeps its size (a map sized to nothing would warn) but is not seen. */
    :host([mode='toggle']) .second {
        visibility: hidden;
    }

    .line {
        position: absolute;
        z-index: 3;
        inset-block: 0 var(--hcm-map-chrome, 42px);
        inset-inline-start: clamp(0px, calc(var(--hcm-compare-at, 50%) - 2px), calc(100% - 4px));
        inline-size: 4px;
        background: var(--md-sys-color-surface-container-lowest, Canvas);
        box-shadow: 0 0 0 1px var(--md-sys-color-outline, GrayText);
    }

    /*
     * Below the middle of the map: its centre stays the map's (a tap there is a tap on the map), and the handle clears the
     * bottom controls on a phone held landscape (412 px: the handle ends 20 px above the menu button).
     */
    .handle {
        position: absolute;
        z-index: 3;
        inset-block-start: calc(50% + 32px);
        inset-inline-start: clamp(var(--hcm-compare-start), calc(var(--hcm-compare-at, 50%) - 24px), calc(100% - var(--hcm-compare-end)));
        display: grid;
        place-items: center;
        box-sizing: border-box;
        inline-size: 48px;
        block-size: 48px;
        border: 1px solid var(--md-sys-color-outline, GrayText);
        border-radius: var(--md-sys-shape-corner-full, 9999px);
        background: var(--md-sys-color-primary-container, Canvas);
        color: var(--md-sys-color-on-primary-container, CanvasText);
        box-shadow: var(--md-sys-elevation-level3, 0 4px 8px rgb(0 0 0 / 30%));
        cursor: ew-resize;
        pointer-events: auto;
        touch-action: none;
    }

    .bar {
        position: absolute;
        z-index: 4;
        inset-block-start: calc(var(--hcm-gutter, 16px) + env(safe-area-inset-top, 0px));
        inset-inline: var(--hcm-gutter, 16px);
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        box-sizing: border-box;
        inline-size: fit-content;
        max-inline-size: 560px;
        min-block-size: 56px;
        margin-inline: auto;
        padding: 4px 4px 4px 16px;
        border-radius: var(--md-sys-shape-corner-extra-large, 28px);
        background: var(--md-sys-color-surface-container, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        box-shadow: var(--md-sys-elevation-level2, 0 2px 6px rgb(0 0 0 / 30%));
        pointer-events: auto;
    }

    :host([compact-height]) .bar {
        inset-inline-end: calc(var(--hcm-gutter, 16px) + var(--hcm-timeline-inline, 112px) + var(--hcm-dock-gap, 8px));
    }

    /* A compact window: the bar spans the map between the gutters, the toggle on its own row above the chooser. */
    :host([mode='toggle']) .bar {
        inline-size: auto;
        padding-inline-start: 4px;
    }

    :host([mode='toggle']) hcm-segmented-button {
        flex: 1 1 100%;
    }

    .side {
        font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        font-weight: var(--md-sys-typescale-label-large-weight, 500);
        line-height: var(--md-sys-typescale-label-large-line-height, 1.25rem);
        overflow-wrap: anywhere;
    }

    .side hcm-icon {
        vertical-align: middle;
        margin-inline-end: 8px;
    }

    /* The chooser shrinks with the bar (its options' text is the browser's to fit), never past the map's edge. */
    select {
        flex: 1 1 auto;
        min-inline-size: 0;
        min-block-size: 48px;
        max-inline-size: 100%;
        padding-inline: 12px;
        border: 1px solid var(--md-sys-color-outline, GrayText);
        border-radius: var(--md-sys-shape-corner-small, 8px);
        background: var(--md-sys-color-surface-container-highest, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        font: inherit;
        font-size: var(--md-sys-typescale-body-large-size, 1rem);
    }

    .credit {
        flex-basis: 100%;
        margin: 0;
        padding-block-end: 8px;
        padding-inline-end: 16px;
        color: var(--md-sys-color-on-surface-variant, CanvasText);
        font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
        line-height: var(--md-sys-typescale-body-small-line-height, 1rem);
    }

    :host([mode='toggle']) .credit {
        padding-inline-start: 12px;
    }
`;
