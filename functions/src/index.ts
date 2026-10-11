/**
 * The deployed functions: exports only. Firebase names a function after its export path, so the
 * namespace `setup` with its `status` export deploys as `setup-status` (client: httpsCallable(fns,
 * 'setup-status')). Logic lives in handlers/, wiring in triggers/ and deps.ts.
 */
export * as setup from './triggers/setup.js';
