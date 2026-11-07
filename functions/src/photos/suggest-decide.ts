import '../global-options.js';

import {
    FIRESTORE_PATHS,
    cityDocSchema,
    contributorDocSchema,
    photoDocSchema,
    suggestionDocSchema,
    timestampFromDate,
    type CallableRequest,
    type CallableResponse,
    type ContributorDoc,
    type PhotoDoc,
    type SuggestionDoc,
    type SuggestionProposal,
} from '@hcm/shared';

import type { VerifiedCaller } from '../api/access.js';
import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { compact } from '../api/objects.js';
import type { DocumentTransaction } from '../ports/documents.js';
import type { Ports } from '../ports/index.js';
import { onCityMap } from './suggest.js';

export type SuggestDecideDeps = Pick<Ports, 'documents' | 'clock' | 'log'>;

type Request = CallableRequest<'suggestions.decide'>;

const STATUS_OF = { approve: 'approved', adjust: 'adjusted', reject: 'rejected' } as const;

function appliedProposal(data: Request, group: SuggestionDoc): SuggestionProposal | undefined {
    if (data.decision === 'reject') {
        return undefined;
    }
    return data.decision === 'adjust' ? data.adjusted : group.proposal;
}

/** The first credit a group's people asked for, for a photo that has none. */
function creditOf(photo: PhotoDoc, group: SuggestionDoc): string | undefined {
    return photo.credit ?? group.voices.find((voice) => voice.credit !== undefined)?.credit;
}

/**
 * The photo with what was approved, stamped by the reviewer: `history.onPhotoWrite` keeps the version before, and
 * `history.revert` puts it back in one click. A date text is Romanian, as the suggestion was written.
 */
function appliedPhoto(photo: PhotoDoc, group: SuggestionDoc, applied: SuggestionProposal, stamp: Pick<PhotoDoc, 'updatedBy' | 'updatedAt'>): PhotoDoc {
    const { dateText, ...fields } = applied;
    return {
        ...photo,
        ...fields,
        ...compact<Pick<PhotoDoc, 'dateText' | 'credit'>>({
            dateText: dateText === undefined ? photo.dateText : { ro: dateText },
            credit: creditOf(photo, group),
        }),
        ...stamp,
    };
}

function requireOpen(group: SuggestionDoc | undefined): SuggestionDoc {
    if (group === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (group.status !== 'pending') {
        throw new ApiError('apiError.suggestion.alreadyDecided');
    }
    return group;
}

async function applyToPhoto(
    transaction: DocumentTransaction,
    cityId: string,
    group: SuggestionDoc,
    applied: SuggestionProposal,
    stamp: Pick<PhotoDoc, 'updatedBy' | 'updatedAt'>,
): Promise<void> {
    const path = FIRESTORE_PATHS.photo(cityId, group.photoId);
    const [photo, city] = [await transaction.get(path, photoDocSchema), await transaction.get(FIRESTORE_PATHS.city(cityId), cityDocSchema)];
    if (photo === undefined || city === undefined) {
        throw new ApiError('apiError.notFound');
    }
    if (!onCityMap(city, applied.location)) {
        throw new ApiError('apiError.suggestion.outsideCity');
    }
    await transaction.set(path, photoDocSchema, appliedPhoto(photo, group, applied, stamp));
}

/** Decided once, the photo and the group in one transaction: the public photo changes only here. */
async function decide(transaction: DocumentTransaction, data: Request, by: string, now: Date): Promise<void> {
    const path = FIRESTORE_PATHS.suggestion(data.cityId, data.suggestionId);
    const group = requireOpen(await transaction.get(path, suggestionDocSchema));
    const stamp = { updatedBy: by, updatedAt: timestampFromDate(now) };
    const applied = appliedProposal(data, group);
    if (applied !== undefined) {
        await applyToPhoto(transaction, data.cityId, group, applied, stamp);
    }
    await transaction.set(path, suggestionDocSchema, {
        ...group,
        ...compact<Pick<SuggestionDoc, 'applied' | 'note'>>({ applied: data.decision === 'adjust' ? applied : undefined, note: data.note }),
        status: STATUS_OF[data.decision],
        decidedBy: by,
        decidedAt: stamp.updatedAt,
        ...stamp,
    });
}

/**
 * `suggestions.decide` (a city's reviewers; `docs/research/M13-roles.md` §4; S-A63-HAPPY-APPROVE, S-A63-HAPPY-ADJUST,
 * S-A63-HAPPY-REJECT, S-A63-BAD-DECIDED-TWICE): approve applies the proposal, adjust the reviewer's values, reject nothing.
 */
async function decideSuggestion(deps: SuggestDecideDeps, caller: VerifiedCaller, data: Request): Promise<CallableResponse<'suggestions.decide'>> {
    await deps.documents.transaction((transaction) => decide(transaction, data, caller.uid, deps.clock.now()));
    deps.log.info('suggestion decided', { by: caller.uid, cityId: data.cityId, id: data.suggestionId, decision: data.decision });
    return { status: STATUS_OF[data.decision] };
}

function blockedDoc(current: ContributorDoc | undefined, blocked: boolean, by: string, now: Date): ContributorDoc {
    const at = timestampFromDate(now);
    const { blocked: _blocked, blockedBy: _by, blockedAt: _at, ...rest } = current ?? { day: now.toISOString().slice(0, 10), count: 0 };
    return { ...rest, ...(blocked ? { blocked: true, blockedBy: by, blockedAt: at } : {}), updatedBy: by, updatedAt: at };
}

/**
 * `contributors.setBlocked` (a city's reviewers; S-A63-BAD-BLOCKED): an account of this city can no longer suggest or ask for a
 * role, or can again. It takes no role away: that is `admins.revoke`, the owner's.
 */
async function setBlocked(
    deps: SuggestDecideDeps,
    caller: VerifiedCaller,
    data: CallableRequest<'contributors.setBlocked'>,
): Promise<CallableResponse<'contributors.setBlocked'>> {
    const path = FIRESTORE_PATHS.contributor(data.cityId, data.uid);
    await deps.documents.transaction(async (transaction) => {
        const current = await transaction.get(path, contributorDocSchema);
        await transaction.set(path, contributorDocSchema, blockedDoc(current, data.blocked, caller.uid, deps.clock.now()));
    });
    deps.log.info('contributor block changed', { by: caller.uid, cityId: data.cityId, uid: data.uid, blocked: data.blocked });
    return { blocked: data.blocked };
}

/** The `suggestions-decide` and `contributors-setBlocked` callables. */
export function decideFunction(getDeps: () => SuggestDecideDeps & CallableDeps) {
    return defineCallable('suggestions.decide', decideSuggestion, getDeps);
}

export function contributorsFunctions(getDeps: () => SuggestDecideDeps & CallableDeps) {
    return { setBlocked: defineCallable('contributors.setBlocked', setBlocked, getDeps) };
}
