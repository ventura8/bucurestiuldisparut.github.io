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
    // Findings 66-68 of 2026-11-02.
    'worker.panel-progress': {
        title: "Jobs: your computer at work, its job's step and progress live, Disconnect this computer",
        visit: 'specs/imagery/worker.spec.ts',
    },
    // M10 (docs/research/M10-local-ai.md): the local AI on the computer.
    'worker.panel-ai-gpu': {
        title: 'Jobs: your computer connected, its local AI on the graphics card it names',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.panel-ai-unavailable': {
        title: 'Jobs: your computer connected, its local AI unavailable, and why',
        visit: 'specs/imagery/worker.spec.ts',
    },
    // M18 item 9 (docs/research/M18-improvements.md): an old starter file, the one action and what it unlocks.
    'worker.panel-ai-old-starter': {
        title: 'Jobs: your computer connected with an old starter file: Use this computer once to turn its local AI on',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.panel-outdated': {
        title: 'Jobs: your computer runs an older imagery pipeline: run the command again to update it',
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.place-overdue': {
        title: 'Historical imagery: a version no computer came for in 15 minutes, Run in Google Cloud instead first',
        visit: 'specs/imagery/worker.spec.ts',
    },
    // Finding 72 of 2026-11-02 ("I should not have to copy and paste").
    // Finding 73 of 2026-11-03: the file is a download the server answers; then where it is and how to run it.
    'worker.local-downloaded': {
        title: 'Jobs: Use this computer downloaded the starter file: keep it, it is in Downloads, the Linux line to run it with Copy',
        visit: 'specs/imagery/worker.spec.ts',
    },
    // Finding 75 of 2026-11-03: a computer set up another way is looked for, with no file.
    'worker.local-looking': {
        title: "Jobs: Already set up? Look for it: looking for the computer's worker, nothing downloaded",
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.local-advanced': {
        title: "Jobs: the map's server gives no starter file yet: update the map; Advanced open, the command with its code and Copy",
        visit: 'specs/imagery/worker.spec.ts',
    },
    'worker.local-connected': {
        title: 'Jobs: the admin paired this computer by itself, This computer is connected, no code on screen',
        visit: 'specs/imagery/worker-run.spec.ts',
    },
    // M26 (docs/research/M26-governor.md §6): the connected computer's card, Quiet chosen.
    'worker.local-machine': {
        title: 'Jobs: This computer: its cores and memory, Automatic / Quiet / Full with Quiet chosen, the profile in force and why, where the local AI runs',
        visit: 'specs/imagery/worker-run.spec.ts',
    },
    'worker.place-worker': {
        title: 'Historical imagery: a version waiting for your computer, the Jobs link and Run in Google Cloud',
        visit: 'specs/imagery/worker.spec.ts',
    },
} as const;
