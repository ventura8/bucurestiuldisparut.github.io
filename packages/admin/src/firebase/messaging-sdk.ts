/**
 * `firebase/messaging`, in its own lazily imported module (`loadMessagingSdk` in `messaging.ts`): the build emits it as a
 * separate chunk, fetched only when an admin turns notifications on for a browser (`docs/research/M4-interfaces.md` §5.4).
 * The browser registers its Firebase installation ID (`register`, `onRegistered`); firebase 13 deprecates `getToken`.
 */
import { getMessaging, onRegistered, register } from 'firebase/messaging';

export const messagingSdk = { getMessaging, register, onRegistered };
