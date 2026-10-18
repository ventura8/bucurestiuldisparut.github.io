/**
 * The editors' services as `mount` builds them (`docs/research/M2c-interfaces.md` §2.2): the entry's `ContentDeps`
 * (Firestore, the theme function, the areas' own services, the city) joined with the shell's (the guarded callables,
 * the clock, `localStorage`, the logger, who is signed in, the language, the snackbar, the revocation check).
 */
import type { Logger } from '@hcm/shared';

import type { ContentDeps } from '../content/registry.js';
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

export function contentServices(parts: ContentShell): ContentServices {
    const { content, shell } = parts;
    return {
        ...content.areas,
        cityId: content.cityId ?? parts.cities[0] ?? '',
        ...{ store: content.store, theme: content.theme, callables: parts.callables },
        ...{ clock: parts.clock, local: parts.local, log: parts.log, denied: parts.denied },
        user: () => {
            const user = shell.get().user;
            return user === null ? null : { uid: user.uid, name: user.displayName ?? user.email };
        },
        locale: () => shell.get().locale,
        notify: (notice) => {
            shell.update({ notice: shell.notice(notice) });
        },
    };
}
