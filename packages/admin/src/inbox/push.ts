/**
 * Push on this browser (`docs/research/M4-interfaces.md` §5.4; S-A47-HAPPY, S-A47-BAD-PERMISSION-DENIED): off until the
 * admin turns **Notifications on this device** on; only then is the browser's own permission prompt shown. Refused, the
 * inbox keeps working and the page says so; granted, the browser's FCM token is registered with `notify.registerDevice`
 * (the server checks it with FCM first) and the device id is remembered in `localStorage` for this admin
 * (`push-device.ts`), so their next visit shows push as on and another admin's shows it off. Turning it off unregisters
 * this browser only; when the server cannot be reached, push stays on and the snackbar says why (nothing is forgotten that
 * the server still pushes to). The FCM SDK and the service worker are behind `PushRegistrar` (`../firebase/messaging.ts`;
 * the `e2e` build's stand-in hands out a fixed token, since no browser test reaches FCM).
 */
import { pluralOf, type Locale } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { KeyValueStore } from '../app/ports.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { NoticeInput } from '../state/state.js';
import { forgetPushDevice, pushDeviceOf, rememberPushDevice } from './push-device.js';

export type PushPermission = 'default' | 'granted' | 'denied';

/** This browser's push: the Notifications API's permission and the FCM token of its service worker. */
export interface PushRegistrar {
    /** False without the Notifications, service worker or Push API (an old browser, an insecure page). */
    supported(): boolean;
    permission(): PushPermission;
    /** The browser's own prompt: called only from the admin's click. */
    requestPermission(): Promise<PushPermission>;
    /** This browser's FCM registration token (its service worker registered first). */
    token(): Promise<string>;
}

type PushDevice = 'unsupported' | 'off' | 'working' | 'on' | 'denied' | 'failed';

export interface PushState {
    readonly device: PushDevice;
    readonly failure: NoticeInput | null;
    readonly testing: boolean;
}

export interface PushDeps {
    readonly registrar: PushRegistrar | null;
    readonly callables: CallablesPort;
    readonly local: KeyValueStore;
    /** The signed-in admin: the browser's registration is theirs or not. */
    readonly uid: () => string;
    readonly locale: () => Locale;
    readonly notify: (notice: NoticeInput) => void;
    readonly changed: (state: PushState) => void;
}

/** What this browser shows before anything is clicked. */
function initialPush(registrar: PushRegistrar | null, local: KeyValueStore, uid: string): PushState {
    return { device: deviceOf(registrar, local, uid), failure: null, testing: false };
}

function deviceOf(registrar: PushRegistrar | null, local: KeyValueStore, uid: string): PushDevice {
    if (registrar?.supported() !== true) {
        return 'unsupported';
    }
    const permission = registrar.permission();
    return permission === 'denied' ? 'denied' : registeredHere(permission, local, uid);
}

/** Granted, and registered from this browser for this admin before (their device id remembered). */
function registeredHere(permission: PushPermission, local: KeyValueStore, uid: string): PushDevice {
    return permission === 'granted' && pushDeviceOf(local, uid) !== null ? 'on' : 'off';
}

const NO_REGISTRAR = 'apiError.unavailable';

/** "The test notification went to 1 device" in the plural form `count` takes in the admin's language. */
function testSent(locale: Locale, count: number): NoticeInput {
    return { key: `adminContent.notify.push.testSent.${pluralOf(locale, count)}`, params: { count: String(count) } };
}

export class PushSession {
    readonly #deps: PushDeps;
    #state: PushState;

    constructor(deps: PushDeps) {
        this.#deps = deps;
        this.#state = initialPush(deps.registrar, deps.local, deps.uid());
    }

    get state(): PushState {
        return this.#state;
    }

    async turnOn(): Promise<void> {
        const registrar = this.#usable();
        if (registrar === null) {
            return;
        }
        this.#set({ device: 'working', failure: null });
        const permission = await registrar.requestPermission();
        if (permission !== 'granted') {
            this.#set({ device: permission === 'denied' ? 'denied' : 'off' });
            return;
        }
        await this.#register(registrar);
    }

    /** Unregisters this browser; a call that fails leaves push on (the server would still push here) and says why. */
    async turnOff(): Promise<void> {
        const deviceId = pushDeviceOf(this.#deps.local, this.#deps.uid());
        this.#set({ device: 'working', failure: null });
        if (deviceId !== null) {
            const outcome = await outcomeOf(() => this.#deps.callables.call('notify.unregisterDevice', { deviceId }));
            if (!outcome.ok) {
                this.#set({ device: 'on' });
                this.#deps.notify(outcome.error);
                return;
            }
            forgetPushDevice(this.#deps.local);
        }
        this.#set({ device: 'off' });
    }

    async sendTest(): Promise<void> {
        this.#set({ testing: true });
        const outcome = await outcomeOf(() => this.#deps.callables.call('notify.sendTest', {}));
        this.#set({ testing: false });
        this.#deps.notify(outcome.ok ? testSent(this.#deps.locale(), outcome.value.sent) : outcome.error);
    }

    async #register(registrar: PushRegistrar): Promise<void> {
        const token = await registrar.token().catch(() => null);
        if (token === null) {
            this.#set({ device: 'failed', failure: { key: NO_REGISTRAR } });
            return;
        }
        const outcome = await outcomeOf(() => this.#deps.callables.call('notify.registerDevice', { token, lang: this.#deps.locale() }));
        if (!outcome.ok) {
            this.#set({ device: 'failed', failure: outcome.error });
            return;
        }
        rememberPushDevice(this.#deps.local, this.#deps.uid(), outcome.value.deviceId);
        this.#set({ device: 'on' });
    }

    /** The registrar, when this browser can push and nothing is under way; else null. */
    #usable(): PushRegistrar | null {
        const registrar = this.#deps.registrar;
        const idle = this.#state.device !== 'working' && this.#state.device !== 'unsupported';
        return idle ? registrar : null;
    }

    #set(patch: Partial<PushState>): void {
        this.#state = { ...this.#state, ...patch };
        this.#deps.changed(this.#state);
    }
}
