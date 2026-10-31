import { CITIES_STATES } from '../admin/specs/cities/states.js';
import { EXPORT_STATES } from '../admin/specs/export/states.js';
import { ORDERS_STATES } from '../admin/specs/imagery/orders-states.js';
import { SUGGESTIONS_STATES } from '../admin/specs/imagery/suggestions-states.js';
import { INSTALL_STATES } from '../admin/specs/install/states.js';
import { NOTIFY_STATES } from '../admin/specs/notify/states.js';
import { SETUP_UX_STATES } from '../admin/specs/shell/setup-ux-states.js';

/**
 * The admin states of the M4 and M5 workstreams in the tour inventory (`ADMIN_STATES` of ./states.ts spreads them; moved
 * here when ./states.ts reached its 600-line limit, docs/research/M5-interfaces.md → Change requests, CR-M5-15). Shared by
 * every workstream: one marked section each; a workstream adds its spread (and its import) inside its own section only.
 */
export const ADMIN_SECTION_STATES = {
    // M4 (docs/research/M4-interfaces.md §7.3): ids 'orders.<state>', 'georef.<state>' (the suggestions), 'notify.<state>'
    // and 'assist.<state>'; each workstream appends inside its own section as each state's journey lands (a spread from a
    // file of its own once a section grows, as the imagery section did).
    // [section orders] owner: orders
    ...ORDERS_STATES,
    // [end orders]
    // [section autogcp] owner: autogcp
    ...SUGGESTIONS_STATES,
    // [end autogcp]
    // [section notify] owner: assists-notify (the inbox, push on a device, the editors' assists)
    ...NOTIFY_STATES,
    // [end notify]
    // M5 (docs/research/M5-interfaces.md §7.3): ids 'cities.<state>' (the switcher, New city, the per-city admins, the city's
    // budget) and 'export.<state>'; each workstream appends inside its own section as each state's journey lands (a spread
    // from a file of its own, as the M4 sections are).
    // [section cities] owner: multi-city
    ...CITIES_STATES,
    // [end cities]
    // [section export] owner: export (Settings → Export the city: docs/research/M5-interfaces.md §5.6)
    ...EXPORT_STATES,
    // [end export]
    // M6 (docs/research/M6-interfaces.md §6.3): one section per workstream (`install`, `site`, `setupUx`), each a spread.
    // [section setupUx] owner: setup-ux (the shell, the sign-in, the billing wait, USGS later, Home's reminders)
    ...SETUP_UX_STATES,
    // [end setupUx]
    // [section install] owner: installer (Install the server, the imagery pipeline, Publish the map, Home's update tile)
    ...INSTALL_STATES,
    // [end install]
} as const;
