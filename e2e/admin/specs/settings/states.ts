/**
 * The starter categories' states of the tour inventory (the live manual test of 2026-11-01, finding 41; `ADMIN_STATES`
 * of e2e/tour/states.ts spreads them through e2e/tour/admin-sections.ts, since states.ts is at its line limit), ids
 * `settings.<state>`: Settings → Place categories after **Add the starter categories** added the missing ones, and with
 * every starter already there, the action off with its reason. Both are reached by e2e/tour/admin-settings.tour.ts.
 */
export const SETTINGS_STARTER_STATES = {
    'settings.categories-starters-added': {
        title: 'Settings: the missing starter categories added, the snackbar says how many',
        visit: 'tour/admin-settings.tour.ts',
    },
    'settings.categories-starters-present': {
        title: 'Settings: every starter category there, Add the starter categories off with the reason',
        visit: 'tour/admin-settings.tour.ts',
    },
} as const;
