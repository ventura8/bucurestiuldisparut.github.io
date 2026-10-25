/**
 * The FCM adapter (`functions/src/adapters/fcm.ts`, `docs/research/M4-interfaces.md` §5.4) against the shared fake FCM:
 * one web push message per token with the item's title, text, tag and admin link; a token FCM no longer knows is
 * reported, a transient failure skips its token, a refused credential fails the send; the dry run that checks a token
 * before it is stored. No network, no server key.
 */
import { createFakeFetch, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createFcm, webPushMessage } from '../../src/adapters/fcm.js';
import { PROJECT_ID, SERVICE_TOKENS, fcmToken, m4Upstreams } from '../support/m4-upstreams.js';

const MESSAGE = {
    title: 'Notificări',
    body: 'Procesarea „Corona 1968” a eșuat.',
    link: 'https://demo-hcm.web.app/#/jobs',
    tag: 'job.failed~c~j~0',
};
const SEND = `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`;

describe('send', () => {
    it('happyPath_eachTokenGetsTheWebPushMessage', async () => {
        const { fakes, push } = m4Upstreams();
        const [laptop, phone] = [fcmToken('laptop'), fcmToken('phone')];

        await expect(push.send([laptop, phone], MESSAGE)).resolves.toEqual({ sent: 2, unregistered: [] });
        expect(fakes.state.fcm.messages).toEqual([
            { token: laptop, notification: { title: MESSAGE.title, body: MESSAGE.body, tag: MESSAGE.tag }, link: MESSAGE.link },
            { token: phone, notification: { title: MESSAGE.title, body: MESSAGE.body, tag: MESSAGE.tag }, link: MESSAGE.link },
        ]);
        expect(webPushMessage(laptop, MESSAGE).webpush.fcm_options).toEqual({ link: MESSAGE.link });
    });

    it('badPath_aTokenFcmNoLongerKnowsIsReportedAndTheOthersStillGo @S-A47-BAD-TOKEN-UNREGISTERED', async () => {
        const { fakes, push } = m4Upstreams();
        const [gone, kept] = [fcmToken('gone'), fcmToken('kept')];
        fakes.state.fcm.unregistered.add(gone);

        await expect(push.send([gone, kept], MESSAGE)).resolves.toEqual({ sent: 1, unregistered: [gone] });
    });

    it('badPath_aTransientFailureSkipsItsTokenOnly', async () => {
        const answers = [jsonResponse({ error: { code: 503 } }, 503), jsonResponse({ name: 'x' })];
        const upstream = createFakeFetch(routeTable([route('POST', SEND, 'fcm.send', () => answers.shift() ?? jsonResponse({}, 500))]));
        const push = createFcm({ projectId: PROJECT_ID, tokens: SERVICE_TOKENS, fetch: upstream.fetch });

        await expect(push.send([fcmToken('a'), fcmToken('b')], MESSAGE)).resolves.toEqual({ sent: 1, unregistered: [] });
    });

    it.each([
        ['forbidden', { failure: 'forbidden', api: undefined }],
        ['apiDisabled', { failure: 'forbidden', api: 'fcm.googleapis.com' }],
        ['unauthorized', { failure: 'unauthorized' }],
    ] as const)('badPath_aRefused_%s_failsTheWholeSend', async (mode, expected) => {
        const { fakes, push } = m4Upstreams();
        fakes.fail('fcm', mode);

        await expect(push.send([fcmToken('a')], MESSAGE)).rejects.toMatchObject({ service: 'fcm', ...expected });
    });

    it('happyPath_noTokensSendNothing', async () => {
        const { fakes, push } = m4Upstreams();

        await expect(push.send([], MESSAGE)).resolves.toEqual({ sent: 0, unregistered: [] });
        expect(fakes.callsTo('fcm.send')).toEqual([]);
    });
});

describe('validate', () => {
    it('happyPath_aBrowsersTokenPassesTheDryRunAndNothingIsShown', async () => {
        const { fakes, push } = m4Upstreams();

        await expect(push.validate(fcmToken('laptop'))).resolves.toBe(true);
        expect(fakes.state.fcm.messages).toEqual([]);
        expect(JSON.parse(String(fakes.callsTo('fcm.send')[0]?.body))).toMatchObject({ validate_only: true });
    });

    it.each([
        [
            'an unregistered token',
            (fakes: ReturnType<typeof m4Upstreams>['fakes'], token: string) => fakes.state.fcm.unregistered.add(token),
        ],
        ['a token that is no registration token', () => undefined],
    ])('badPath_%s_isRefused', async (name, prepare) => {
        const { fakes, push } = m4Upstreams();
        const token = name === 'a token that is no registration token' ? 'short' : fcmToken('old');
        prepare(fakes, token);

        await expect(push.validate(token)).resolves.toBe(false);
    });

    it('badPath_anOutageIsAFailureNotARefusal', async () => {
        const { fakes, push } = m4Upstreams();
        fakes.fail('fcm', 'unavailable');

        await expect(push.validate(fcmToken('laptop'))).rejects.toMatchObject({ service: 'fcm', failure: 'unavailable' });
    });

    it('badPath_aNotFoundWithoutAnFcmCodeIsStillGone', async () => {
        const upstream = createFakeFetch(routeTable([route('POST', SEND, 'fcm.send', () => jsonResponse({ error: { code: 404 } }, 404))]));
        const push = createFcm({ projectId: PROJECT_ID, tokens: SERVICE_TOKENS, fetch: upstream.fetch });

        await expect(push.validate(fcmToken('old'))).resolves.toBe(false);
        await expect(push.send([fcmToken('old')], MESSAGE)).resolves.toEqual({ sent: 0, unregistered: [fcmToken('old')] });
    });
});
