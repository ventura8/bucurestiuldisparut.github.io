/**
 * The M6 installer's states of the tour inventory (docs/research/M6-interfaces.md §6.3; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them through e2e/tour/admin-sections.ts, section `install`): Install the server (d) ready,
 * at work with its steps and the functions' count, waiting on a retry, stopped with its log, offering an update and
 * newer than the admin; the imagery pipeline (d3) at work, stopped and installing on its own; Publish the map (i) off with its reason, ready and
 * published; Home's tile of an update. Each is reached by e2e/admin/specs/install/states.spec.ts at the admin tier's
 * five projects (three window classes, dark, English).
 */
const VISIT = 'specs/install/states.spec.ts';

export const INSTALL_STATES = {
    'setup.install-ready': { title: 'Setup, Install the server: why, the build minutes and the one button', visit: VISIT },
    'setup.install-working': {
        title: "Setup, the server's installation at work: its steps, the one under way and the functions' count",
        visit: VISIT,
    },
    'setup.install-retrying': { title: 'Setup, the server waiting for Google: what it waits for and when it tries again', visit: VISIT },
    'setup.install-failed': {
        title: 'Setup, the server stopped: the step, the last lines of its log redacted, the console link and Try again',
        visit: VISIT,
    },
    'setup.install-update': {
        title: "Setup, a server older than the admin's release: An update is ready, with Update the map",
        visit: VISIT,
    },
    'setup.install-newer': { title: 'Setup, a server newer than this admin: reload the page, nothing offered', visit: VISIT },
    'setup.pipeline-working': { title: "Setup, the imagery pipeline's installation at work with its steps", visit: VISIT },
    'setup.pipeline-failed': { title: 'Setup, the imagery pipeline stopped: its step, its log and Try again', visit: VISIT },
    'setup.pipeline-install': {
        title: 'Setup, the imagery pipeline missing beside an installed server: its own Install the pipeline',
        visit: VISIT,
    },
    'setup.site-blocked': { title: 'Setup, Publish the map off: nothing published to show yet, and why', visit: VISIT },
    'setup.site-ready': { title: 'Setup, Publish the map: the address, what visitors see, the cost and the button', visit: VISIT },
    'setup.site-published': { title: 'Setup, the map published: the public address as a link and the release', visit: VISIT },
    'home.update-tile': { title: 'Home: an update of the map is ready, with the link to its step in Setup', visit: VISIT },
} as const;
