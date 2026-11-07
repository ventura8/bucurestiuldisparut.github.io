/**
 * What the owner chose (`docs/research/M14-start-your-map.md` §7): kept in the tab's `sessionStorage` before any redirect
 * so a consent round trip or a reload loses nothing. It holds no token. Read through its schema: a value that is not one
 * counts as none.
 */
import { startFirstCitySchema, PROJECT_ID_PATTERN } from '@hcm/shared';
import { z } from 'zod';

import type { KeyValueStore } from '../app/ports.js';

const PLAN_KEY = 'hcm:start:plan';
const STATE_KEY = 'hcm:start:state';

const planSchema = z.strictObject({
    projectId: z.string().regex(PROJECT_ID_PATTERN),
    displayName: z.string().trim().min(4).max(30),
    /** False: the owner picked a project they have; it is never created. */
    create: z.boolean(),
    city: startFirstCitySchema,
});

export type StartPlan = z.infer<typeof planSchema>;

export function parsePlan(value: unknown): StartPlan | null {
    const parsed = planSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

function parseJson(text: string | null): unknown {
    try {
        return text === null ? null : (JSON.parse(text) as unknown);
    } catch {
        return null;
    }
}

export function loadPlan(session: KeyValueStore): StartPlan | null {
    return parsePlan(parseJson(session.get(PLAN_KEY)));
}

export function savePlan(session: KeyValueStore, plan: StartPlan): void {
    session.set(PLAN_KEY, JSON.stringify(plan));
}

export function clearPlan(session: KeyValueStore): void {
    session.remove(PLAN_KEY);
}

/** The state of the consent under way. */
export function rememberState(session: KeyValueStore, state: string): void {
    session.set(STATE_KEY, state);
}

/** The state of the consent under way; it is good once. */
export function takeState(session: KeyValueStore): string | null {
    const state = session.get(STATE_KEY);
    session.remove(STATE_KEY);
    return state;
}
