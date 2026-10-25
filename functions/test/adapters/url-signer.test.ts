/**
 * The export's download signer (`functions/src/adapters/url-signer.ts`, M5 §5.5): V4 signing through firebase-admin's
 * `getSignedUrl` (a fake `Storage`: signing needs the runtime account, an outside boundary), and the Functions
 * emulator's stand-in, whose address the e2e's mock storage host answers.
 */
import { describe, expect, it } from 'vitest';

import {
    attachmentDisposition,
    createStandInUrlSigner,
    createStorageUrlSigner,
    STAND_IN_SIGNATURE,
    type SigningStorage,
} from '../../src/adapters/url-signer.js';

const BUCKETS = { private: 'demo-hcm.firebasestorage.app', public: 'demo-hcm-public' };
const DOWNLOAD = { path: 'exports/cluj/x-20261102-1.zip', expiresAt: new Date('2026-11-02T10:15:00Z'), fileName: 'cluj-2026-11-02.zip' };

function signingStorage(answer: () => Promise<[string]>): SigningStorage & { readonly asked: unknown[] } {
    const asked: unknown[] = [];
    return {
        asked,
        bucket: (name) => ({
            file: (path) => ({
                getSignedUrl: (config) => {
                    asked.push({ name, path, config });
                    return answer();
                },
            }),
        }),
    };
}

describe('createStorageUrlSigner', () => {
    it('happyPath_aV4ReadAddressThatSavesTheFileUnderItsName', async () => {
        const storage = signingStorage(() => Promise.resolve(['https://storage.googleapis.com/signed']));

        await expect(createStorageUrlSigner(storage, BUCKETS).signedDownload('private', DOWNLOAD)).resolves.toBe(
            'https://storage.googleapis.com/signed',
        );
        expect(storage.asked).toEqual([
            {
                name: BUCKETS.private,
                path: DOWNLOAD.path,
                config: {
                    version: 'v4',
                    action: 'read',
                    expires: DOWNLOAD.expiresAt,
                    responseDisposition: 'attachment; filename="cluj-2026-11-02.zip"',
                },
            },
        ]);
    });

    it('badPath_aRefusedSigningIsACloudStorageFailure', async () => {
        const storage = signingStorage(() =>
            Promise.reject(Object.assign(new Error('Permission iam.serviceAccounts.signBlob denied'), { code: 403 })),
        );

        await expect(createStorageUrlSigner(storage, BUCKETS).signedDownload('private', DOWNLOAD)).rejects.toMatchObject({
            service: 'cloud-storage',
            failure: 'forbidden',
        });
    });
});

describe('createStandInUrlSigner', () => {
    it('happyPath_theStandInAddressHasAV4ShapeOnTheStorageHost', async () => {
        const url = new URL(
            await createStandInUrlSigner(BUCKETS, () => new Date('2026-11-02T10:00:00Z')).signedDownload('private', DOWNLOAD),
        );

        expect(`${url.origin}${url.pathname}`).toBe(`https://storage.googleapis.com/${BUCKETS.private}/${DOWNLOAD.path}`);
        expect(Object.fromEntries(url.searchParams)).toEqual({
            'X-Goog-Algorithm': STAND_IN_SIGNATURE,
            'X-Goog-Expires': '900',
            'response-content-disposition': attachmentDisposition(DOWNLOAD.fileName),
        });
    });

    it('badPath_anAddressAlreadyPastItsTimeStillLivesASecond', async () => {
        const url = new URL(
            await createStandInUrlSigner(BUCKETS, () => new Date('2026-11-02T11:00:00Z')).signedDownload('public', DOWNLOAD),
        );

        expect(url.searchParams.get('X-Goog-Expires')).toBe('1');
        expect(url.pathname.startsWith(`/${BUCKETS.public}/`)).toBe(true);
    });
});
