import { onBudgetFunction } from './budget.js';
import { tickFunction, type OpsDeps } from './tick.js';

/**
 * The `ops.*` functions under their registry names (`docs/research/M2-interfaces.md` §3.7): the scheduled `tick` and
 * the budget alert `onBudget`. The integrator exports them as the `ops` group (`export const ops = opsFunctions(getDeps)`).
 */
export function opsFunctions(getDeps: () => OpsDeps) {
    return { tick: tickFunction(getDeps), onBudget: onBudgetFunction(getDeps) };
}
