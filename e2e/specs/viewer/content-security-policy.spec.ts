import { sitePath } from '../../support/site.js';
import { expect, test } from '../../support/test.js';

/**
 * The page's meta Content Security Policy (behaviour V16, bad path; docs/research/design-review-security-cost.md §1.8):
 * markup that somehow reached the DOM cannot run code or contact a host the site does not use. An inline script is
 * refused (`script-src` has no `'unsafe-inline'`), and an image from an unknown host is refused before any request,
 * so not even the firewall sees it.
 */

interface Violation {
    readonly directive: string;
    readonly blocked: string;
}

/** Runs in the page: adds an element built with DOM calls only and reports the CSP violation it causes. */
function injectAndReport(kind: string): Promise<Violation> {
    return new Promise((resolve) => {
        document.addEventListener(
            'securitypolicyviolation',
            (event) => {
                resolve({ directive: event.violatedDirective, blocked: event.blockedURI });
            },
            { once: true },
        );
        if (kind === 'script') {
            const script = document.createElement('script');
            script.textContent = 'document.documentElement.dataset.injected = "yes";';
            document.body.append(script);
        } else {
            const image = document.createElement('img');
            image.alt = '';
            image.src = 'https://tracker.invalid/pixel.png';
            document.body.append(image);
        }
    });
}

test(
    'An inline script or an unknown host is refused by the page policy',
    { tag: '@S-V16-BAD-INLINE-SCRIPT' },
    async ({ page, firewall, consoleErrors }) => {
        await page.goto(sitePath('bucharest'));

        expect(await page.evaluate(injectAndReport, 'script')).toEqual({ directive: 'script-src-elem', blocked: 'inline' });
        await expect(page.locator('html')).not.toHaveAttribute('data-injected');
        expect(await page.evaluate(injectAndReport, 'image')).toEqual({
            directive: 'img-src',
            blocked: 'https://tracker.invalid/pixel.png',
        });

        expect(firewall.take()).toEqual([]);
        expect(consoleErrors.take()).toEqual([
            expect.stringContaining('Content Security Policy'),
            expect.stringContaining('Content Security Policy'),
        ]);
    },
);
