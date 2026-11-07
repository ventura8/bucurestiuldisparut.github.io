import '../global-options.js';

import { createHash } from 'node:crypto';

import {
    FIRESTORE_PATHS,
    PHOTO_LOCATION_SLACK_DEG,
    SUGGESTIONS_PER_DAY,
    SUGGESTION_BEARING_STEP,
    SUGGESTION_GRID_DEGREES,
    SUGGESTION_MAX_ACCOUNTS,
    SUGGESTION_MAX_REASONS,
    bboxContains,
    bboxExpand,
    bboxFromRecord,
    cityDocSchema,
    contributorDocSchema,
    isReviewCleared,
    photoDocSchema,
    suggestionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type CityDoc,
    type ContributorDoc,
    type PhotoDoc,
    type SuggestionDoc,
    type SuggestionProposal,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { emitNotification } from '../api/notification-event.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';

export type SuggestDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'suggestions.submit'>;

/** Whether `location` lies on the city's map: the bounds and the slack the manifest allows a photo. */
export function onCityMap(city: CityDoc, location: SuggestionProposal['location']): boolean {
    if (location === undefined) {
        return true;
    }
    return bboxContains(bboxExpand(bboxFromRecord(city.bounds), PHOTO_LOCATION_SLACK_DEG), [location.lng, location.lat]);
}

/** The cell of the grid a coordinate falls in. */
function cell(value: number): number {
    return Math.floor(value / SUGGESTION_GRID_DEGREES);
}

/**
 * M13 §4: the group of a proposal: the same photo, the same kind, the same cell of the map, the same sector of direction, the
 * same date. Repeats land on one document.
 */
export function suggestionGroupId(request: Pick<Request, 'photoId' | 'kind' | 'proposal'>): string {
    const { location, bearing, year, yearEnd, dateText } = request.proposal;
    const key = [
        request.photoId,
        request.kind,
        location === undefined ? '' : `${String(cell(location.lat))},${String(cell(location.lng))}`,
        bearing === undefined ? '' : String(Math.floor(bearing / SUGGESTION_BEARING_STEP)),
        year ?? '',
        yearEnd ?? '',
        dateText ?? '',
    ].join('|');
    return createHash('sha256').update(key).digest('hex').slice(0, 40);
}

/** A place is for a photo with none, a correction for a photo that has one. Only what the public sees can be suggested on. */
function requireTarget(photo: PhotoDoc | undefined, kind: Request['kind']): void {
    if (photo?.published !== true || !isReviewCleared(photo) || photo.image === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if ((kind === 'place') !== (photo.location === undefined)) {
        throw new ApiError('apiError.suggestion.wrongKind');
    }
}

function differs(current: unknown, proposed: unknown): boolean {
    return proposed !== undefined && JSON.stringify(current) !== JSON.stringify(proposed);
}

/** What the photo already says is no suggestion. */
function requireChange(photo: PhotoDoc, proposal: SuggestionProposal): void {
    const changes =
        differs(photo.location, proposal.location) ||
        differs(photo.bearing, proposal.bearing) ||
        differs(photo.year, proposal.year) ||
        differs(photo.yearEnd, proposal.yearEnd) ||
        differs(photo.dateText?.ro, proposal.dateText);
    if (!changes) {
        throw new ApiError('apiError.suggestion.noChange');
    }
}

/** Today's count of the account; refuses a blocked account and the one over its limit. */
function countedToday(contributor: ContributorDoc | undefined, today: string): number {
    if (contributor?.blocked === true) {
        throw new ApiError('apiError.contribute.blocked');
    }
    const used = contributor?.day === today ? contributor.count : 0;
    if (used >= SUGGESTIONS_PER_DAY) {
        throw new ApiError('apiError.suggestion.dailyLimit', { max: String(SUGGESTIONS_PER_DAY) });
    }
    return used + 1;
}

interface Submission {
    readonly data: Request;
    readonly caller: VerifiedCaller;
    readonly now: Date;
}

function voiceOf({ data, caller, now }: Submission): SuggestionDoc['voices'][number] {
    return compact<SuggestionDoc['voices'][number]>({
        uid: caller.uid,
        reason: data.reason,
        sourceUrl: data.sourceUrl,
        credit: data.credit,
        at: timestampFromDate(now),
    });
}

function newGroup(submission: Submission): SuggestionDoc {
    const { data, caller, now } = submission;
    const at = timestampFromDate(now);
    return {
        photoId: data.photoId,
        kind: data.kind,
        proposal: data.proposal,
        status: 'pending',
        count: 1,
        accounts: [caller.uid],
        voices: [voiceOf(submission)],
        createdAt: at,
        updatedBy: caller.uid,
        updatedAt: at,
    };
}

/**
 * One more person in the group: counted once per account, their words kept while there is room. A decided group changes by
 * nothing but the count, so a repeat after a refusal reopens nothing.
 */
function joined(group: SuggestionDoc, submission: Submission): SuggestionDoc {
    const { caller, now } = submission;
    if (group.accounts.includes(caller.uid)) {
        return group;
    }
    const open = group.status === 'pending';
    return {
        ...group,
        count: group.count + 1,
        accounts: group.accounts.length < SUGGESTION_MAX_ACCOUNTS ? [...group.accounts, caller.uid] : group.accounts,
        voices: open && group.voices.length < SUGGESTION_MAX_REASONS ? [...group.voices, voiceOf(submission)] : group.voices,
        updatedBy: caller.uid,
        updatedAt: timestampFromDate(now),
    };
}

/** The limit and the group in one transaction. Whether the group is new is what the reviewers are told about. */
async function record(transaction: DocumentTransaction, submission: Submission, groupId: string): Promise<{ readonly isNew: boolean; readonly used: number }> {
    const { data, caller, now } = submission;
    const counter = FIRESTORE_PATHS.contributor(data.cityId, caller.uid);
    const today = now.toISOString().slice(0, 10);
    const contributor = await transaction.get(counter, contributorDocSchema);
    const used = countedToday(contributor, today);
    const groupPath = FIRESTORE_PATHS.suggestion(data.cityId, groupId);
    const group = await transaction.get(groupPath, suggestionDocSchema);
    const stamp = { updatedBy: caller.uid, updatedAt: timestampFromDate(now) };
    await transaction.set(counter, contributorDocSchema, { ...contributor, day: today, count: used, ...stamp });
    await transaction.set(groupPath, suggestionDocSchema, group === undefined ? newGroup(submission) : joined(group, submission));
    return { isNew: group === undefined, used };
}

/**
 * `suggestions.submit` (any verified Google account, no role; `docs/research/M13-roles.md` §4; S-A63-HAPPY-PLACE,
 * S-A63-HAPPY-CORRECTION, S-A63-BAD-DAILY-LIMIT, S-A63-BAD-BLOCKED, S-A63-BAD-OUTSIDE, S-A63-HAPPY-GROUP): a place for an unplaced
 * photo, or a contested date, location or direction of a placed one, on public photos only. Nothing public changes here. A
 * repeat of a decided proposal is answered like any other.
 */
async function submitSuggestion(deps: SuggestDeps, caller: VerifiedCaller, data: Request): Promise<CallableResponse<'suggestions.submit'>> {
    const [photo, city] = await Promise.all([
        deps.documents.get(FIRESTORE_PATHS.photo(data.cityId, data.photoId), photoDocSchema),
        deps.documents.get(FIRESTORE_PATHS.city(data.cityId), cityDocSchema),
    ]);
    requireTarget(photo, data.kind);
    requireChange(photo as PhotoDoc, data.proposal);
    if (city === undefined || !onCityMap(city, data.proposal.location)) {
        throw new ApiError('apiError.suggestion.outsideCity');
    }
    const groupId = suggestionGroupId(data);
    const submission = { data, caller, now: deps.clock.now() };
    const { isNew, used } = await deps.documents.transaction((transaction) => record(transaction, submission, groupId));
    if (isNew) {
        await emitNotification(deps, 'photos', { kind: 'suggestion.waiting', parts: [data.cityId, groupId], link: '#/review', cityId: data.cityId });
    }
    deps.log.info('suggestion received', { cityId: data.cityId, photoId: data.photoId, kind: data.kind, group: groupId, isNew });
    return { received: true, remainingToday: Math.max(0, SUGGESTIONS_PER_DAY - used) };
}

/** The `suggestions-submit` callable. */
export function submitFunction(getDeps: () => SuggestDeps & CallableDeps) {
    return defineCallable('suggestions.submit', submitSuggestion, getDeps);
}
