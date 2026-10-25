import '../global-options.js';

import { createHash } from 'node:crypto';

import {
    DEFAULT_PUSH_KINDS,
    FIRESTORE_PATHS,
    adminDocSchema,
    PUSH_DEVICES_MAX,
    notifySettingsDocSchema,
    pushDeviceDocSchema,
    timestampFromDate,
    timestampToDate,
    translateAdminContent,
    type CallableResponse,
    type NotifyRegisterDeviceRequest,
    type PushDeviceDoc,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import type { StoredDocument } from '../ports/documents.js';
import { UpstreamError } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { adminAddress, devicesOf, pushToDevices } from './messages.js';

/**
 * The push callables (admin; `docs/research/M4-interfaces.md` §5.4; S-A47-HAPPY, S-A47-BAD-TOKEN-UNREGISTERED):
 * `notify.registerDevice` stores a browser's FCM token after FCM accepted it in a dry run (`apiError.notify.deviceInvalid`
 * otherwise, and nothing stored), at most `PUSH_DEVICES_MAX` per admin (the oldest replaced), and turns push on in the
 * admin's settings with `DEFAULT_PUSH_KINDS` unless they chose others; one browser is one admin's (a shared computer's
 * browser registered by another admin before stops getting theirs); `notify.unregisterDevice` forgets one browser;
 * `notify.sendTest` sends one test notification to the caller's own devices. Every write is the caller's own
 * (`admins/{uid}/…`) and stamped with their uid.
 */
export type DevicesDeps = CallableDeps & Pick<Ports, 'documents' | 'clock' | 'push' | 'config'>;

/** The role FCM sends need (`apiError.cloud.permission` names it). UNVERIFIED as the narrowest: M4-interfaces §10. */
export const FCM_ROLE = 'roles/firebasecloudmessaging.admin';

/** A device's id: the first 32 hex digits of its token's SHA-256 (the token itself never names a document). */
export function deviceIdOf(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 32);
}

/** How a failure of FCM itself reaches the admin. */
export function pushFailure(error: unknown): unknown {
    if (!(error instanceof UpstreamError)) {
        return error;
    }
    if (error.failure === 'forbidden') {
        return error.api === undefined
            ? new ApiError('apiError.cloud.permission', { role: FCM_ROLE })
            : new ApiError('apiError.cloud.apiDisabled', { api: error.api });
    }
    return new ApiError(error.failure === 'rateLimited' ? 'apiError.rateLimited' : 'apiError.unavailable');
}

async function viaFcm<T>(work: Promise<T>): Promise<T> {
    try {
        return await work;
    } catch (error) {
        throw pushFailure(error);
    }
}

/** The devices beyond `PUSH_DEVICES_MAX - 1` others, oldest first: replaced to make room for a new one. */
function replaced(devices: readonly StoredDocument<PushDeviceDoc>[], deviceId: string): StoredDocument<PushDeviceDoc>[] {
    const others = devices.filter((device) => device.id !== deviceId);
    const oldestFirst = [...others].sort(
        (a, b) => timestampToDate(a.data.createdAt).getTime() - timestampToDate(b.data.createdAt).getTime(),
    );
    return oldestFirst.slice(0, Math.max(0, others.length - (PUSH_DEVICES_MAX - 1)));
}

/**
 * One browser, one admin: the same browser (the same token, so the same device id) registered by another admin before
 * stops getting their notifications. The admins are a handful; a missing device's delete is no error.
 */
async function claimBrowser(deps: DevicesDeps, uid: string, deviceId: string): Promise<void> {
    const admins = await deps.documents.query(FIRESTORE_PATHS.admins, adminDocSchema);
    for (const other of admins.documents.filter((admin) => admin.id !== uid)) {
        await deps.documents.delete(FIRESTORE_PATHS.pushDevice(other.id, deviceId));
    }
}

/** Push on in the admin's settings, keeping the kinds they chose (`DEFAULT_PUSH_KINDS` when they chose none yet). */
async function turnPushOn(deps: DevicesDeps, uid: string, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.notifySettings(uid);
    await deps.documents.transaction(async (transaction) => {
        const settings = await transaction.get(path, notifySettingsDocSchema);
        await transaction.set(path, notifySettingsDocSchema, {
            ...settings,
            push: true,
            pushKinds: settings?.pushKinds ?? [...DEFAULT_PUSH_KINDS],
            updatedBy: uid,
            updatedAt: timestampFromDate(now),
        });
    });
}

async function registerDevice(
    deps: DevicesDeps,
    caller: VerifiedCaller,
    data: NotifyRegisterDeviceRequest,
): Promise<CallableResponse<'notify.registerDevice'>> {
    if (!(await viaFcm(deps.push.validate(data.token)))) {
        throw new ApiError('apiError.notify.deviceInvalid');
    }
    const now = deps.clock.now();
    const deviceId = deviceIdOf(data.token);
    const devices = await devicesOf(deps, caller.uid);
    for (const old of replaced(devices, deviceId)) {
        await deps.documents.delete(old.path);
    }
    const createdAt = devices.find((device) => device.id === deviceId)?.data.createdAt ?? timestampFromDate(now);
    await deps.documents.set(FIRESTORE_PATHS.pushDevice(caller.uid, deviceId), pushDeviceDocSchema, {
        token: data.token,
        lang: data.lang,
        createdAt,
        updatedBy: caller.uid,
        updatedAt: timestampFromDate(now),
    });
    await claimBrowser(deps, caller.uid, deviceId);
    await turnPushOn(deps, caller.uid, now);
    deps.log.info('push device registered', { uid: caller.uid, deviceId });
    return { deviceId };
}

async function unregisterDevice(
    deps: DevicesDeps,
    caller: VerifiedCaller,
    data: { readonly deviceId: string },
): Promise<CallableResponse<'notify.unregisterDevice'>> {
    const path = FIRESTORE_PATHS.pushDevice(caller.uid, data.deviceId);
    const removed = (await deps.documents.get(path, pushDeviceDocSchema)) !== undefined;
    if (removed) {
        await deps.documents.delete(path);
    }
    return { removed };
}

async function sendTest(deps: DevicesDeps, caller: VerifiedCaller): Promise<CallableResponse<'notify.sendTest'>> {
    const devices = await devicesOf(deps, caller.uid);
    const content = {
        body: (locale: 'ro' | 'en') => translateAdminContent(locale, 'adminContent.notify.push.testMessage'),
        link: adminAddress(deps, '#/inbox'),
        tag: `test-${String(deps.clock.now().getTime())}`,
    };
    return viaFcm(pushToDevices(deps, caller.uid, devices, content));
}

export function registerDeviceFunction(getDeps: () => DevicesDeps) {
    return defineCallable('notify.registerDevice', registerDevice, getDeps);
}

export function unregisterDeviceFunction(getDeps: () => DevicesDeps) {
    return defineCallable('notify.unregisterDevice', unregisterDevice, getDeps);
}

export function sendTestFunction(getDeps: () => DevicesDeps) {
    return defineCallable('notify.sendTest', (deps: DevicesDeps, caller) => sendTest(deps, caller), getDeps);
}
