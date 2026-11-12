/**
 * The tile-import wizard's weak seams (step 2, `docs/research/M20-import-local.md` §19): each seam of `layout.json` the pipeline
 * doubted, with its two strips in `seams.jpg`, its guess, and the owner's answer: the guess accepted, or one point clicked on each
 * side. Pure functions.
 */
import { SEAM_CELL_PX, type LayoutFile, type LayoutSeam, type OwnerSeam } from '@hcm/shared';

type Point = readonly [number, number];
type Rect = readonly [number, number, number, number];

export interface DraftSeam {
    readonly a: number;
    readonly b: number;
    readonly side: LayoutSeam['side'];
    readonly score: number;
    readonly strip: NonNullable<LayoutSeam['strip']> | null;
    readonly suggestion: { readonly a: Point; readonly b: Point } | null;
    readonly picked: { readonly a: Point | null; readonly b: Point | null };
    readonly answered: boolean;
}

function draftOf(seam: LayoutSeam): DraftSeam {
    const { a, b, side, score } = seam;
    return {
        a,
        b,
        side,
        score,
        strip: seam.strip ?? null,
        suggestion: seam.suggestion ?? null,
        picked: { a: null, b: null },
        answered: false,
    };
}

/** The seams the pipeline doubted, in `layout.json`'s order. */
export function weakSeamsOf(file: LayoutFile): readonly DraftSeam[] {
    return file.seams.filter((seam) => seam.state === 'weak').map(draftOf);
}

function changed(seams: readonly DraftSeam[], at: number, change: (seam: DraftSeam) => DraftSeam): readonly DraftSeam[] {
    return seams.map((seam, index) => (index === at ? change(seam) : seam));
}

/** The guess of seam `at` accepted as the owner's points (no guess: as it is). */
export function acceptGuess(seams: readonly DraftSeam[], at: number): readonly DraftSeam[] {
    return changed(seams, at, (seam) => (seam.suggestion === null ? seam : { ...seam, picked: { ...seam.suggestion }, answered: true }));
}

/** A point clicked on one side of seam `at`; with a point on both sides the seam is answered. */
export function pickPoint(seams: readonly DraftSeam[], at: number, side: 'a' | 'b', point: Point): readonly DraftSeam[] {
    return changed(seams, at, (seam) => {
        const picked = { ...seam.picked, [side]: point };
        return { ...seam, picked, answered: picked.a !== null && picked.b !== null };
    });
}

/** The seams the owner answered, as `imagery.saveLayout` takes them. */
export function ownerSeamsOf(seams: readonly DraftSeam[]): OwnerSeam[] {
    return seams.flatMap(({ a, b, side, picked, answered }) =>
        answered && picked.a !== null && picked.b !== null ? [{ a, b, side, points: { a: [...picked.a], b: [...picked.b] } }] : [],
    );
}

/** One strip of a seam in `seams.jpg`: its square's row and side, the sheet's rectangle scaled into it from the top left. */
export function spriteRectOf(row: number, side: 'a' | 'b', sheet: Rect): Rect {
    const scale = SEAM_CELL_PX / Math.max(sheet[2], sheet[3]);
    return [side === 'a' ? 0 : SEAM_CELL_PX, row * SEAM_CELL_PX, Math.round(sheet[2] * scale), Math.round(sheet[3] * scale)];
}

/** `seams.jpg`'s size: two squares a row, one row per seam with a strip. */
export function seamSpriteOf(seams: readonly DraftSeam[]): { readonly width: number; readonly height: number } {
    const rows = seams.reduce((most, seam) => Math.max(most, (seam.strip?.row ?? -1) + 1), 0);
    return { width: 2 * SEAM_CELL_PX, height: rows * SEAM_CELL_PX };
}
