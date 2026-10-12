import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmSnackbar, type HcmSnackbar } from '../../src/components/snackbar.js';
import { cleanup, fixture, recordEvents, shadowPart } from '../helpers.js';

defineHcmSnackbar();

function snackbar(timeoutMs = 6000, actionLabel = 'Reîncearcă'): Promise<HcmSnackbar> {
    return fixture<HcmSnackbar>(
        html`<hcm-snackbar
            message="Straturile nu s-au încărcat"
            action-label=${actionLabel}
            close-label="Închide"
            timeout-ms=${timeoutMs}
        ></hcm-snackbar>`,
    );
}

describe('<hcm-snackbar>', () => {
    afterEach(() => {
        vi.useRealTimers();
        cleanup();
    });

    it('happyPath_showsTheMessageInAPoliteLiveRegion', async () => {
        const element = await snackbar();

        const status = shadowPart(element, '[role="status"]');

        await expect.element(page.getByRole('status')).toBeInTheDocument();
        expect(status.textContent).toContain('Straturile nu s-au încărcat');
        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theActionFiresAndDismisses', async () => {
        const element = await snackbar();
        const actions = recordEvents(element, 'hcm-action');
        const dismissals = recordEvents(element, 'hcm-dismiss');

        await userEvent.click(page.getByRole('button', { name: 'Reîncearcă' }));
        await element.updateComplete;

        expect(actions).toHaveLength(1);
        expect(dismissals).toEqual([{ reason: 'action' }]);
        expect(element.shadowRoot?.querySelector('.snackbar')).toBeNull();
    });

    it('happyPath_closeDismissesAndANewMessageShowsItAgain', async () => {
        const element = await snackbar(0, '');
        const dismissals = recordEvents(element, 'hcm-dismiss');

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));
        await element.updateComplete;
        element.message = 'Link copiat';
        await element.updateComplete;

        expect(dismissals).toEqual([{ reason: 'close' }]);
        expect(element.shadowRoot?.querySelector('.action')).toBeNull();
        await expect.element(page.getByRole('status')).toHaveTextContent('Link copiat');
    });

    it('happyPath_itTimesOutButPausesWhileHoveredOrFocused', async () => {
        vi.useFakeTimers();
        const element = await snackbar(6000);
        const dismissals = recordEvents(element, 'hcm-dismiss');
        const box = shadowPart(element, '.snackbar');

        vi.advanceTimersByTime(5000);
        box.dispatchEvent(new PointerEvent('pointerenter'));
        vi.advanceTimersByTime(10_000);
        expect(dismissals).toEqual([]);
        box.dispatchEvent(new PointerEvent('pointerleave'));
        box.dispatchEvent(new FocusEvent('focusin'));
        vi.advanceTimersByTime(10_000);
        expect(dismissals).toEqual([]);
        box.dispatchEvent(new FocusEvent('focusout'));
        vi.advanceTimersByTime(6000);

        expect(dismissals).toEqual([{ reason: 'timeout' }]);
    });

    it('badPath_zeroTimeoutAndAnEmptyMessageNeverStartATimer', async () => {
        vi.useFakeTimers();
        const persistent = await snackbar(0);
        const empty = await fixture<HcmSnackbar>(html`<hcm-snackbar close-label="Închide"></hcm-snackbar>`);
        const dismissals = [...recordEvents(persistent, 'hcm-dismiss'), ...recordEvents(empty, 'hcm-dismiss')];

        vi.advanceTimersByTime(60_000);

        expect(dismissals).toEqual([]);
        expect(empty.shadowRoot?.querySelector('.snackbar')).toBeNull();
        persistent.remove();
    });
});
