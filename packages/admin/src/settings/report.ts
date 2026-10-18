/**
 * What the snackbar says after a settings write (`docs/research/M2c-interfaces.md` §1.6): saved (the public map follows
 * within about a minute), or why it was refused; a refusal for access also makes the shell ask who this is again.
 */
import type { AdminContentKey } from '@hcm/shared';

import type { ContentServices, WriteOutcome } from '../content/services.js';

type WriteFailure = Extract<WriteOutcome, { readonly ok: false }>['reason'];

const REFUSED: Readonly<Record<WriteFailure, AdminContentKey>> = {
    conflict: 'adminContent.settings.refused.conflict',
    gone: 'adminContent.settings.refused.gone',
    denied: 'adminContent.settings.refused.denied',
    offline: 'adminContent.settings.refused.offline',
    invalid: 'adminContent.settings.refused.invalid',
};

function refused(services: Pick<ContentServices, 'notify' | 'denied'>, reason: WriteFailure): void {
    if (reason === 'denied') {
        services.denied();
    }
    services.notify({ key: REFUSED[reason] });
}

/** Tells the outcome of a write (nothing for none: nothing was written). */
export function reportOutcome(
    services: Pick<ContentServices, 'notify' | 'denied'>,
    outcome: WriteOutcome | null,
    saved: AdminContentKey = 'adminContent.settings.saved',
): void {
    if (outcome === null) {
        return;
    }
    if (outcome.ok) {
        services.notify({ key: saved });
        return;
    }
    refused(services, outcome.reason);
}
