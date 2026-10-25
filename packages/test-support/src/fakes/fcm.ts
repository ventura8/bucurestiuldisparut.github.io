import { fixtureResponse } from '../api-fixtures/index.js';
import { authenticated, googleFailure, type GoogleApi } from './google-common.js';
import { requestObject, route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Firebase Cloud Messaging HTTP v1 (`docs/research/M4-interfaces.md` §5.4, §8), which only the server calls (the
 * fan-out's pushes, `notify.registerDevice`'s dry run, `notify.sendTest`): `messages:send` accepts a message whose
 * target is a well-formed installation id (`fid`, what the admin page registers; the shared schemas call it the
 * device's token) and records it (a `validate_only` dry run is answered and not recorded); one in `unregistered`
 * answers 404 `UNREGISTERED`, as FCM does for a browser that unsubscribed; a message without a well-formed `fid` (a
 * legacy `token` target included) answers 400 `INVALID_ARGUMENT`. The scenario `fcm.tokensGone` marks every token seen so far unregistered;
 * `fail('fcm', 'unavailable' | 'rateLimited' | 'forbidden' | 'apiDisabled')` answers Google's error envelopes.
 * No browser ever reaches it (the e2e firewall refuses `fcm.googleapis.com` from a page).
 */

export interface PushedMessage {
    readonly token: string;
    /** `webpush.notification` as sent: the title, the text and the tag. */
    readonly notification: Readonly<Record<string, unknown>>;
    /** `webpush.fcm_options.link`: the admin page the notification opens. */
    readonly link: string | null;
}

export interface FcmState {
    readonly messages: PushedMessage[];
    /** Tokens FCM no longer knows. */
    readonly unregistered: Set<string>;
    /** Every token a send or a dry run named. */
    readonly seen: Set<string>;
}

export function defaultFcmState(): FcmState {
    return { messages: [], unregistered: new Set(), seen: new Set() };
}

const API: GoogleApi = {
    service: 'fcm.googleapis.com',
    title: 'Firebase Cloud Messaging API',
    permission: 'cloudmessaging.messages.create',
};

/** What the fake takes as an installation id (the shared device schema's characters, at least 20 of them). */
const TOKEN = /^[A-Za-z0-9_:.-]{20,4096}$/;

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
}

function pushedOf(message: Readonly<Record<string, unknown>>, token: string): PushedMessage {
    const webpush = record(message['webpush']);
    const link = record(webpush['fcm_options'])['link'];
    return { token, notification: record(webpush['notification']), link: typeof link === 'string' ? link : null };
}

export function createFcmFake(state: FcmState): ServiceFake {
    return {
        name: 'fcm',
        routes: [
            route(
                'POST',
                'https://fcm.googleapis.com/v1/projects/{project}/messages:send',
                'fcm.send',
                authenticated(API, (request) => {
                    const body = requestObject(request);
                    const message = record(body['message']);
                    const token = typeof message['fid'] === 'string' ? message['fid'] : '';
                    state.seen.add(token);
                    if (!TOKEN.test(token)) {
                        return fixtureResponse('fcm/send.invalid-token');
                    }
                    if (state.unregistered.has(token)) {
                        return fixtureResponse('fcm/send.unregistered');
                    }
                    if (body['validate_only'] !== true) {
                        state.messages.push(pushedOf(message, token));
                    }
                    return fixtureResponse('fcm/send.ok');
                }),
            ),
        ],
        failure: (mode) => googleFailure(API, mode),
        scenarios: {
            tokensGone: () => {
                state.seen.forEach((token) => state.unregistered.add(token));
            },
        },
        snapshot: () => ({ messages: state.messages, unregistered: [...state.unregistered].sort((a, b) => a.localeCompare(b)) }),
    };
}
