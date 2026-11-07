import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { gzipBytes, sha256Hex } from '../../src/start/files.js';

describe('the browser side of a release file', () => {
    it('happyPath_gzipRoundTripsAndTheHashIsHex', async () => {
        const bytes = new TextEncoder().encode('hello hosting');
        expect(gunzipSync(await gzipBytes(bytes)).toString()).toBe('hello hosting');
        expect(await sha256Hex(crypto.subtle, bytes)).toMatch(/^[0-9a-f]{64}$/);
    });
});
