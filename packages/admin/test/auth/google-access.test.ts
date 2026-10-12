import { describe, expect, it } from 'vitest';

import { GoogleAccessStore, MIN_TOKEN_REMAINING_MS } from '../../src/auth/google-access.js';
import { GoogleAccessService, failureNotice } from '../../src/auth/google-service.js';
import { GoogleAuthError } from '../../src/auth/google-auth.js';
import { GOOGLE_SCOPES } from '../../src/google/scopes.js';
import { access, FakeAuth, FakeClock, FakeGoogle, OWNER, STRANGER } from '../app/fakes.js';

describe('GoogleAccessStore', () => {
    it('happyPath_aLiveTokenOfTheUserSatisfiesItsScopes', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        const token = access([GOOGLE_SCOPES.cloudPlatform], clock.now() + 3_600_000);

        store.keep(OWNER.uid, token);

        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBe(token);
        expect(store.live(OWNER.uid, 'cloudBilling', MIN_TOKEN_REMAINING_MS)).toBe(token);
    });

    it('badPath_anotherUserTheWrongScopeOrTooLittleTimeLeftGiveNoToken', () => {
        const clock = new FakeClock();
        const store = new GoogleAccessStore(() => clock.now());
        store.keep(OWNER.uid, access([GOOGLE_SCOPES.cloudReadOnly], clock.now() + 4 * 60_000));

        expect(store.live(STRANGER.uid, 'cloudReadOnly', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'cloudPlatform', 0)).toBeNull();
        expect(store.live(OWNER.uid, 'cloudReadOnly', MIN_TOKEN_REMAINING_MS)).toBeNull();

        clock.advance(5 * 60_000);
        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBeNull();
    });

    it('badPath_aDroppedTokenIsGone', () => {
        const store = new GoogleAccessStore(() => 0);
        store.keep(OWNER.uid, access([GOOGLE_SCOPES.cloudReadOnly], 3_600_000));

        store.drop();

        expect(store.live(OWNER.uid, 'cloudReadOnly', 0)).toBeNull();
    });
});

function service(user = OWNER) {
    const auth = new FakeAuth();
    auth.user = user;
    const clock = new FakeClock();
    const port = new FakeGoogle(auth);
    const google = new GoogleAccessService({
        port,
        store: new GoogleAccessStore(() => clock.now()),
        currentUser: () => auth.currentUser(),
        locale: () => 'ro',
    });
    return { auth, port, google };
}

describe('GoogleAccessService', () => {
    it('happyPath_aGrantIsKeptForTheSignedInUserWithItsAddressAsTheHint', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudBilling]));

        await expect(google.request('cloudBilling')).resolves.toMatchObject({ granted: true });

        expect(port.requests).toEqual([{ scope: 'cloudBilling', options: { loginHint: OWNER.email } }]);
        expect(google.live('cloudBilling')?.token).toBe('ya29.e2e-owner-access-token');
    });

    it('happyPath_noUserNoHintAndNoTokenKept', async () => {
        const { auth, port, google } = service();
        auth.user = null;
        port.outcomes.push(access([GOOGLE_SCOPES.cloudBilling]));
        Object.assign(auth, { announce: () => undefined });

        await google.request('cloudBilling');

        expect(port.requests[0]?.options).toEqual({});
        expect(google.live('cloudBilling')).toBeNull();
    });

    it('happyPath_anAccountWithoutAnAddressGivesNoHint', async () => {
        const { port, google } = service({ uid: 'no-address', email: null, displayName: null });

        await google.request(null);

        expect(port.requests[0]?.options).toEqual({});
    });

    it('badPath_aWrongAccountDropsTheTokenAndSaysWhy', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudReadOnly]), new GoogleAuthError('wrongAccount'));
        await google.request('cloudReadOnly');

        const outcome = await google.request('cloudBilling');

        expect(outcome).toEqual({ granted: false, failure: 'wrongAccount', notice: { key: 'adminShell.oauth.wrongAccount' } });
        expect(google.live('cloudReadOnly')).toBeNull();
    });

    it('badPath_anUnknownErrorIsAFailedConsent', async () => {
        const { port, google } = service();
        port.outcomes.push(new Error('boom'));

        await expect(google.request('cloudReadOnly')).resolves.toMatchObject({ granted: false, failure: 'failed' });
    });

    it('happyPath_dropForgetsTheToken', async () => {
        const { port, google } = service();
        port.outcomes.push(access([GOOGLE_SCOPES.cloudReadOnly]));
        await google.request('cloudReadOnly');

        google.drop();

        expect(google.live('cloudReadOnly')).toBeNull();
    });
});

describe('failureNotice', () => {
    it('happyPath_aRefusedScopeIsNamedInTheLanguageOfThePage', () => {
        expect(failureNotice('scopeDenied', 'cloudBilling', 'ro')).toEqual({
            key: 'adminShell.oauth.scopeDenied',
            params: { scope: 'Gestionează facturarea Google Cloud' },
        });
        expect(failureNotice('scopeDenied', null, 'en').params).toEqual({ scope: 'View your Google Cloud data' });
    });

    it.each([
        ['popupBlocked', 'adminShell.oauth.popupBlocked'],
        ['popupClosed', 'adminShell.oauth.popupClosed'],
        ['network', 'apiError.unavailable'],
        ['failed', 'apiError.internal'],
    ] as const)('badPath_%s_shows_%s', (failure, key) => {
        expect(failureNotice(failure, 'cloudPlatform', 'en')).toEqual({ key });
    });
});
