// "Use this computer" (finding 72 of 2026-11-02, `packages/admin/src/worker/local.ts`): the starter file from its template,
// the auto-pair over the worker's local `GET /state` and `POST /pair`, Stop using this computer and the Advanced code.
import { describe, expect, it } from 'vitest';

import { createLocal, LOCAL_KEY, LOCAL_WORKER, LocalComputer, osOf, PROBE_MS, starterText } from '../../src/worker/local.js';
import { failure } from '../app/fakes.js';
import { CITY, contentWorld, type ContentWorld } from '../content/world.js';

const PROJECT = 'demo-hcm';
const CODE = 'abcdefghijklmnopqrstuvwxyz';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';
const TEMPLATE = "HCM_PROJECT='__HCM_PROJECT__'\nHCM_CITY='__HCM_CITY__'\nHCM_ACTION='__HCM_ACTION__'\n";

interface Sent {
    readonly url: string;
    readonly init: RequestInit | undefined;
}

/** The page's `fetch` as the tests answer it: the templates next to the admin, and this computer's worker. */
class FakeNet {
    readonly sent: Sent[] = [];
    /** The worker's `GET /state` answer; null: nothing answers on this computer. */
    state: Record<string, unknown> | null = null;
    templates = true;

    readonly fetch = (url: string, init?: RequestInit): Promise<Response> => {
        this.sent.push({ url, init });
        if (url.startsWith(`${LOCAL_WORKER}/`)) {
            return this.#worker(url);
        }
        return Promise.resolve(this.templates ? new Response(TEMPLATE) : new Response('', { status: 404 }));
    };

    #worker(url: string): Promise<Response> {
        if (this.state === null) {
            return Promise.reject(new TypeError('Failed to fetch'));
        }
        return Promise.resolve(url.endsWith('/pair') ? new Response('{}', { status: 202 }) : Response.json(this.state));
    }

    to(path: string): Sent[] {
        return this.sent.filter((sent) => sent.url === `${LOCAL_WORKER}${path}`);
    }
}

function answer(changes: Record<string, unknown> = {}): Record<string, unknown> {
    return { workerId: 'w-0123456789abcdef', signedIn: false, pairable: true, city: CITY, project: PROJECT, ...changes };
}

function localOf(world: ContentWorld, net: FakeNet, userAgent = LINUX): LocalComputer {
    world.callables.answer('worker.pairCode', () => ({ code: CODE, expiresAt: '2025-10-09T08:10:00.000Z' }));
    world.callables.answer('worker.revoke', () => ({ revoked: true }));
    return new LocalComputer(world.services, PROJECT, net.fetch, userAgent);
}

