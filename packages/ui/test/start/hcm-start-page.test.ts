/** The start page's element: what each screen shows and which intent each control calls (`docs/research/M14-start-your-map.md`). */
import { translateStart, type StartKey } from '@hcm/shared';
import type { LitElement } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import {
    defineHcmStartPage,
    HCM_START_PAGE_TAG,
    type HcmStartPage,
    type StartPagePort,
    type StartPageView,
} from '../../src/start/hcm-start-page.js';

const t = (key: StartKey, params?: Readonly<Record<string, string>>): string => translateStart('en', key, params);

const VIEW: StartPageView = {
    screen: 'intro',
    locale: 'en',
    form: {
        nameRo: '',
        nameEn: '',
        cityId: '',
        area: { west: '', south: '', east: '', north: '' },
        create: true,
        projectId: '',
        picked: '',
    },
    projects: null,
    notice: null,
    steps: { project: 'done', firebase: 'working', webApp: 'waiting', site: 'waiting', files: 'waiting', release: 'failed' },
    files: { done: 1, total: 3 },
    failure: null,
    busy: false,
    plan: { projectId: 'fostul-bacau', city: { name: { ro: 'Bacău' } } },
    providerWaiting: false,
    command: 'npx create-historic-city@1 self-host',
};

interface Rendered {
    readonly page: HcmStartPage;
    readonly calls: unknown[][];
    readonly root: ShadowRoot;
    readonly change: (next: Partial<StartPageView>) => Promise<void>;
}

function shadowOf(page: HcmStartPage): ShadowRoot {
    const { shadowRoot } = page;
    if (shadowRoot === null) {
        throw new Error('no shadow root');
    }
    return shadowRoot;
}

