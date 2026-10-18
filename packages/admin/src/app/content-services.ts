/**
 * The editors' services as `mount` builds them (`docs/research/M2c-interfaces.md` §2.2): the entry's `ContentDeps`
 * (Firestore, the theme function, the areas' own services, the city) joined with the shell's (the guarded callables,
 * the clock, `localStorage`, the logger, who is signed in, the language, the snackbar, the revocation check, the theme
 * preview the whole admin wears). A revoked admin's writes are refused before they reach Firestore (`../content/revoked.ts`).
 */
import type { Logger } from '@hcm/shared';

import type { ContentDeps } from '../content/registry.js';
import { writesRefusedWhen } from '../content/revoked.js';
import type { ContentServices } from '../content/services.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { ShellStateAccess } from '../state/state.js';
import type { Clock, KeyValueStore } from './ports.js';

export interface ContentShell {
    readonly content: ContentDeps;
    /** `infra/project.json`'s cities: the first is edited unless the `e2e` build names another. */
    readonly cities: readonly string[];
    readonly callables: CallablesPort;
    readonly clock: Clock;
    readonly local: KeyValueStore;
    readonly log: Logger;
    readonly shell: ShellStateAccess;
    /** A refused read or write: the shell asks `admin.session` again. */
    readonly denied: () => void;
}

/** An admin's name as the lists show it: the Google display name, else the address; none without either. */
function nameOf(admin: { readonly displayName?: string | undefined; readonly email?: string | undefined }): string {
    return admin.displayName ?? admin.email ?? '';
}

/**
 * Asks `admins.list` once (again after a failure) and gives the shell every admin's name by uid. The names are shown
 * as text only (who saved a conflicting change); they leave with the session.
 */
function peopleOf(parts: ContentShell): () => void {
    let asked: Promise<void> | null = null;
    const ask = async (): Promise<void> => {
        try {
            const { admins } = await parts.callables.call('admins.list', {});
            const named = admins.map((admin) => [admin.uid, nameOf(admin)] as const).filter(([, name]) => name !== '');
            parts.shell.update({ people: Object.fromEntries(named) });
        } catch (error) {
            asked = null;
            parts.log.warn('admins could not be listed for their names', { error: String(error) });
        }
    };
    return () => {
        asked ??= ask();
    };
}

export function contentServices(parts: ContentShell): ContentServices {
    const { content, shell } = parts;
    return {
        ...content.areas,
        cityId: content.cityId ?? parts.cities[0] ?? '',
        store: writesRefusedWhen(content.store, () => shell.get().revoked),
        ...{ theme: content.theme, callables: parts.callables },
        ...{ clock: parts.clock, local: parts.local, log: parts.log, denied: parts.denied },
        user: () => {
            const user = shell.get().user;
            return user === null ? null : { uid: user.uid, name: user.displayName ?? user.email };
        },
        locale: () => shell.get().locale,
        people: peopleOf(parts),
        readOnly: () => shell.get().revoked,
        notify: (notice) => {
            shell.update({ notice: shell.notice(notice) });
        },
        previewTheme: (preview) => {
            shell.update({ theme: { ...shell.get().theme, preview } });
        },
    };
}
