/**
 * What M20's report says of a series (`docs/research/M20-import-local.md` §8.2, §8.4, §8.5): what will happen to it, its chance to
 * calibrate itself, its rights, its estimate, and, once imported, where it stands (waiting for its day, at work, waiting for points
 * and why, waiting for approval with its error against its threshold, published), each in the page's language.
 */
import { yearSchema, type ArchiveSeries, type Locale } from '@hcm/shared';
import type { AdminArchiveKey } from '@hcm/shared/admin-archive';

import type { SeriesEditPort, SeriesProgressPort } from './archive-port.js';
import { archiveText, count, sizeText } from './archive-element.js';

/** A year a layer can show (1800–2100), as typed. */
export function yearShown(text: string): boolean {
    return /^\d{4}$/.test(text.trim()) && yearSchema.safeParse(Number(text)).success;
}

/** "Place 4,545 sheets from their names on the city's grid", or "Skipped: …". */
export function actionText(locale: Locale, series: ArchiveSeries): string {
    if (series.action === 'skip' && series.reason !== undefined) {
        return archiveText(locale, 'adminArchive.action.skip', { reason: archiveText(locale, `adminArchive.reason.${series.reason}`) });
    }
    return archiveText(locale, `adminArchive.action.${series.class}`, { files: count(locale, series.files) });
}

export function estimateText(locale: Locale, series: ArchiveSeries): string {
    const { maxzoom, tilesBytes, minutes } = series.estimate;
    return archiveText(locale, 'adminArchive.estimate', {
        ...{ zoom: String(maxzoom), size: sizeText(locale, tilesBytes) },
        minutes: count(locale, Math.max(1, minutes)),
    });
}

/**
 * The chosen series' total: how many, their tiles' bytes and the days at the city's share. A share of 0 releases nothing (the
 * server never starts a series then), so the total says so instead of a count of days.
 */
export function totalText(locale: Locale, chosen: readonly ArchiveSeries[], share: number): string {
    if (chosen.length === 0) {
        return archiveText(locale, 'adminArchive.totalNone');
    }
    const bytes = chosen.reduce((sum, series) => sum + series.estimate.tilesBytes, 0);
    const counted = { jobs: count(locale, chosen.length), size: sizeText(locale, bytes) };
    if (share <= 0) {
        return archiveText(locale, 'adminArchive.totalNoShare', counted);
    }
    return archiveText(locale, 'adminArchive.total', { ...counted, days: count(locale, Math.ceil(chosen.length / share)) });
}

/** The series the owner keeps. */
export function chosenOf(series: readonly ArchiveSeries[], edits: Readonly<Record<string, SeriesEditPort>>): ArchiveSeries[] {
    return series.filter((each) => edits[each.seriesId]?.include === true);
}

type Line = (locale: Locale, progress: SeriesProgressPort) => string;

function metres(locale: Locale, value: number | null): string {
    return value === null ? '?' : new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

/** A job the computer has taken. */
const AT_WORK: ReadonlySet<SeriesProgressPort['jobStatus']> = new Set<SeriesProgressPort['jobStatus']>(['starting', 'running']);

function processing(locale: Locale, progress: SeriesProgressPort): string {
    if (progress.waitReason === 'daily') {
        return archiveText(locale, 'adminArchive.state.daily');
    }
    if (!AT_WORK.has(progress.jobStatus)) {
        return archiveText(locale, 'adminArchive.state.queued');
    }
    const percent = String(Math.round((progress.progress ?? 0) * 100));
    return archiveText(locale, 'adminArchive.state.running', { step: progress.step ?? '…', percent });
}

function points(locale: Locale, progress: SeriesProgressPort): string {
    const reason = progress.help === null ? 'low-confidence' : progress.help.reason;
    return archiveText(locale, 'adminArchive.state.points', { note: archiveText(locale, `adminArchive.help.${reason}`) });
}

function approval(locale: Locale, progress: SeriesProgressPort): string {
    const error = metres(locale, progress.errorM);
    if (progress.thresholdM === null) {
        return archiveText(locale, 'adminArchive.state.approvalNoScale', { error });
    }
    return archiveText(locale, 'adminArchive.state.approval', { error, threshold: metres(locale, progress.thresholdM) });
}

const said =
    (key: AdminArchiveKey): Line =>
    (locale) =>
        archiveText(locale, key);

const LINES: Readonly<Partial<Record<NonNullable<SeriesProgressPort['state']>, Line>>> = {
    needs_gcps: points,
    awaiting_approval: approval,
    approved: said('adminArchive.state.publishing'),
    publishing: said('adminArchive.state.publishing'),
    published: said('adminArchive.state.published'),
    failed: said('adminArchive.state.failed'),
    cancelled: said('adminArchive.state.cancelled'),
    rejected: said('adminArchive.state.cancelled'),
};

/** Where an imported series stands, in one line. */
export function stateText(locale: Locale, progress: SeriesProgressPort): string {
    const line = progress.state === null ? undefined : LINES[progress.state];
    return (line ?? processing)(locale, progress);
}
