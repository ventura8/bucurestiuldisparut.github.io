/**
 * Settings → Browser tab icon (`docs/research/M2-interfaces.md` → *The city's tab icon*; S-A101-*): an editor uploads
 * a PNG or a WebP as the public map's tab icon, or goes back to the default (the Layers panel's map glyph in the city's
 * colour), through `cities.setIcon`. The card reads the city's `icon` record from the city document Settings follows.
 * The card tells what the browser can before sending (the type, from the file's first bytes, and the size: `refuseIcon`);
 * the server checks everything again, the shape included, and its refusal shows beside the card. Nothing changes on a refusal.
 */
import type { CallableRequest } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';

export interface IconSectionState {
    /** An upload or a reset is on its way. */
    readonly busy: boolean;
    /** Why the icon did not change (the browser's check, or the server's refusal). */
    readonly error: NoticeInput | null;
}

export const NO_ICON_SECTION: IconSectionState = { busy: false, error: null };

export interface IconIntents {
    /** Sends the chosen file (the card's base64 of it, once the browser found it a PNG or WebP within 1 MB); true once it is the city's icon. */
    uploadIcon(image: string): Promise<boolean>;
    /** **Use the default icon**; true once it is drawn. */
    resetIcon(): Promise<boolean>;
    /** The browser refused the chosen file (`packages/ui/src/admin/settings/icon-upload.ts`): its reason shows, nothing is sent. */
    refuseIcon(problem: NoticeInput): void;
}

export class IconSection {
    readonly #services: ContentServices;
    readonly #changed: (state: IconSectionState) => void;
    #state: IconSectionState = NO_ICON_SECTION;
    readonly intents: IconIntents;

    constructor(services: ContentServices, changed: (state: IconSectionState) => void) {
        this.#services = services;
        this.#changed = changed;
        this.intents = {
            uploadIcon: (image) => this.#send({ kind: 'upload', cityId: this.#services.cityId, image }),
            resetIcon: () => this.#send({ kind: 'reset', cityId: this.#services.cityId }),
            refuseIcon: (problem) => {
                this.#set({ busy: false, error: problem });
            },
        };
    }

    get state(): IconSectionState {
        return this.#state;
    }

    /** Leaving the section forgets a refusal. */
    close(): void {
        this.#set(NO_ICON_SECTION);
    }

    #set(state: IconSectionState): void {
        this.#state = state;
        this.#changed(state);
    }

    async #send(request: CallableRequest<'cities.setIcon'>): Promise<boolean> {
        this.#set({ busy: true, error: null });
        const outcome = await outcomeOf(() => this.#services.callables.call('cities.setIcon', request));
        this.#set({ busy: false, error: outcome.ok ? null : outcome.error });
        if (outcome.ok) {
            this.#services.notify({ key: 'adminContent.settings.icon.saved' });
        }
        return outcome.ok;
    }
}
