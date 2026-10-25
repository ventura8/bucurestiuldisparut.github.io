/**
 * Firebase Cloud Messaging HTTP v1 (M4, `docs/research/M4-interfaces.md` §5.4): web push to the browsers an admin allowed
 * (`admins/{uid}/pushDevices`), through firebase-admin's `getMessaging()` with the functions' service account (no server
 * key). A message carries the item's localized title and text and its admin link as data (`webpush.fcmOptions.link`);
 * nothing in it is HTML. Adapter `functions/src/adapters/fcm.ts` (assists-notify); failures are
 * `UpstreamError('fcm', …)`, except the per-token outcome below.
 */
interface PushMessage {
    readonly title: string;
    readonly body: string;
    /** An admin route (`ADMIN_LINK_PATTERN`) on the admin's own origin. */
    readonly link: string;
    /** Collapses repeats of one event on a device (the event id). */
    readonly tag: string;
}

/** Per token: delivered to FCM, or refused because the token is gone (`messaging/registration-token-not-registered`). */
interface PushOutcome {
    readonly sent: number;
    /** Tokens FCM no longer knows: their device documents are deleted. */
    readonly unregistered: readonly string[];
}

export interface PushSender {
    send(tokens: readonly string[], message: PushMessage): Promise<PushOutcome>;
    /** A dry-run send (`validateOnly`): whether FCM accepts the token, before it is stored. */
    validate(token: string): Promise<boolean>;
}
