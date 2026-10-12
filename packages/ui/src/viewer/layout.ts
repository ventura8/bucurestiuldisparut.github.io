/**
 * The viewer's adaptive layout per M3 window class (docs/research/material3-research.json → adaptive_layout),
 * measured on the viewer's own box (the store's `windowClass` and `compactHeight`), never on the browser window:
 *
 * - compact: full-bleed map, floating timeline at the bottom, FAB menu; layers, photo and POI details in modal
 *   bottom sheets; About as a full-screen dialog;
 * - compact height (landscape phones, any width): vertical timeline on the trailing edge, modal side sheets;
 * - medium: floating timeline bottom-centre; layers and details in modal side sheets;
 * - expanded and large: one docked supporting pane (standard side sheet, 360 / 412 px) for layers or details;
 * - extra-large: up to three panes, the layers panel always docked on the leading side.
 */
import type { WindowClass } from '../theme/tokens.js';

/** How a sheet is presented: modal bottom sheet, modal side sheet, or a docked standard side sheet (a pane). */
export type SheetMode = 'bottom' | 'side' | 'docked';

export interface ViewerLayout {
    /** The layers, photo, POI and photo-list sheets. */
    readonly sheetMode: SheetMode;
    /** The layers panel is always shown in its own leading pane (it never opens as a sheet). */
    readonly layersDocked: boolean;
    readonly timeline: 'horizontal' | 'vertical';
    readonly aboutFullscreen: boolean;
}

const COMPACT: ViewerLayout = { sheetMode: 'bottom', layersDocked: false, timeline: 'horizontal', aboutFullscreen: true };
const MEDIUM: ViewerLayout = { sheetMode: 'side', layersDocked: false, timeline: 'horizontal', aboutFullscreen: false };
const SUPPORTING_PANE: ViewerLayout = { sheetMode: 'docked', layersDocked: false, timeline: 'horizontal', aboutFullscreen: false };
const THREE_PANES: ViewerLayout = { sheetMode: 'docked', layersDocked: true, timeline: 'horizontal', aboutFullscreen: false };
const COMPACT_HEIGHT: ViewerLayout = { sheetMode: 'side', layersDocked: false, timeline: 'vertical', aboutFullscreen: true };

const BY_CLASS: Readonly<Record<WindowClass, ViewerLayout>> = {
    compact: COMPACT,
    medium: MEDIUM,
    expanded: SUPPORTING_PANE,
    large: SUPPORTING_PANE,
    'extra-large': THREE_PANES,
};

export function layoutFor(windowClass: WindowClass, compactHeight: boolean): ViewerLayout {
    return compactHeight ? COMPACT_HEIGHT : BY_CLASS[windowClass];
}
