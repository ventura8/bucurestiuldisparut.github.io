/**
 * M7's states of the tour inventory (docs/research/M7-local-worker.md §7; `ADMIN_SECTION_STATES` of
 * e2e/tour/admin-sections.ts spreads them): the local worker's panel on the Jobs page and the pipeline card, and a
 * version's place, ids `worker.<state>`, each reached by specs/imagery/worker.spec.ts at the admin tier's five projects
 * (behind the tier's lock: the image's digest is in the singleton `setup/status`).
 */
export const WORKER_STATES = {
    'worker.panel-connected': {
        title: 'Jobs: your computer connected, its last job, the docker command with Copy, the choice and the free-tier meter',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.panel-none': {
        title: 'Jobs: no computer connected (last seen ten minutes ago), the command',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.panel-no-image': {
        title: 'Jobs: a pipeline installed before its image was recorded: update the imagery pipeline, no command',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.setup-panel': {
        title: "Setup, the imagery pipeline: the worker's panel and this month's Cloud Run use",
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.place-free-tier': {
        title: 'Historical imagery: a version waiting for your OK past the free tier, the estimate and the month',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.place-worker': {
        title: 'Historical imagery: a version waiting for your computer, the Jobs link and Run in Google Cloud',
        visit: 'specs/imagery/worker.spec.ts',
    },
} as const;
