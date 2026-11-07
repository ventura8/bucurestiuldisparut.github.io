/** The review queue's rows from its documents (M13, `docs/research/M13-roles.md` §8), pure. */
import type { PhotoDoc, PoiDoc, RoleRequestDoc, SuggestionDoc, SuggestionProposal } from '@hcm/shared';

import type { Stored } from '../content/services.js';
import type { MapPhoto } from '../photos/map.js';

export interface ReviewItem {
    readonly entity: 'photo' | 'poi';
    readonly id: string;
    readonly title: { readonly ro: string; readonly en?: string | undefined };
    readonly thumbPath: string | null;
    readonly credit: string | null;
}

export interface ReviewSuggestion {
    readonly id: string;
    readonly photoId: string;
    readonly title: SuggestionDoc['photoTitle'];
    readonly thumb: string;
    readonly kind: SuggestionDoc['kind'];
    readonly status: SuggestionDoc['status'];
    readonly proposal: SuggestionProposal;
    readonly count: number;
    readonly voices: readonly {
        readonly uid: string;
        readonly reason: string | null;
        readonly sourceUrl: string | null;
        readonly credit: string | null;
    }[];
    readonly decidedBy: string | null;
}

export interface ReviewRequest {
    readonly uid: string;
    readonly role: RoleRequestDoc['role'];
    readonly reason: string;
    readonly credit: string | null;
    readonly name: string;
    readonly email: string;
}

export function photoItem(stored: Stored<PhotoDoc>): ReviewItem {
    const { data, id } = stored;
    return { entity: 'photo', id, title: data.title, thumbPath: data.heldImage?.thumb ?? null, credit: data.credit ?? null };
}

export function poiItem(stored: Stored<PoiDoc>): ReviewItem {
    const { data, id } = stored;
    return { entity: 'poi', id, title: data.title, thumbPath: null, credit: data.credit ?? null };
}

export function suggestionRow(stored: Stored<SuggestionDoc>): ReviewSuggestion {
    const { data, id } = stored;
    return {
        id,
        photoId: data.photoId,
        title: data.photoTitle,
        thumb: data.photoThumb,
        kind: data.kind,
        status: data.status,
        proposal: data.proposal,
        count: data.count,
        voices: data.voices.map((voice) => ({
            uid: voice.uid,
            reason: voice.reason ?? null,
            sourceUrl: voice.sourceUrl ?? null,
            credit: voice.credit ?? null,
        })),
        decidedBy: data.decidedBy ?? null,
    };
}

export function requestRow(stored: Stored<RoleRequestDoc>): ReviewRequest {
    const { data, id } = stored;
    return {
        uid: id,
        role: data.role,
        reason: data.reason,
        credit: data.credit ?? null,
        name: data.displayName ?? '',
        email: data.email ?? '',
    };
}

/** What the photo says now, in a proposal's words. */
export function currentOf(photo: PhotoDoc): SuggestionProposal {
    const { location, bearing, year, yearEnd, dateText } = photo;
    const fields = { location, bearing, year, yearEnd, dateText: dateText?.ro };
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

export function currentMarker(id: string, current: SuggestionProposal | null): readonly MapPhoto[] {
    if (current?.location === undefined) {
        return [];
    }
    return [{ id, title: '', year: current.year ?? null, location: current.location, bearing: current.bearing ?? null, fov: null }];
}
