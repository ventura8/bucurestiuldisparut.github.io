/**
 * The frame every viewer sheet shares: a modal `<hcm-sheet>` (bottom on compact, side on medium and compact height),
 * or a docked standard side sheet in its own pane (expanded and wider) with a heading and a close button. The modal
 * sheet fires its own `hcm-close`; the docked one calls `onClose`.
 */
import { html, type TemplateResult } from 'lit';

import { EMPTY } from './empty.js';
import type { SheetMode } from './layout.js';

export interface SheetFrameOptions {
    readonly mode: SheetMode;
    readonly open: boolean;
    /** The sheet's heading and accessible name. */
    readonly label: string;
    readonly closeLabel: string;
    /** The accessible name of the bottom sheet's drag handle (`sheet.resize`). */
    readonly handleLabel: string;
    readonly onClose: () => void;
    /** False for a pane that is always there (the extra-large layers panel): no close button. */
    readonly closable?: boolean;
}

export function renderSheetFrame(options: SheetFrameOptions, content: unknown): TemplateResult {
    const { mode, open, label, closeLabel, handleLabel, onClose, closable = true } = options;
    if (mode !== 'docked') {
        return html`<hcm-sheet modal .open=${open} .label=${label} .variant=${mode} .closeLabel=${closeLabel} .handleLabel=${handleLabel}>
            <h2 slot="header" class="sheet-title">${label}</h2>
            ${content}
        </hcm-sheet>`;
    }
    if (!open) {
        return EMPTY;
    }
    return html`<section class="docked" aria-label=${label}>
        <header>
            <h2 class="sheet-title">${label}</h2>
            ${closable ? html`<hcm-icon-button icon="close" .label=${closeLabel} @click=${onClose}></hcm-icon-button>` : EMPTY}
        </header>
        <div class="body">${content}</div>
    </section>`;
}

/** Dispatches the viewer-internal `hcm-close` of a docked sheet (it stays inside `<hcm-map-viewer>`). */
export function closeEvent(): CustomEvent<null> {
    return new CustomEvent('hcm-close', { bubbles: true, composed: false, detail: null });
}
