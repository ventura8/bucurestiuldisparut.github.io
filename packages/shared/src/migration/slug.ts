/**
 * Stable ids for migrated photos: the slug of the original file name, so a re-run of the migration
 * gives the same ids, and a deep link (`#photo=<id>`) keeps working. Ids match `ID_PATTERN`.
 */

export const MAX_ID_LENGTH = 40;

/** `Mihai Vodă, nr 63.jpg` → `Mihai Vodă, nr 63`: the name without its extension. */
export function fileStem(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot > 0 && /^\.[A-Za-z0-9]{1,5}$/.test(fileName.slice(dot)) ? fileName.slice(0, dot) : fileName;
}

/** Lower-case ASCII words joined by `-`: diacritics folded, everything else a separator. */
export function slugify(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word !== '')
        .join('-');
}

/** `slug` cut to `max` characters at a word boundary when there is one. */
export function truncateSlug(slug: string, max: number): string {
    if (slug.length <= max) {
        return slug;
    }
    const boundary = slug.lastIndexOf('-', max);
    return slug.slice(0, boundary > 0 ? boundary : max);
}

/**
 * An id allocator: each call returns the base itself (or `photo` when it is empty) cut to
 * `MAX_ID_LENGTH`, or, when that id was already handed out, the same with `-2`, `-3`, ...
 */
export function createIdAllocator(): (base: string) => string {
    const used = new Set<string>();
    return (base) => {
        const root = truncateSlug(base === '' ? 'photo' : base, MAX_ID_LENGTH);
        let id = root;
        let suffix = 1;
        while (used.has(id)) {
            suffix += 1;
            id = `${truncateSlug(root, MAX_ID_LENGTH - String(suffix).length - 1)}-${String(suffix)}`;
        }
        used.add(id);
        return id;
    };
}

/** One unique id per base, in order (see `createIdAllocator`). */
export function uniqueIds(bases: readonly string[]): string[] {
    return bases.map(createIdAllocator());
}
