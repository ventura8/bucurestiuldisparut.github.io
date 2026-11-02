import type { AdminWorkerKey } from './ro.js';

/**
 * English texts of M7's "Run on my computer": the worker's panel, the city's choice, the free-tier meter and a version's
 * place. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type error.
 */
export const en: Readonly<Record<AdminWorkerKey, string>> = {
    'adminWorker.title': 'Your computer',
    'adminWorker.connected': 'Your computer is connected. Seen: {when}.',
    'adminWorker.none': 'No computer connected.',
    'adminWorker.lastSeen': 'Last seen: {when}.',
    'adminWorker.working': 'Working now on the job:',
    'adminWorker.lastDone': 'Its last job finished: {when}.',
    'adminWorker.lastFailed': 'Its last job failed: {when}.',
    'adminWorker.intro': "With Docker installed, run the command, then open the worker's page and sign in with your Google account.",
    'adminWorker.command': "The worker's command",
    'adminWorker.copy': 'Copy the command',
    'adminWorker.copied': 'Command copied.',
    'adminWorker.copyFailed': 'The browser did not allow copying: select the command and copy it.',
    'adminWorker.open': "Open the worker's page",
    'adminWorker.noteFolder': 'The container writes to ~/hcm-worker: on Linux, create it once with mkdir -m 777 ~/hcm-worker.',
    'adminWorker.noteGcloud': 'If the image will not pull: gcloud auth configure-docker us-central1-docker.pkg.dev, then the command.',
    'adminWorker.noImage': 'Update the imagery pipeline first: the installed one does not name its image.',
    'adminWorker.openSetup': 'Open the imagery pipeline',
    'adminWorker.choice': 'Where new jobs run',
    'adminWorker.choice.auto': 'Run on my computer when it is connected',
    'adminWorker.choice.local': 'Always on my computer',
    'adminWorker.choice.cloud': 'Always in Google Cloud',
    'adminWorker.meter': 'Cloud Run this month (estimate)',
    'adminWorker.meterUse': '{vcpu} of {vcpuFree} vCPU-seconds · {gib} of {gibFree} GiB-seconds',
    'adminWorker.meterShare': 'Of the free tier: {percent}%',
    'adminWorker.place': 'Where it runs',
    'adminWorker.place.local': 'It runs on your computer.',
    'adminWorker.place.cloud': 'It runs in Google Cloud.',
    'adminWorker.place.auto': 'Its place is chosen when it starts.',
    'adminWorker.runLocal': 'Run on my computer',
    'adminWorker.runCloud': 'Run in Google Cloud',
    'adminWorker.runCloudAnyway': 'Run in Google Cloud anyway',
    'adminWorker.waitWorker': 'Waiting for your computer.',
    'adminWorker.startWorker': 'How to start the worker: the Jobs page',
    'adminWorker.freeTier': "In Google Cloud it would pass this month's free tier: it waits for your OK.",
    'adminWorker.estimate': "The run's estimate: {vcpu} vCPU-seconds · {gib} GiB-seconds.",
};