async function rendered(view: Partial<StartPageView>, problems: Partial<ReturnType<StartPagePort['problems']>> = {}): Promise<Rendered> {
    defineHcmStartPage();
    const calls: unknown[][] = [];
    const listeners = new Set<() => void>();
    let current: StartPageView = { ...VIEW, ...view };
    const intents = new Proxy(
        {},
        {
            get:
                (_target, name) =>
                (...args: unknown[]) =>
                    calls.push([name, ...args]),
        },
    ) as StartPagePort['intents'];
    const page = document.createElement(HCM_START_PAGE_TAG) as HcmStartPage;
    page.port = {
        get view() {
            return current;
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        intents,
        problems: () => ({ cityId: null, area: null, projectId: null, ready: true, ...problems }),
    };
    document.body.append(page);
    await page.updateComplete;
    return {
        page,
        calls,
        root: shadowOf(page),
        change: async (next) => {
            current = { ...current, ...next };
            listeners.forEach((listener) => {
                listener();
            });
            await page.updateComplete;
        },
    };
}

afterEach(() => {
    document.body.replaceChildren();
});

const input = (root: ShadowRoot, id: string): HTMLInputElement => root.getElementById(id) as HTMLInputElement;
const type = (element: HTMLInputElement | HTMLSelectElement, value: string, name = 'input'): void => {
    element.value = value;
    element.dispatchEvent(new Event(name, { bubbles: true }));
};

describe('hcm-start-page', () => {
    it('happyPath_theIntroExplainsThenAsksGoogle', async () => {
        const { root, calls } = await rendered({});
        expect(root.textContent).toContain(t('start.cost.budget'));
        expect(root.textContent).toContain(t('start.consent.warning'));
        expect(root.textContent).toContain(VIEW.command);
        root.querySelector<HTMLButtonElement>('button.filled')?.click();
        expect(calls).toEqual([['signIn']]);
    });

    it('happyPath_theLanguageButtonsSayWhichIsOn', async () => {
        const { root, calls } = await rendered({});
        const language = root.querySelector<LitElement>('hcm-start-language');
        await language?.updateComplete;
        const [ro, en] = language?.shadowRoot?.querySelectorAll('nav button') ?? [];
        expect(en?.getAttribute('aria-pressed')).toBe('true');
        (ro as HTMLButtonElement).click();
        expect(calls).toEqual([['setLocale', 'ro']]);
        expect(document.documentElement.lang).toBe('en');
    });

    it('happyPath_theNoticeOfARefusedConsent', async () => {
        const { root } = await rendered({ notice: 'start.signedOut.denied' });
        expect(root.querySelector('[role="alert"]')?.textContent).toBe(t('start.signedOut.denied'));
    });

    it('badPath_theClosedScreenHasNoButton', async () => {
        const { root } = await rendered({ screen: 'closed' });
        expect(root.querySelector('[data-state="closed"]')?.textContent).toContain(VIEW.command);
        expect(root.querySelector('button.filled')).toBeNull();
    });

    it('happyPath_theFormsFieldsCallTheirIntents', async () => {
        const { root, calls, page } = await rendered({ screen: 'plan' });
        type(input(root, 'name-ro'), 'Bacău');
        type(input(root, 'name-en'), 'Bacau');
        type(input(root, 'city-id'), 'bacau');
        type(input(root, 'edge-west'), '26');
        type(input(root, 'project-id'), 'fostul-bacau');
        root.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        expect(calls).toEqual([
            ['setName', 'Bacău'],
            ['setNameEn', 'Bacau'],
            ['setCityId', 'bacau'],
            ['setEdge', 'west', '26'],
            ['setProjectId', 'fostul-bacau'],
            ['go'],
        ]);
        expect(page.shadowRoot?.querySelector('button[type="submit"]')?.textContent).toContain(t('start.plan.go'));
    });

    it('badPath_theFormSaysWhatItCannotTake', async () => {
        const { root } = await rendered(
            { screen: 'plan' },
            { cityId: 'start.plan.cityIdInvalid', area: 'start.plan.areaTooBig', projectId: 'start.plan.projectIdInvalid', ready: false },
        );
        expect(root.querySelector('#city-id-problem')?.textContent).toBe(t('start.plan.cityIdInvalid'));
        expect(input(root, 'project-id').getAttribute('aria-invalid')).toBe('true');
        expect(root.querySelector('[data-area-problem]')?.textContent).toBe(t('start.plan.areaTooBig'));
        expect(root.querySelector('button[type="submit"]')?.hasAttribute('disabled')).toBe(true);
    });

    it('happyPath_anExistingProjectIsPickedFromTheList', async () => {
        const { root, calls, change } = await rendered({ screen: 'plan', form: { ...VIEW.form, create: false } });
        expect(root.querySelector('[data-no-projects]')?.textContent).toBe('…');
        await change({ projects: [] });
        expect(root.querySelector('[data-no-projects]')?.textContent).toBe(t('start.plan.pickNone'));
        await change({ projects: [{ projectId: 'one-project', displayName: 'One' }] });
        const select = root.querySelector<HTMLSelectElement>('select');
        if (select === null) {
            throw new Error('no list');
        }
        type(select, 'one-project', 'change');
        expect(calls).toEqual([['setPicked', 'one-project']]);
        expect(root.querySelector('button[type="submit"]')?.textContent).toContain(t('start.plan.goExisting'));
        root.querySelector<HTMLInputElement>('input[type="radio"]')?.dispatchEvent(new Event('change'));
        expect(calls.at(-1)).toEqual(['setCreate', true]);
    });
});

describe('hcm-start-page, the run', () => {
    it('happyPath_theRunShowsEachStep', async () => {
        const { root } = await rendered({ screen: 'work' });
        expect(root.querySelector('[data-step="firebase"]')?.getAttribute('data-state')).toBe('working');
        expect(root.querySelector('[data-step="files"]')?.textContent).toContain(t('start.step.files', { done: '1', total: '3' }));
        expect(root.querySelector('[data-step="release"]')?.textContent).toContain(t('start.step.state.failed'));
    });

    it.each([
        ['again', 'start.tryAgain'],
        ['consent', 'start.continue'],
    ] as const)('badPath_aFailureWithItsAction_%s', async (action, key) => {
        const { root, calls } = await rendered({
            screen: 'work',
            failure: {
                key: 'start.failure.terms',
                action,
                link: { key: 'start.failure.termsLink', url: 'https://console.firebase.google.com/' },
            },
        });
        expect(root.querySelector('[role="alert"] a')?.getAttribute('rel')).toBe('noopener noreferrer');
        const button = root.querySelector<HTMLButtonElement>('[role="alert"] button');
        expect(button?.textContent).toContain(t(key));
        button?.click();
        expect(calls).toEqual([['tryAgain']]);
    });

    it('badPath_aFailureThatGoesBackToTheFormHasNoButton', async () => {
        const { root } = await rendered({ screen: 'plan', failure: { key: 'start.failure.quota', action: 'form' } });
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(t('start.failure.quota'));
        expect(root.querySelector('[role="alert"] button')).toBeNull();
    });

    it('happyPath_theConsoleStepAndItsCheck', async () => {
        const { root, calls, change } = await rendered({ screen: 'provider' });
        expect(root.querySelector('a')?.getAttribute('href')).toBe(
            'https://console.firebase.google.com/project/fostul-bacau/authentication/providers',
        );
        expect(root.querySelector('[data-provider-waiting]')).toBeNull();
        root.querySelector<HTMLButtonElement>('button.filled')?.click();
        expect(calls).toEqual([['checkProvider']]);
        await change({ providerWaiting: true });
        expect(root.querySelector('[data-provider-waiting]')?.textContent).toBe(t('start.provider.waiting'));
    });

    it('happyPath_theDoneScreenLinksTheAdmin', async () => {
        const { root } = await rendered({ screen: 'done' });
        expect(root.querySelector('[data-open-admin]')?.getAttribute('href')).toBe('https://fostul-bacau.web.app/admin/');
        expect(root.textContent).toContain(t('start.done.next', { city: 'Bacău' }));
    });

    it('edge_noPortRendersNothingAndAMovedPageFollowsItsPort', async () => {
        defineHcmStartPage();
        const page = document.createElement(HCM_START_PAGE_TAG) as HcmStartPage;
        document.body.append(page);
        await page.updateComplete;
        expect(page.shadowRoot?.querySelector('main')).toBeNull();
        page.remove();
        expect(page.isConnected).toBe(false);
    });
});
