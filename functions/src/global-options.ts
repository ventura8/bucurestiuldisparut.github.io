import { setGlobalOptions, type GlobalOptions } from 'firebase-functions/options';

/**
 * Defaults for every function (docs/research/PLAN.md "Region"; security review §3.4): everything in
 * us-central1, next to the nam5 Firestore and inside the free tier, and a low instance cap as a
 * spend guard (callables lower it further). Every trigger module imports this file first, because
 * firebase-functions reads the global options when a function is declared. The runtime service
 * accounts (fn-admin@, fn-events@) are set per function once the bootstrap creates them (M2).
 */
export const GLOBAL_OPTIONS: GlobalOptions = { region: 'us-central1', maxInstances: 5 };

setGlobalOptions(GLOBAL_OPTIONS);
