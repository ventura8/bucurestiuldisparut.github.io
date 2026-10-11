/** Wall-clock time, injected so handlers and caches are deterministic under test. */
export interface Clock {
    now(): Date;
}
