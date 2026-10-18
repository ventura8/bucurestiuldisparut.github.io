/**
 * The Link dialog's state (behaviour A15, CR-M2c-27): the form as typed, what `linkCheck` finds (shown at the fields
 * once the admin has tried to send, the policy refusal at once), the origins a tile server needs in the public site's
 * CSP, and the call. The city's Mapbox account (`cities/{city}.mapbox.user`) is read while the dialog is open: a tileset
 * of any other account is refused before `layers.link` is called, which refuses it again.
 */
import { cityDocSchema, FIRESTORE_PATHS, type CityDoc, type ValidationIssue } from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentServices, Stored } from '../content/services.js';
import { codeOf } from './deletion.js';
import { EMPTY_LINK_FORM, linkCheck, type LinkForm, type LinkRefusal } from './link.js';

export interface LinkState {
    readonly form: LinkForm;
    /** Problems at the fields (`address`, `label.ro`, `year`, ...), shown once the admin pressed Link. */
    readonly issues: readonly ValidationIssue[];
    /** A source the server would refuse (another account's tileset, a credential in the address). */
    readonly refusal: LinkRefusal | null;
    /** The origins of a tile server: the public site's CSP must allow them (a site rebuild). */
    readonly origins: readonly string[];
    /** The admin pressed Link once: issues are shown from then on. */
    readonly tried: boolean;
    readonly sending: boolean;
}

export class LayerLinker {
    readonly #services: ContentServices;
    readonly #changed: (state: LinkState | null) => void;
    #state: LinkState | null = null;
    #mapboxUser: string | null = null;
    #stop: Unsubscribe | null = null;

    constructor(services: ContentServices, changed: (state: LinkState | null) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    open(): void {
        if (this.#state !== null) {
            return;
        }
        const { store, cityId } = this.#services;
        this.#stop = store.watchDoc(
            FIRESTORE_PATHS.city(cityId),
            cityDocSchema,
            (city) => {
                this.#cityChanged(city);
            },
            () => undefined,
        );
        this.#update(EMPTY_LINK_FORM, false);
    }

    edit(patch: Partial<LinkForm>): void {
        if (this.#state !== null) {
            this.#update({ ...this.#state.form, ...patch }, this.#state.tried);
        }
    }

    close(): void {
        this.#stop?.();
        this.#stop = null;
        this.#set(null);
    }

    /** Sends the form when it passes every check; the new layer's id, or null. */
    async submit(): Promise<string | null> {
        const state = this.#state;
        if (state === null || state.sending) {
            return null;
        }
        const check = linkCheck(this.#services.cityId, state.form, this.#mapboxUser);
        if (!check.ok) {
            this.#update(state.form, true);
            return null;
        }
        this.#set({ ...state, tried: true, sending: true });
        try {
            const { layerId } = await this.#services.callables.call('layers.link', check.request);
            this.#services.notify({ key: 'adminContent.layers.linked', params: { name: check.request.label.ro } });
            this.close();
            return layerId;
        } catch (error) {
            this.#refused(codeOf(error));
            return null;
        }
    }

    #refused(code: ReturnType<typeof codeOf>): void {
        const state = this.#state;
        if (state !== null) {
            this.#set({ ...state, sending: false, refusal: { code } });
        }
    }

    #cityChanged(city: Stored<CityDoc> | null): void {
        this.#mapboxUser = city?.data.mapbox?.user ?? null;
        if (this.#state !== null) {
            this.#update(this.#state.form, this.#state.tried);
        }
    }

    #update(form: LinkForm, tried: boolean): void {
        const check = linkCheck(this.#services.cityId, form, this.#mapboxUser);
        this.#set({
            form,
            tried,
            sending: false,
            issues: check.ok || !tried ? [] : check.issues,
            refusal: check.ok ? null : check.refusal,
            origins: check.ok ? check.origins : [],
        });
    }

    #set(state: LinkState | null): void {
        this.#state = state;
        this.#changed(state);
    }
}
