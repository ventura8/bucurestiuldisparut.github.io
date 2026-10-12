import type { Locator } from '@playwright/test';

/**
 * The admin-input budget (docs/research/design-review-testability.md §4.3, PLAN "minimum admin input"): a flow
 * declares how many human inputs it may take, every fill, click and file choice goes through the flow, and the test
 * fails at teardown when a flow used more than its budget. Used by the admin tiers from M2, for example the Mapbox
 * setup (at most 2 inputs) or importing a free scene (at most 2 clicks).
 */

export interface InputFlow {
    readonly name: string;
    readonly limit: number;
    readonly used: number;
    fill(locator: Locator, value: string): Promise<void>;
    click(locator: Locator): Promise<void>;
    setInputFiles(locator: Locator, files: string | readonly string[]): Promise<void>;
}

export class InputBudget {
    readonly #flows: InputFlow[] = [];

    /** A new counted flow of at most `limit` inputs. */
    flow(name: string, limit: number): InputFlow {
        let used = 0;
        const count = (): void => {
            used += 1;
        };
        const flow: InputFlow = {
            name,
            limit,
            get used() {
                return used;
            },
            fill: async (locator, value) => {
                count();
                await locator.fill(value);
            },
            click: async (locator) => {
                count();
                await locator.click();
            },
            setInputFiles: async (locator, files) => {
                count();
                await locator.setInputFiles(typeof files === 'string' ? files : [...files]);
            },
        };
        this.#flows.push(flow);
        return flow;
    }

    /** `name: used/limit` for every flow over its budget. */
    overruns(): string[] {
        return this.#flows
            .filter((flow) => flow.used > flow.limit)
            .map((flow) => `${flow.name}: ${String(flow.used)}/${String(flow.limit)}`);
    }
}
