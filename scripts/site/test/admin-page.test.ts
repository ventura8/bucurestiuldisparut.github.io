import { describe, expect, it } from 'vitest';

import { ADMIN_PAGE, ADMIN_SCRIPT_FILE, ADMIN_SHELL_ELEMENT, ADMIN_STYLESHEET_FILE, renderAdminPage } from '../src/admin/page.js';
import { htmlValidateMessages } from './support.js';

describe('renderAdminPage', () => {
    it('happyPath_passesTheRepositoryHtmlValidateRules', async () => {
        expect(await htmlValidateMessages(renderAdminPage(), 'packages/admin/dist/index.html')).toEqual([]);
    });

    it('happyPath_loadsTheStylesheetThenTheBundleAndHoldsTheShell', () => {
        const html = renderAdminPage();

        expect([...html.matchAll(/<(?:script|link) [^>]*>/g)].map(([tag]) => tag)).toEqual([
            '<link rel="icon" href="data:,">',
            `<link rel="stylesheet" href="${ADMIN_STYLESHEET_FILE}">`,
            `<script src="${ADMIN_SCRIPT_FILE}" defer>`,
        ]);
        expect(html).toContain(`<${ADMIN_SHELL_ELEMENT}></${ADMIN_SHELL_ELEMENT}>`);
        expect(html).toContain('<html lang="ro">');
        expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    });

    it('badPath_noMetaPolicyNoInlineCodeAndABilingualNoScriptNote', () => {
        const html = renderAdminPage({ ...ADMIN_PAGE, lang: 'en', title: 'Admin <&>' });

        // Hosting sends the policy as a header (firebase.json); a meta copy would drift and could only tighten it.
        expect(html).not.toContain('Content-Security-Policy');
        expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
        expect(html).not.toContain('<style');
        expect(html).toContain('<title>Admin &lt;&amp;&gt;</title>');
        expect(html).toContain(`<p lang="ro" class="admin-noscript">${ADMIN_PAGE.noscript.ro}</p>`);
        expect(html).toContain(`<p lang="en" class="admin-noscript">${ADMIN_PAGE.noscript.en}</p>`);
    });
});
