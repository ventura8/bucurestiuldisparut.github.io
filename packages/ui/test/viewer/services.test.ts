import type { BBox, LngLat } from '@hcm/shared';
import { describe, expect, it, vi } from 'vitest';

import {
    browserServices,
    locateVisitor,
    resolveAssetUrl,
    shareMessage,
    sharePage,
    type ViewerServices,
} from '../../src/viewer/services.js';

const BOUNDS: BBox = [
    [25.93, 44.33],
    [26.25, 44.55],
];

function services(change: Partial<ViewerServices> = {}): ViewerServices {
    return {
        share: null,
        copyText: () => Promise.resolve(),
        locate: () => Promise.resolve([26.1, 44.43] as LngLat),
        pageUrl: () => 'https://example.org/map/#14/44.43/26.1',
        matchMedia: (query) => window.matchMedia(query),
        ...change,
    };
}

interface FakeGeolocation {
    readonly getCurrentPosition: (success: PositionCallback, failure: PositionErrorCallback) => void;
}

function fakeWindow(navigator: Record<string, unknown>): Window {
    return {
        navigator,
        location: { href: 'https://example.org/city/#15/44.4/26.1' },
        matchMedia: (query: string) => window.matchMedia(query),
    } as unknown as Window;
}

describe('browserServices', () => {
    it('happyPath_usesTheWindowsShareClipboardAndGeolocation', async () => {
        const share = vi.fn(() => Promise.resolve());
        const writeText = vi.fn(() => Promise.resolve());
        const geolocation: FakeGeolocation = {
            getCurrentPosition: (success) => {
                success({ coords: { longitude: 26.1, latitude: 44.43 } } as GeolocationPosition);
            },
        };
        const real = browserServices(fakeWindow({ share, clipboard: { writeText }, geolocation }));

        await real.share?.({ title: 'Hartă', url: 'https://example.org/' });
        await real.copyText('https://example.org/');

        expect(share).toHaveBeenCalledWith({ title: 'Hartă', url: 'https://example.org/' });
        expect(writeText).toHaveBeenCalledWith('https://example.org/');
        await expect(real.locate()).resolves.toEqual([26.1, 44.43]);
        expect(real.pageUrl()).toBe('https://example.org/city/#15/44.4/26.1');
        expect(real.matchMedia('(min-width: 1px)').matches).toBe(true);
    });

    it('badPath_noWebShareApiAndNoGeolocation', async () => {
        const real = browserServices(fakeWindow({ clipboard: { writeText: () => Promise.resolve() } }));

        expect(real.share).toBeNull();
        await expect(real.locate()).rejects.toThrow('geolocation unavailable');
    });

    it('badPath_deniedGeolocationRejectsWithItsCode', async () => {
        const geolocation: FakeGeolocation = {
            getCurrentPosition: (_success, failure) => {
                failure({ code: 1 } as GeolocationPositionError);
            },
        };
        await expect(browserServices(fakeWindow({ geolocation })).locate()).rejects.toEqual({ code: 1 });
    });
});

describe('sharePage', () => {
    it('happyPath_webShareShares', async () => {
        const share = vi.fn(() => Promise.resolve());

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('shared');
        expect(share).toHaveBeenCalledWith({ title: 'Hartă', url: 'https://example.org/map/#14/44.43/26.1' });
    });

    it('happyPath_withoutWebShareTheLinkIsCopied', async () => {
        const copyText = vi.fn(() => Promise.resolve());

        await expect(sharePage(services({ copyText }), 'Hartă')).resolves.toBe('copied');
        expect(copyText).toHaveBeenCalledWith('https://example.org/map/#14/44.43/26.1');
    });

    it('badPath_closingTheShareSheetIsNotAnError', async () => {
        const share = () => Promise.reject(new DOMException('closed', 'AbortError'));

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('cancelled');
    });

    it('badPath_aFailingShareFallsBackToTheClipboard', async () => {
        const share = () => Promise.reject(new Error('not allowed'));

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('copied');
    });

    it('badPath_aFailingClipboardFails', async () => {
        const copyText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));

        await expect(sharePage(services({ copyText }), 'Hartă')).resolves.toBe('failed');
    });
});

describe('shareMessage', () => {
    it('happyPath_copiedAndFailedHaveMessages', () => {
        expect(shareMessage('copied')).toBe('share.copied');
        expect(shareMessage('failed')).toBe('share.failed');
    });

    it('badPath_sharedOrCancelledNeedNoMessage', () => {
        expect(shareMessage('shared')).toBeNull();
        expect(shareMessage('cancelled')).toBeNull();
    });
});

describe('locateVisitor', () => {
    it('happyPath_insideTheCityGivesThePosition', async () => {
        await expect(locateVisitor(services(), BOUNDS)).resolves.toEqual({ ok: true, center: [26.1, 44.43] });
    });

    it('badPath_outsideTheCity', async () => {
        const locate = () => Promise.resolve([2.35, 48.85] as LngLat);

        await expect(locateVisitor(services({ locate }), BOUNDS)).resolves.toEqual({ ok: false, code: 'error.geolocate.outside' });
    });

    it('badPath_permissionDenied', async () => {
        const locate = () => Promise.reject(Object.assign(new Error('denied'), { code: 1 }));

        await expect(locateVisitor(services({ locate }), BOUNDS)).resolves.toEqual({ ok: false, code: 'error.geolocate.denied' });
    });

    it('badPath_positionUnavailable', async () => {
        await expect(
            locateVisitor(services({ locate: () => Promise.reject(Object.assign(new Error('unavailable'), { code: 2 })) }), BOUNDS),
        ).resolves.toEqual({
            ok: false,
            code: 'error.geolocate.unavailable',
        });
        await expect(locateVisitor(services({ locate: () => Promise.reject(new Error('x')) }), BOUNDS)).resolves.toMatchObject({
            ok: false,
        });
    });

    it('badPath_noCityYet', async () => {
        await expect(locateVisitor(services(), null)).resolves.toEqual({ ok: false, code: 'error.geolocate.unavailable' });
    });
});

describe('resolveAssetUrl', () => {
    it('happyPath_relativeToTheManifest', () => {
        expect(resolveAssetUrl('derived/a/thumb.webp', 'https://bucket.example.org/cities/b/manifest.json', 'https://example.org/')).toBe(
            'https://bucket.example.org/cities/b/derived/a/thumb.webp',
        );
    });

    it('happyPath_inlineManifestResolvesAgainstThePage', () => {
        expect(resolveAssetUrl('derived/a/thumb.webp', '', 'https://example.org/city/index.html')).toBe(
            'https://example.org/city/derived/a/thumb.webp',
        );
        expect(resolveAssetUrl('https://cdn.example.org/a.webp', 'manifest.json', 'https://example.org/')).toBe(
            'https://cdn.example.org/a.webp',
        );
    });

    it('badPath_unresolvableAddressGivesNull', () => {
        expect(resolveAssetUrl('a.webp', '', 'not a url')).toBeNull();
    });
});
