/**
 * What the shell watches while an admin is signed in (`docs/research/M2b-interfaces.md` §1.7): the city's theme, whether
 * Setup is complete (`setup-readiness.ts`) and, since M4, the admin's unread notifications for the Notifications item's
 * badge (`../inbox/badge.ts`). Each follows the shell's state and stops with the app.
 */
import type { ContentStore } from '../content/services.js';
import type { DocumentsPort } from '../firebase/ports.js';
import { InboxBadge } from '../inbox/badge.js';
import type { ShellState, ShellStateAccess } from '../state/state.js';
import { CityTheme } from './city-theme.js';
import type { KeyValueStore } from './ports.js';
import { SetupReadiness } from './setup-readiness.js';

export interface ShellWatchSources {
    readonly firebase: { readonly documents: DocumentsPort };
    readonly project: { readonly cities: readonly string[] };
    readonly config: { readonly projectId: string };
    readonly local: KeyValueStore;
    /** The `e2e` build's own city (`ContentDeps.cityId`), else null. */
    readonly content?: { readonly cityId: string | null } | undefined;
    /** The editors' Firestore, for the badge's query; null without the editors. */
    readonly store: ContentStore | null;
}

export interface ShellWatches {
    stateChanged(state: ShellState): void;
    stop(): void;
}

export function shellWatches(sources: ShellWatchSources, shell: ShellStateAccess, denied: () => void): ShellWatches {
    const documents = sources.firebase.documents;
    // The city the editors edit: the `e2e` build's own city when the address names one (CR-M2c-7), so the shell wears its theme.
    const ownCity = sources.content?.cityId ?? null;
    const cityId = ownCity ?? sources.project.cities[0] ?? null;
    // M5: the shell's current city once the session chose it (`./current-city.ts`); the fallback before.
    const cityTheme = new CityTheme({ documents, shell, cityId, denied });
    const readiness = new SetupReadiness({
        ...{ documents, shell, local: sources.local, projectId: sources.config.projectId, denied },
        watch: ownCity === null,
    });
    const badge = new InboxBadge({ store: sources.store, shell, denied });
    return {
        stateChanged: (state) => {
            readiness.stateChanged(state);
            cityTheme.stateChanged(state);
            badge.stateChanged(state);
        },
        stop: () => {
            cityTheme.stop();
            readiness.stop();
            badge.stop();
        },
    };
}
