import { FakeMap, FakeMapboxGl } from '@hcm/test-support/fake-map';
import { describe, expect, it } from 'vitest';

import {
    comparePlugin,
    COMPARE_PLUGIN_VERSION,
    COMPARE_SCRIPT_URL,
    COMPARE_STYLE_URL,
    openCompare,
    type CompareDeps,
    type CompareSession,
} from '../../src/map/compare.js';
import type { MapOptions, MapPort } from '../../src/map/map-port.js';
import { createMapboxPort } from '../../src/map/mapbox-adapter.js';
import { fakeAdapterEnv, settle } from './support.js';

const OPTIONS: MapOptions = {
    style: 'mapbox://styles/mapbox/standard',
    accessToken: 'pk.test',
    view: { center: [26.08, 44.42], zoom: 14, bearing: 0 },
    minZoom: 10,
    maxZoom: 20,
    locale: 'ro',
    reducedMotion: false,
};

class FakeElement {
    readonly tag: string;
    className = '';
    rel = '';
    href = '';
    src = '';
    crossOrigin: string | null = null;
    removed = false;
    readonly children: FakeElement[] = [];
    readonly #listeners = new Map<string, () => void>();

    constructor(tag: string) {
        this.tag = tag;
    }

    addEventListener(type: string, listener: () => void): void {
        this.#listeners.set(type, listener);
    }

    dispatch(type: string): void {
        this.#listeners.get(type)?.();
    }

    append(child: FakeElement): void {
        this.children.push(child);
    }

    remove(): void {
        this.removed = true;
    }
}

class FakeCompare {
    static readonly created: FakeCompare[] = [];
    readonly args: readonly unknown[];
    readonly sliders: number[] = [];
    removed = false;
    #slideEnd: ((event: { readonly currentPosition: number }) => void) | null = null;

    constructor(...args: readonly unknown[]) {
        this.args = args;
        FakeCompare.created.push(this);
    }

    setSlider(position: number): void {
        this.sliders.push(position);
    }

    on(_type: 'slideend', listener: (event: { readonly currentPosition: number }) => void): void {
        this.#slideEnd = listener;
    }

    slide(position: number): void {
        this.#slideEnd?.({ currentPosition: position });
    }

    remove(): void {
        this.removed = true;
    }
}

interface Setup {
    readonly deps: CompareDeps;
    readonly gl: FakeMapboxGl;
    readonly head: FakeElement;
    readonly container: FakeElement;
    readonly main: MapPort;
    readonly ports: MapPort[];
}

async function setup(
    options: { readonly plugin?: 'loads' | 'slow' | 'fails' | 'missing' | 'ready'; readonly secondFails?: boolean } = {},
): Promise<Setup> {
    const gl = new FakeMapboxGl();
    const plugin = options.plugin ?? 'loads';
    if (plugin === 'ready') {
        gl.Compare = FakeCompare;
    }
    const head = new FakeElement('head');
    const loadEvent = (child: FakeElement): void => {
        if (child.tag === 'script' && (plugin === 'loads' || plugin === 'slow')) {
            gl.Compare = FakeCompare;
        }
        child.dispatch(plugin === 'fails' && child.tag === 'script' ? 'error' : 'load');
    };
    head.append = (child: FakeElement): void => {
        head.children.push(child);
        if (plugin === 'slow') {
            queueMicrotask(() => {
                loadEvent(child);
            });
        } else {
            loadEvent(child);
        }
    };
    const ports: MapPort[] = [];
    const deps: CompareDeps = {
        gl,
        createPort: () => {
            const port = createMapboxPort(gl, fakeAdapterEnv());
            ports.push(port);
            return port;
        },
        document: { createElement: (tag: string) => new FakeElement(tag), head } as unknown as CompareDeps['document'],
    };
    const main = createMapboxPort(gl, fakeAdapterEnv());
    const mounting = main.mount({} as HTMLElement, OPTIONS);
    gl.map.fire('load');
    await mounting;
    const container = new FakeElement('div');
    if (options.secondFails === true) {
        const original = deps.createPort;
        Object.assign(deps, {
            createPort: () => {
                const port = original();
                const mount = port.mount.bind(port);
                port.mount = async (element, mapOptions) => {
                    const pending = mount(element, mapOptions);
                    gl.map.fire('error', { error: new Error('style 500') });
                    await pending;
                };
                return port;
            },
        });
    }
    return { deps, gl, head, container, main, ports };
}

async function open(parts: Setup): Promise<CompareSession> {
    const opening = openCompare(parts.main, { container: parts.container as unknown as HTMLElement, map: OPTIONS }, parts.deps);
    await settle();
    parts.gl.map.fire('load');
    return await opening;
}

