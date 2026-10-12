/**
 * The Material Symbols Rounded icons the kit bundles. The icon font in `packages/ui/fonts/` is a subset that holds only
 * these ligatures (`npm run fonts:build --workspace @hcm/ui` rebuilds it from this list, `fonts:check` verifies it), so
 * an icon used anywhere in the engine or the admin must be listed here first.
 */
import { POI_ICONS } from '@hcm/shared';

/**
 * Icons of the kit, the viewer and the admin (its navigation, the Setup Assistant's cards: `docs/research/M2b-interfaces.md`
 * §1.6); POI category icons are `POI_ICONS` of `@hcm/shared`.
 */
export const UI_ICONS = [
    'account_circle',
    'add',
    'arrow_back',
    'arrow_forward',
    'brightness_auto',
    'broken_image',
    'bug_report',
    'check',
    'check_circle',
    'checklist',
    'chevron_left',
    'chevron_right',
    'close',
    'cloud',
    'compare',
    'content_copy',
    'content_paste',
    'contrast',
    'credit_card',
    'dark_mode',
    'error',
    'expand_less',
    'expand_more',
    'fullscreen',
    'fullscreen_exit',
    'group',
    'history',
    'image',
    'info',
    'key',
    'language',
    'layers',
    'light_mode',
    'link',
    'logout',
    'map',
    'menu',
    'more_vert',
    'my_location',
    'opacity',
    'open_in_new',
    'pause',
    'pending_actions',
    'photo_library',
    'place',
    'play_arrow',
    'refresh',
    'remove',
    'schedule',
    'search',
    'settings',
    'share',
    'timeline',
    'timer',
    'translate',
    'tune',
    'upload',
    'visibility',
    'visibility_off',
    'warning',
    'zoom_in',
    'zoom_out',
] as const;

/** Every bundled icon, sorted and without duplicates: the kit's own and the POI category icons. */
export const ICONS: readonly string[] = [...new Set<string>([...UI_ICONS, ...POI_ICONS])].toSorted((a, b) => a.localeCompare(b, 'en'));

const BUNDLED = new Set(ICONS);

/** True when `name` is in the bundled subset (anything else would render as plain letters). */
export function isBundledIcon(name: string): boolean {
    return BUNDLED.has(name);
}
