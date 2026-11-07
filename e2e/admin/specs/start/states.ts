/**
 * The start page's states of the tour inventory (M14, `docs/research/M14-start-your-map.md` §11; `ADMIN_STATES` of
 * e2e/tour/states.ts spreads them), ids `start.<state>`, each reached by a spec of `specs/start/`.
 */
export const START_STATES = {
    'start.intro': {
        title: 'Start your map: what you get, the cost, the accounts, Google’s consent explained',
        visit: 'specs/start/start.spec.ts',
    },
    'start.closed': {
        title: 'Start your map before its client exists: the explanation and the terminal road, no button',
        visit: 'specs/start/start.spec.ts',
    },
    'start.plan': { title: 'Start your map: the city, its rectangle and the project', visit: 'specs/start/start.spec.ts' },
    'start.plan-invalid': {
        title: 'Start your map: a rectangle too large and an id no project may take, said at their fields',
        visit: 'specs/start/start.spec.ts',
    },
    'start.work-failed': {
        title: 'Start your map: a step refused (Firebase’s terms), the link and Try again',
        visit: 'specs/start/start.spec.ts',
    },
    'start.provider': { title: 'Start your map: the one console click, its link and Check again', visit: 'specs/start/start.spec.ts' },
    'start.done': { title: 'Start your map: the admin is published, the address and what comes next', visit: 'specs/start/start.spec.ts' },
} as const;