async function settle(): Promise<void> {
    for (let turn = 0; turn < 5; turn += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

describe("this computer's starter file", () => {
    it('happyPath_theSystemIsTheBrowsers', () => {
        expect([osOf(LINUX), osOf(WINDOWS), osOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)')]).toEqual(['linux', 'windows', 'mac']);
    });

    it('happyPath_theTemplateIsFilledAndWindowsGetsItsLineEnds', () => {
        const values = { project: PROJECT, city: CITY, action: 'install' };

        expect(starterText(TEMPLATE, values, 'linux')).toBe(`HCM_PROJECT='${PROJECT}'\nHCM_CITY='${CITY}'\nHCM_ACTION='install'\n`);
        expect(starterText(TEMPLATE, { ...values, action: 'uninstall' }, 'windows')).toBe(
            `HCM_PROJECT='${PROJECT}'\r\nHCM_CITY='${CITY}'\r\nHCM_ACTION='uninstall'\r\n`,
        );
    });

    it('badPath_aValueOfAnotherShapeNeverReachesTheFile', () => {
        expect(starterText(TEMPLATE, { project: "x'; rm -rf ~; '", city: CITY, action: 'install' }, 'linux')).toBeNull();
        expect(starterText(TEMPLATE, { project: PROJECT, city: 'Bucharest!', action: 'install' }, 'linux')).toBeNull();
    });
});

describe('Use this computer and the auto-pair', () => {
    it('happyPath_theFileIsGivenAndAWorkerThatTakesACodeIsPairedThenConnected @S-A62-HAPPY-AUTO-PAIR', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();
        expect(net.sent).toEqual([]);

        const file = await local.intents.use();

        expect(file).toEqual({ name: 'hcm-worker.sh', text: `HCM_PROJECT='${PROJECT}'\nHCM_CITY='${CITY}'\nHCM_ACTION='install'\n` });
        expect(net.sent[0]?.url).toBe('/worker/hcm-worker.sh');
        expect(world.services.local.get(LOCAL_KEY)).toBe(CITY);
        expect(local.state.phase).toBe('downloaded');
        await settle();
        // Nothing answers yet (the file is not run): the next look comes PROBE_MS later.
        net.state = answer();
        world.clock.advance(PROBE_MS);
        await settle();

        expect(local.state.phase).toBe('connecting');
        expect(world.callables.calls.find((call) => call.name === 'worker.pairCode')?.request).toEqual({ cityId: CITY });
        const posted = net.to('/pair');
        expect(posted).toHaveLength(1);
        expect(posted[0]?.init).toMatchObject({ method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json' } });
        const body = posted[0]?.init?.body;
        expect(JSON.parse(typeof body === 'string' ? body : '{}')).toEqual({ code: CODE });

        net.state = answer({ signedIn: true, pairable: false });
        world.clock.advance(PROBE_MS);
        await settle();
        expect(local.state.phase).toBe('connected');
        expect(net.to('/pair')).toHaveLength(1);
        local.stop();
        world.clock.advance(PROBE_MS * 3);
        await settle();
        expect(net.to('/state')).toHaveLength(3);
    });

    it('badPath_aWorkerOfAnotherCityOrOneThatTakesNoCodeIsNotPaired @S-A62-BAD-AUTO-PAIR', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer({ city: 'iasi' });
        const local = localOf(world, net);

        local.start();
        await settle();
        net.state = answer({ pairable: false, lastError: 'apiError.worker.revoked' });
        world.clock.advance(PROBE_MS);
        await settle();
        net.state = { not: 'a state' };
        world.clock.advance(PROBE_MS);
        await settle();

        expect(world.callables.named('worker.pairCode')).toBe(0);
        expect(net.to('/pair')).toEqual([]);
        expect(local.state.phase).toBe('downloaded');
        local.stop();
    });

    it('badPath_aCodeIsPostedAgainOnlyAMinuteLaterAndARefusedCodeIsLogged', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer();
        const local = localOf(world, net);
        world.callables.fail('worker.pairCode', failure('permission-denied', 'apiError.notAdmin'));

        local.start();
        await settle();
        world.clock.advance(PROBE_MS);
        await settle();

        expect(world.callables.named('worker.pairCode')).toBe(1);
        expect(net.to('/pair')).toEqual([]);
        expect(local.state.phase).toBe('connecting');
        world.callables.answer('worker.pairCode', () => ({ code: CODE, expiresAt: '2025-10-09T08:10:00.000Z' }));
        world.clock.advance(60_000);
        await settle();
        expect(net.to('/pair')).toHaveLength(1);
        local.stop();
    });

    it('badPath_aTemplateThatCannotBeReadGivesNoFile', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        net.templates = false;
        const local = localOf(world, net);

        expect(await local.intents.use()).toBeNull();
        expect(local.state.phase).toBe('failed');
        expect(world.services.local.get(LOCAL_KEY)).toBeNull();

        const offline = new LocalComputer(world.services, PROJECT, () => Promise.reject(new TypeError('offline')), LINUX);
        expect(await offline.intents.stop()).toBeNull();
        expect(offline.state.phase).toBe('failed');
    });
});

describe('Stop using this computer and the Advanced command', () => {
    it('happyPath_theRemovalFileIsGivenAndTheComputersWorkerDisconnected @S-A62-HAPPY-STOP-COMPUTER', async () => {
        const world = contentWorld();
        world.services.local.set(LOCAL_KEY, CITY);
        const net = new FakeNet();
        net.state = answer({ signedIn: true, pairable: false });
        const local = localOf(world, net, WINDOWS);
        local.start();
        await settle();
        expect(local.state).toMatchObject({ os: 'windows', phase: 'connected' });

        const file = await local.intents.stop();

        expect(file).toEqual({
            name: 'hcm-worker-remove.bat',
            text: `HCM_PROJECT='${PROJECT}'\r\nHCM_CITY='${CITY}'\r\nHCM_ACTION='uninstall'\r\n`,
        });
        expect(net.sent.at(-1)?.url).toBe('/worker/hcm-worker.bat');
        expect(world.callables.calls.find((call) => call.name === 'worker.revoke')?.request).toEqual({
            cityId: CITY,
            workerId: 'w-0123456789abcdef',
        });
        expect(world.services.local.get(LOCAL_KEY)).toBeNull();
        expect(local.state.phase).toBe('stopped');
        world.clock.advance(PROBE_MS * 2);
        await settle();
        expect(net.to('/state')).toHaveLength(1);
    });

    it('badPath_noWorkerAnsweredSoNothingIsDisconnectedAndTheMacFileIsACommand', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_1)');

        expect((await local.intents.stop())?.name).toBe('hcm-worker-remove.command');
        expect(world.callables.named('worker.revoke')).toBe(0);
    });

    it('happyPath_advancedMintsItsCodeAndRenewsItWhileShown @S-A62-HAPPY-PAIR', async () => {
        const world = contentWorld();
        const net = new FakeNet();
        const local = localOf(world, net);
        local.start();

        await local.intents.command();
        expect(local.state.code).toBe(CODE);
        world.clock.advance(9 * 60_000);
        await settle();
        expect(world.callables.named('worker.pairCode')).toBe(2);

        local.stop();
        world.clock.advance(9 * 60_000);
        await settle();
        expect(world.callables.named('worker.pairCode')).toBe(2);
        world.callables.fail('worker.pairCode', failure('permission-denied', 'apiError.notAdmin'));
        await local.intents.command();
        expect(local.state.code).toBeNull();
    });

    it('happyPath_thePagesFetchAndSystemAreTheDefaults', () => {
        const local = createLocal(contentWorld().services, PROJECT);
        local.intents.setOs('mac');

        expect(local.state.os).toBe('mac');
    });
});