describe('swipe compare', () => {
    it('happyPath_aSecondMapExistsOnlyWhileComparing', async () => {
        const parts = await setup();
        const before = parts.gl.maps.length;
        parts.main.flyTo({ zoom: 16 }, { animate: false });

        const session = await open(parts);

        expect(parts.gl.maps).toHaveLength(before + 1);
        const compare = FakeCompare.created.at(-1);
        const [first, second, container, settings] = compare?.args ?? [];
        expect(first).toBe(parts.gl.maps[0]);
        expect(second).toBe(parts.gl.map);
        expect(container).toBe(parts.container);
        expect(settings).toEqual({ orientation: 'vertical', mousemove: false });
        expect(parts.gl.map.options.zoom).toBe(16);
        expect(parts.head.children.map((child) => [child.tag, child.href || child.src])).toEqual([
            ['link', COMPARE_STYLE_URL],
            ['script', COMPARE_SCRIPT_URL],
        ]);
        expect(COMPARE_PLUGIN_VERSION).toBe('0.6.0');
        expect(parts.container.children[0]?.className).toBe('hcm-compare-map');
        const heard: number[] = [];
        const stop = session.onSlideEnd((position) => heard.push(position));
        compare?.slide(120);
        stop();
        compare?.slide(130);
        session.setSlider(200);
        expect(heard).toEqual([120]);
        expect(compare?.sliders).toEqual([200]);

        session.close();
        session.close();
        session.setSlider(300);

        expect(compare?.removed).toBe(true);
        expect(compare?.sliders).toEqual([200]);
        expect(parts.gl.map.removed).toBe(true);
        expect(parts.container.children[0]?.removed).toBe(true);
        expect(parts.gl.maps[0]?.removed).toBe(false);
    });

    it('happyPath_thePluginLoadsOnceAndAHorizontalSplitIsPossible', async () => {
        const parts = await setup({ plugin: 'ready' });

        const opening = openCompare(
            parts.main,
            { container: parts.container as unknown as HTMLElement, map: OPTIONS, orientation: 'horizontal' },
            parts.deps,
        );
        await settle();
        parts.gl.map.fire('load');
        const session = await opening;

        expect(parts.head.children).toEqual([]);
        expect(FakeCompare.created.at(-1)?.args[3]).toEqual({ orientation: 'horizontal', mousemove: false });
        session.close();
    });

    it('badPath_aPluginThatFailsToLoadLeavesNothingAndIsRetried', async () => {
        const parts = await setup({ plugin: 'fails' });

        await expect(
            openCompare(parts.main, { container: parts.container as unknown as HTMLElement, map: OPTIONS }, parts.deps),
        ).rejects.toThrow('compare plugin failed to load');
        await expect(comparePlugin(parts.deps)).rejects.toThrow('compare plugin failed to load');

        expect(parts.container.children).toEqual([]);
        expect(parts.head.children.filter((child) => child.tag === 'script')).toHaveLength(2);
    });

    it('happyPath_twoCallsWhileLoadingShareOneLoad', async () => {
        const parts = await setup({ plugin: 'slow' });

        const [first, second] = await Promise.all([comparePlugin(parts.deps), comparePlugin(parts.deps)]);

        expect(first).toBe(second);
        expect(parts.head.children.filter((child) => child.tag === 'script')).toHaveLength(1);
    });

    it('badPath_aScriptThatDoesNotRegisterThePluginIsAnError', async () => {
        const parts = await setup({ plugin: 'missing' });

        await expect(comparePlugin(parts.deps)).rejects.toThrow('did not register');
    });

    it('badPath_compareNeedsAMountedMainMap', async () => {
        const parts = await setup({ plugin: 'ready' });

        await expect(
            openCompare(new FakeMap(), { container: parts.container as unknown as HTMLElement, map: OPTIONS }, parts.deps),
        ).rejects.toThrow('mounted map');
    });

    it('badPath_aSecondMapThatFailsIsRemovedWithItsContainer', async () => {
        const parts = await setup({ plugin: 'ready', secondFails: true });

        await expect(
            openCompare(parts.main, { container: parts.container as unknown as HTMLElement, map: OPTIONS }, parts.deps),
        ).rejects.toThrow('style');

        expect(parts.container.children[0]?.removed).toBe(true);
        expect(parts.gl.map.removed).toBe(true);
    });

    it('badPath_aSecondPortWithoutAMapboxMapIsRefused', async () => {
        const parts = await setup({ plugin: 'ready' });
        const deps = { ...parts.deps, createPort: () => new FakeMap() };

        await expect(openCompare(parts.main, { container: parts.container as unknown as HTMLElement, map: OPTIONS }, deps)).rejects.toThrow(
            'Mapbox map',
        );
        expect(parts.container.children[0]?.removed).toBe(true);
    });
});
