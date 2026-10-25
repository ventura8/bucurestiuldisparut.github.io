import type { PushSender } from '../ports/push-sender.js';
import type { TokenProvider } from '../ports/token-provider.js';
import { googleError, googleSend } from './google-call.js';
import { at, list, readJson, stringAt, type Fetch } from './upstream-http.js';

/**
 * Firebase Cloud Messaging HTTP v1 (`docs/research/M4-interfaces.md` §5.4) over REST with the functions' own service
 * account (`roles/firebasecloudmessaging.admin`; no server key): `messages:send` once per device (HTTP v1 has no
 * multicast), the item's title and text as a web push notification and its admin link as `fcm_options.link`. A device
 * is the browser's Firebase installation ID (FID), which the admin page registers with `register` and `onRegistered`
 * (firebase 13 deprecates `getToken`), so a message targets `fid`, as firebase-admin 14's `FidMessage` sends it; the
 * shared schemas keep the field's name `token` (DECISIONS-for-review.md §54). REST
 * rather than firebase-admin's `getMessaging()`, so the Functions emulator reaches the fake FCM through
 * `createEmulatorFetch` like every other Google API and no local run can push to a real browser.
 *
 * A token FCM no longer knows (404, `UNREGISTERED`) is reported, not thrown; a refused credential or role (401, 403)
 * fails the whole send (`UpstreamError('fcm', …)`); any other failure of one token (429, 5xx) skips that token, so one
 * device's trouble never keeps the others' notification back.
 */
type PushMessage = Parameters<PushSender['send']>[1];

const SERVICE = 'fcm';

const FCM_API = 'https://fcm.googleapis.com/v1';

/** What makes a token worthless: FCM's own error codes (`google.firebase.fcm.v1.FcmError`). */
const GONE_CODES = new Set(['UNREGISTERED']);
const INVALID_CODES = new Set(['UNREGISTERED', 'INVALID_ARGUMENT']);
const FATAL_STATUSES = new Set([401, 403]);
const NOT_FOUND = 404;

export interface FcmOptions {
    readonly projectId: string;
    readonly tokens: TokenProvider;
    readonly fetch: Fetch;
}

/** The `errorCode` of the answer's `FcmError` detail, if it has one. */
function fcmErrorCode(body: unknown): string | undefined {
    const detail = list(at(body, 'error', 'details')).find((entry) => stringAt(entry, 'errorCode') !== undefined);
    return stringAt(detail, 'errorCode');
}

/** The web push message of one device (its FID). */
export function webPushMessage(fid: string, message: PushMessage) {
    return {
        fid,
        webpush: {
            notification: { title: message.title, body: message.body, tag: message.tag },
            fcm_options: { link: message.link },
        },
    };
}

/** A dry run's answer that says the token itself is worthless (unregistered, or no registration token at all). */
async function refusesToken(response: Response): Promise<boolean> {
    const code = fcmErrorCode(await readJson(response)) ?? '';
    return response.status === NOT_FOUND || INVALID_CODES.has(code);
}

/** A send's answer that says FCM no longer knows the token (the browser unsubscribed, or the token expired). */
async function goneToken(response: Response): Promise<boolean> {
    const code = fcmErrorCode(await readJson(response)) ?? '';
    return response.status === NOT_FOUND || GONE_CODES.has(code);
}

type Outcome = 'sent' | 'gone' | 'skipped';

export function createFcm(options: FcmOptions): PushSender {
    const url = `${FCM_API}/projects/${encodeURIComponent(options.projectId)}/messages:send`;
    const post = async (body: unknown): Promise<Response> =>
        googleSend(options.fetch, SERVICE, url, { method: 'POST', accessToken: await options.tokens.accessToken(), body });
    const outcomeOf = async (response: Response): Promise<Outcome> => {
        if (response.ok) {
            return 'sent';
        }
        if (FATAL_STATUSES.has(response.status)) {
            throw await googleError(SERVICE, response);
        }
        return (await goneToken(response)) ? 'gone' : 'skipped';
    };
    return {
        send: async (tokens, message) => {
            let sent = 0;
            const unregistered: string[] = [];
            for (const token of tokens) {
                const outcome = await outcomeOf(await post({ message: webPushMessage(token, message) }));
                sent += outcome === 'sent' ? 1 : 0;
                if (outcome === 'gone') {
                    unregistered.push(token);
                }
            }
            return { sent, unregistered };
        },
        validate: async (token) => {
            const response = await post({ validate_only: true, message: { fid: token } });
            if (response.ok) {
                return true;
            }
            if (await refusesToken(response.clone())) {
                return false;
            }
            throw await googleError(SERVICE, response);
        },
    };
}
