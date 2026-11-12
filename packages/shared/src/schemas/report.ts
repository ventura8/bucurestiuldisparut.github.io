/**
 * "Report a problem" (beta.1 Q1; `docs/research/M2-interfaces.md` §3.5): what a visitor of the public map sends about the
 * app or about one photo, place, story or layer, and how the city keeps it. The viewer never touches Firestore: it POSTs
 * a {@link ReportSubmission} to the public `reports.submit` endpoint, which checks it and writes one
 * `cities/{city}/reports/{id}` ({@link ReportDoc}). Only the city's reviewers (owner, editor, moderator) read a report,
 * mark it done or delete it (`firebase/firestore.rules`). Every text is plain text, shown with text bindings only.
 */
import { z } from 'zod';

import { LOCALES } from '../i18n/index.js';

import { stamp, timestampSchema } from './firestore-common.js';
import { CITY_ID_PATTERN, httpsUrlSchema, idSchema, plainText, yearSchema } from './primitives.js';

/** What is wrong: the app does not work right, the content is wrong, or a rights or takedown request. */
export const REPORT_TYPES = ['app', 'content', 'rights'] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

/** What a report is about: the map as a whole, or one item of it. */
export const REPORT_SUBJECTS = ['map', 'photo', 'poi', 'story', 'layer'] as const;
export type ReportSubjectKind = (typeof REPORT_SUBJECTS)[number];

/** `open` waits for the map's team; `done` was dealt with. */
export const REPORT_STATUSES = ['open', 'done'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The longest description, and the longest title of the item a report names. */
export const MAX_REPORT_TEXT = 2000;
export const MAX_REPORT_TITLE = 200;

/** A request body over this many bytes is refused before it is parsed (413). */
export const REPORT_MAX_BYTES = 8192;

/**
 * The endpoint's limits (per function instance, in fixed one-hour windows; `functions/src/reports/submit.ts`): one visitor's
 * address, and every visitor together, so a flood can neither fill the inbox nor the bill.
 */
export const REPORT_LIMITS = { perClientPerHour: 5, perInstancePerHour: 100 } as const;

/** The item a report is about, as the map showed it when the visitor wrote: its id, its title and its year. */
export const reportSubjectSchema = z.strictObject({
    kind: z.enum(REPORT_SUBJECTS),
    id: idSchema.optional(),
    title: plainText(MAX_REPORT_TITLE).optional(),
    year: yearSchema.optional(),
});
export type ReportSubject = z.infer<typeof reportSubjectSchema>;

/** The parts a visitor's report and the stored report share. */
const reportFields = {
    type: z.enum(REPORT_TYPES),
    about: reportSubjectSchema,
    /** The map's address with its view, on the site the report came from (the endpoint checks its origin). */
    link: httpsUrlSchema,
    description: plainText(MAX_REPORT_TEXT),
    /** Only to answer the visitor, and only when they gave it. */
    email: z.email().max(254).optional(),
    locale: z.enum(LOCALES),
};

/**
 * The body of `reports.submit`. `website` is a field no person sees (a honeypot): a robot that fills it is answered as if
 * the report was taken, and nothing is stored.
 */
export const reportSubmissionSchema = z.strictObject({
    cityId: z.string().regex(CITY_ID_PATTERN),
    ...reportFields,
    website: z.string().max(200).optional(),
});
export type ReportSubmission = z.infer<typeof reportSubmissionSchema>;

/** `cities/{city}/reports/{id}`: written by `reports.submit`; the city's reviewers change `status` or delete it. */
export const reportDocSchema = z.strictObject({
    ...reportFields,
    status: z.enum(REPORT_STATUSES),
    createdAt: timestampSchema,
    ...stamp,
});
export type ReportDoc = z.infer<typeof reportDocSchema>;

