import { afterEach, describe, expect, it } from 'vitest';

import { FullScreenInert, surroundings } from '../../../src/admin/georef/full-screen.js';

afterEach(() => {
    document.body.replaceChildren();
});

describe('full screen (M22 §13.2)', () => {
    it('happyPath_everythingAroundThePageAcrossShadowRootsIsInertThenGivenBack', () => {
        const nav = document.createElement('nav');
        const shell = document.createElement('div');
        document.body.append(nav, shell);
        const root = shell.attachShadow({ mode: 'open' });
        const bar = document.createElement('header');
        const page = document.createElement('section');
        root.append(bar, page);
        const inert = new FullScreenInert();

        inert.cover(page, true);
        const made = [nav.inert, bar.inert, page.inert];
        inert.cover(page, false);

        expect(made).toEqual([true, true, false]);
        expect([nav.inert, bar.inert]).toEqual([false, false]);
    });

    it('badPath_whatWasAlreadyInertStaysInert', () => {
        const dialog = document.createElement('div');
        dialog.setAttribute('inert', '');
        const page = document.createElement('section');
        document.body.append(dialog, page);
        const inert = new FullScreenInert();

        inert.cover(page, true);
        inert.cover(page, false);

        expect(dialog.inert).toBe(true);
        expect(surroundings(document.createElement('p'))).toEqual([]);
    });
});
