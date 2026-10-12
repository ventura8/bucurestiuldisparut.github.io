/**
 * The visitor's analytics consent (scenario V19, PLAN Addendum 2): `unknown` until they answer the banner, stored per
 * city under `hcm:<cityId>:consent`, withdrawable in About. Google's Consent Mode v2 starts with everything denied;
 * accepting grants `analytics_storage` only (no advertising storage, no ad personalisation, ever).
 */
import type { Logger } from '@hcm/shared';

import { Listeners } from '../core/listeners.js';
import { Preferences, type PreferenceStorage } from '../core/preferences.js';
import type { Unsubscribe } from '../map/map-port.js';
import type { ConsentState } from './telemetry-port.js';

export type ConsentValue = 'granted' | 'denied';

/** Consent Mode v2 settings (`setConsent` of firebase/analytics): the defaults before any answer. */
export const CONSENT_DENIED = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
} as const;

/** After "Accept": analytics storage only. */
export const CONSENT_GRANTED = { ...CONSENT_DENIED, analytics_storage: 'granted' } as const;

export function parseConsent(value: string | null): ConsentState {
    return value === 'granted' || value === 'denied' ? value : 'unknown';
}

export class ConsentStore {
    readonly #preferences: Preferences;
    readonly #listeners: Listeners<[ConsentState]>;
    #cityId: string | undefined;
    #state: ConsentState;

    constructor(storage: PreferenceStorage, log: Logger, cityId: string | undefined) {
        this.#preferences = new Preferences(storage, log);
        this.#listeners = new Listeners((error) => {
            log.error('consent listener failed', { error: String(error) });
        });
        this.#cityId = cityId;
        this.#state = parseConsent(this.#preferences.get(cityId, 'consent'));
    }

    get state(): ConsentState {
        return this.#state;
    }

    /** The city became known (the manifest loaded): its stored answer applies, or an earlier answer is stored for it. */
    setCity(cityId: string): void {
        if (cityId === this.#cityId) {
            return;
        }
        this.#cityId = cityId;
        const stored = parseConsent(this.#preferences.get(cityId, 'consent'));
        if (stored === 'unknown' && this.#state !== 'unknown') {
            this.#preferences.set(cityId, 'consent', this.#state);
            return;
        }
        this.#change(stored);
    }

    /** The visitor's answer, stored and announced (stored only once the city is known). */
    set(consent: ConsentValue): void {
        this.#preferences.set(this.#cityId, 'consent', consent);
        this.#change(consent);
    }

    onChange(listener: (consent: ConsentState) => void): Unsubscribe {
        return this.#listeners.add(listener);
    }

    #change(next: ConsentState): void {
        if (next !== this.#state) {
            this.#state = next;
            this.#listeners.emit(next);
        }
    }

    destroy(): void {
        this.#listeners.clear();
    }
}
