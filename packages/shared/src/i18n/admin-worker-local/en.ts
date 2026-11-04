import type { AdminWorkerLocalKey } from './ro.js';

/**
 * English texts of "Use this computer" (finding 72 of 2026-11-02): the starter file, auto-pair, Stop using this computer
 * and the command behind Advanced. Typed against the Romanian source of truth (`ro.ts`): a missing or extra key is a type
 * error.
 */
export const en: Readonly<Record<AdminWorkerLocalKey, string>> = {
    'adminWorkerLocal.intro': 'Run the imagery jobs on this computer, free: one file sets it up once, then it works on its own.',
    'adminWorkerLocal.os': "This computer's system",
    'adminWorkerLocal.os.linux': 'Linux',
    'adminWorkerLocal.os.mac': 'macOS',
    'adminWorkerLocal.os.windows': 'Windows',
    'adminWorkerLocal.use': 'Use this computer',
    'adminWorkerLocal.find': 'Already set up? Look for it',
    'adminWorkerLocal.looking': "Looking for this computer's worker…",
    'adminWorkerLocal.saved': 'Your browser may ask whether to keep the file: choose Keep. It is in Downloads.',
    'adminWorkerLocal.open.linux': 'Then run it once in a terminal (a double-click only opens it as text):',
    'adminWorkerLocal.runCommand': 'The command that runs the file',
    'adminWorkerLocal.copyRun': 'Copy the line',
    'adminWorkerLocal.open.mac': 'Then open it in Downloads (if macOS refuses it: in Terminal, sh ~/Downloads/hcm-worker.command).',
    'adminWorkerLocal.open.windows': 'Then open it in Downloads (if Windows warns: More info, then Run anyway).',
    'adminWorkerLocal.connecting': 'Connecting this computer…',
    'adminWorkerLocal.connected': 'This computer is connected.',
    'adminWorkerLocal.failed': "The map's server does not give the file yet: update the map (Setup, Update the map), then come back.",
    'adminWorkerLocal.stop': 'Stop using this computer',
    'adminWorkerLocal.stopped': 'Run the downloaded file once: it removes the worker from this computer.',
    'adminWorkerLocal.noDocker': 'Docker is not installed?',
    'adminWorkerLocal.getDocker': 'Get Docker',
    'adminWorkerLocal.advanced': 'Advanced: start it with a command',
    'adminWorkerLocal.commandIntro': 'With Docker installed, paste the command into a terminal once: it signs this computer in and runs.',
    'adminWorkerLocal.command': "The worker's command",
    'adminWorkerLocal.copy': 'Copy the command',
    'adminWorkerLocal.copied': 'Command copied.',
    'adminWorkerLocal.copyFailed': 'The browser did not allow copying: select the command and copy it.',
    'adminWorkerLocal.page': "Open the worker's page",
    'adminWorkerLocal.notePair': 'Its code works once, for 10 minutes (this page renews it); it starts again with the computer.',
    'adminWorkerLocal.noteGcloud': 'The image will not pull? gcloud auth configure-docker us-central1-docker.pkg.dev, then the command.',
};
