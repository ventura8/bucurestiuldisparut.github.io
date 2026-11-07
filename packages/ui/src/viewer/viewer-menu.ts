/** The FAB menu's items: which actions a viewer offers, and each one's icon and name. */
import { translate, type Locale, type Manifest, type MessageKey } from '@hcm/shared';

import type { FabMenuItem } from '../components/fab-menu.js';
import { otherLocale, type MenuAction } from './viewer-actions.js';

/** What the menu depends on. */
export interface MenuContext {
    readonly webgl: boolean;
    readonly layersDocked: boolean;
    readonly manifest: Manifest;
}

/** The actions the FAB menu offers: no layers when the panel is docked, no map actions without WebGL, no list without photos. */
export function menuActions({ webgl, layersDocked, manifest }: MenuContext): readonly MenuAction[] {
    const candidates: readonly (readonly [MenuAction, boolean])[] = [
        ['layers', webgl && !layersDocked],
        ['photos', manifest.photos.length > 0],
        ['unplaced', (manifest.unplaced ?? []).length > 0],
        ['locate', webgl],
        ['share', true],
        ['contribute', manifest.contributeUrl !== undefined],
        ['language', true],
        ['about', true],
    ];
    return candidates.filter(([, shown]) => shown).map(([action]) => action);
}

const MENU_ENTRIES: Readonly<Record<Exclude<MenuAction, 'language'>, { readonly icon: string; readonly label: MessageKey }>> = {
    layers: { icon: 'layers', label: 'layers.title' },
    photos: { icon: 'photo_library', label: 'photos.list' },
    unplaced: { icon: 'add_location_alt', label: 'unplaced.title' },
    contribute: { icon: 'add_photo_alternate', label: 'contribute.link' },
    locate: { icon: 'my_location', label: 'action.locate' },
    share: { icon: 'share', label: 'action.share' },
    about: { icon: 'info', label: 'about.title' },
};

/** One FAB menu item; the language item is named after the language it switches to (`English`, `Română`). */
export function menuItem(action: MenuAction, locale: Locale): FabMenuItem {
    if (action === 'language') {
        return { value: action, icon: 'translate', label: translate(locale, `language.${otherLocale(locale)}`) };
    }
    const entry = MENU_ENTRIES[action];
    return { value: action, icon: entry.icon, label: translate(locale, entry.label) };
}
