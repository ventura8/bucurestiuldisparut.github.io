/**
 * The Firebase SDK modules of the viewer, in one lazily imported chunk (`loadFirebaseSdk` in `telemetry.ts`): only
 * firebase/app, firebase/analytics and firebase/performance, never a data SDK (the viewer never reads Firestore). The
 * ES module build emits this as its own file, fetched only after consent; see docs/research/M1-interfaces.md CR-10 for
 * the IIFE build.
 */
import { getApps, initializeApp } from 'firebase/app';
import { initializeAnalytics, isSupported, logEvent, setAnalyticsCollectionEnabled, setConsent } from 'firebase/analytics';
import { initializePerformance } from 'firebase/performance';

import type { FirebaseSdk } from './analytics.js';

export const firebaseSdk: FirebaseSdk = {
    getApps,
    initializeApp,
    isSupported,
    setConsent,
    initializeAnalytics,
    logEvent,
    setAnalyticsCollectionEnabled,
    initializePerformance,
};
