/**
 * A historical layer's tiles from one PMTiles v3 archive (`docs/research/M12-own-tiles.md`), drawn through Mapbox GL's documented
 * `type: 'custom'` raster source: no tileset, no compute units, no token, and no library (about 1 KB gzip). A bare `.pmtiles` URL would
 * make Mapbox GL fetch a provider script from its own host, and our CSP refuses it. Each tile is one `Range` request, which needs no
 * preflight; a tile the archive leaves out (a corner the frame does not reach) is answered from its directory, with no request at all.
 * The address may be a signed one (the admin's private preview): it is never logged, and no message here carries it.
 *
 * A server that answers without honouring `Range` would send the whole file, a hundred megabytes for each tile: its body is cancelled
 * at once and every later tile fails without asking again (`S-V32-BAD-NO-RANGE`). The map reports the layer's error; it never breaks.
 */
import type { RasterLayerSpec } from './map-port.js';

/** The specification's rule: the first 16 KiB hold the header and the root directory, so one read answers both. */
const FIRST_READ_BYTES = 16384;
const HEADER_BYTES = 127;
const VERSION = 3;
const COMPRESSION_GZIP = 2;
const COMPRESSION_NONE = 1;
/** A leaf directory never points at another here; the specification allows three levels at most. */
const MAX_DEPTH = 3;
const PARTIAL_CONTENT = 206;
/** The tiles of a historical layer are 256 px (M12: a phone downloads 42 % less than at 512 px). */
const TILE_SIZE = 256;

/** The answer is definite, and asking again cannot change it: what `#open` keeps instead of asking for every tile. */
export class PmtilesRefusal extends Error {
    override readonly name = 'PmtilesRefusal';
}

/** One directory entry: a run of tiles (`run` at least 1), or a leaf directory (`run` 0). */
interface Entry {
    readonly id: number;
    readonly offset: number;
    readonly length: number;
    readonly run: number;
}

interface Head {
    readonly leavesAt: number;
    readonly tilesAt: number;
    readonly gzipped: boolean;
    readonly root: readonly Entry[];
}

/** A tile's place on the specification's Hilbert curve: 0 for z0, 1 to 4 for z1 and so on. */
export function tileIdOf(z: number, x: number, y: number): number {
    const size = 2 ** z;
    let place = (4 ** z - 1) / 3;
    let [column, row] = [x, y];
    for (let half = size / 2; half >= 1; half /= 2) {
        const right = Math.floor(column / half) % 2;
        const down = Math.floor(row / half) % 2;
        place += half * half * ((3 * right) ^ down);
        [column, row] = rotated(size, [column, row], right, down);
    }
    return place;
}

function rotated(size: number, [column, row]: readonly [number, number], right: number, down: number): [number, number] {
    if (down === 1) {
        return [column, row];
    }
    return right === 1 ? [size - 1 - row, size - 1 - column] : [row, column];
}

/** Read as numbers, not bits: an offset passes 2^31 in a large archive. */
function varints(bytes: Uint8Array): () => number {
    let at = 0;
    return () => {
        let value = 0;
        let scale = 1;
        let byte = 0x80;
        while (byte >= 0x80) {
            byte = Number(bytes[at]);
            at += 1;
            value += (byte & 0x7f) * scale;
            scale *= 0x80;
        }
        return value;
    };
}

/** The columns of a directory: the count, the id deltas, the runs, the lengths, the offsets (0: follows the entry before it). */
export function parseDirectory(bytes: Uint8Array): readonly Entry[] {
    const next = varints(bytes);
    const count = next();
    const column = (read: () => number): number[] => Array.from({ length: count }, read);
    const deltas = column(next);
    const runs = column(next);
    const lengths = column(next);
    const offsets = column(next);
    const entries: Entry[] = [];
    let id = 0;
    let end = 0;
    deltas.forEach((delta, index) => {
        id += delta;
        const offset = offsets[index] === 0 ? end : Number(offsets[index]) - 1;
        const length = Number(lengths[index]);
        entries.push({ id, offset, length, run: Number(runs[index]) });
        end = offset + length;
    });
    return entries;
}

/** The last entry at or before `id`. */
function lastAtOrBefore(entries: readonly Entry[], id: number): Entry | undefined {
    let low = 0;
    let high = entries.length - 1;
    while (low <= high) {
        const middle = (low + high) >> 1;
        if (Number(entries[middle]?.id) <= id) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return entries[high];
}

/** The entry that answers `id`: its tile's run, or the leaf directory that may hold it; null: the archive has no such tile. */
export function entryFor(entries: readonly Entry[], id: number): Entry | null {
    const entry = lastAtOrBefore(entries, id);
    if (entry === undefined) {
        return null;
    }
    return entry.run === 0 || id - entry.id < entry.run ? entry : null;
}

async function gunzip(data: ArrayBuffer): Promise<Uint8Array> {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function directoryOf(data: ArrayBuffer, gzipped: boolean): Promise<readonly Entry[]> {
    return parseDirectory(gzipped ? await gunzip(data) : new Uint8Array(data));
}

/** A number of the header, little-endian and 64 bits wide; an archive's offsets stay far below 2^53. */
function offsetAt(view: DataView, at: number): number {
    return Number(view.getBigUint64(at, true));
}

function isVersion3(data: ArrayBuffer): boolean {
    return (
        data.byteLength >= HEADER_BYTES &&
        new TextDecoder().decode(data.slice(0, 7)) === 'PMTiles' &&
        new DataView(data).getUint8(7) === VERSION
    );
}

/** The directories' compression, gzip or none (the only two our reader needs: no zstd or brotli library in the bundle). */
function gzippedOf(view: DataView): boolean {
    const compression = view.getUint8(97);
    if (compression !== COMPRESSION_GZIP && compression !== COMPRESSION_NONE) {
        throw new PmtilesRefusal('compression');
    }
    return compression === COMPRESSION_GZIP;
}

async function headOf(data: ArrayBuffer): Promise<Head> {
    if (!isVersion3(data)) {
        throw new PmtilesRefusal('not-pmtiles');
    }
    const view = new DataView(data);
    const gzipped = gzippedOf(view);
    const rootAt = offsetAt(view, 8);
    const root = await directoryOf(data.slice(rootAt, rootAt + offsetAt(view, 16)), gzipped);
    return { leavesAt: offsetAt(view, 40), tilesAt: offsetAt(view, 56), gzipped, root };
}

export class PmtilesReader {
    readonly #url: string;
    readonly #leaves = new Map<number, Promise<readonly Entry[]>>();
    #head: Promise<Head> | null = null;

    constructor(url: string) {
        this.#url = url;
    }

    /** The bytes of tile `z/x/y`, or null when the archive leaves it out. */
    async tile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
        const head = await this.#open();
        const entry = await this.#find(head, tileIdOf(z, x, y));
        return entry === null ? null : this.#read(head.tilesAt + entry.offset, entry.length, signal);
    }

    /** A read that fails for a reason that may pass (the network) is asked again by the next tile; a refusal stays. */
    #open(): Promise<Head> {
        this.#head ??= this.#read(0, FIRST_READ_BYTES).then(headOf);
        this.#head.catch((error: unknown) => {
            if (!(error instanceof PmtilesRefusal)) {
                this.#head = null;
            }
        });
        return this.#head;
    }

    async #find(head: Head, id: number): Promise<Entry | null> {
        let entries = head.root;
        for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
            const entry = entryFor(entries, id);
            if (entry?.run !== 0) {
                return entry;
            }
            entries = await this.#leaf(head, entry);
        }
        return null;
    }

    /** A leaf is read once, whichever tile asks first; never under a tile's signal, as the others wait for it too. */
    #leaf(head: Head, entry: Entry): Promise<readonly Entry[]> {
        const known = this.#leaves.get(entry.offset);
        if (known !== undefined) {
            return known;
        }
        const leaf = this.#read(head.leavesAt + entry.offset, entry.length).then((data) => directoryOf(data, head.gzipped));
        this.#leaves.set(entry.offset, leaf);
        leaf.catch(() => this.#leaves.delete(entry.offset));
        return leaf;
    }

    async #read(offset: number, length: number, signal?: AbortSignal): Promise<ArrayBuffer> {
        const headers = { Range: `bytes=${String(offset)}-${String(offset + length - 1)}` };
        const response = await fetch(this.#url, signal === undefined ? { headers } : { headers, signal });
        if (response.status !== PARTIAL_CONTENT) {
            // The whole file may be on its way: nothing of it is read.
            await response.body?.cancel();
            throw new PmtilesRefusal(`status-${String(response.status)}`);
        }
        return response.arrayBuffer();
    }
}

/** What Mapbox GL takes for a custom raster source (`mapbox-gl.d.ts`, `CustomSourceInterface`). */
export interface PmtilesCustomSource extends Readonly<Record<string, unknown>> {
    readonly type: 'custom';
    loadTile(
        tile: { readonly x: number; readonly y: number; readonly z: number },
        options: { readonly signal: AbortSignal },
    ): Promise<ImageBitmap | null>;
}

/** Mapbox GL's source for a layer on an archive, with its own reader: a new source starts clean. */
export function pmtilesSource(
    id: string,
    url: string,
    spec: Pick<RasterLayerSpec, 'minzoom' | 'maxzoom' | 'bounds'> & { readonly attribution: string },
): PmtilesCustomSource {
    const reader = new PmtilesReader(url);
    return {
        id,
        type: 'custom',
        dataType: 'raster',
        tileSize: TILE_SIZE,
        minzoom: spec.minzoom,
        maxzoom: spec.maxzoom,
        attribution: spec.attribution,
        ...(spec.bounds === undefined ? {} : { bounds: [...spec.bounds[0], ...spec.bounds[1]] }),
        loadTile: async ({ z, x, y }, { signal }) => {
            const bytes = await reader.tile(z, x, y, signal);
            // The picture says what it is: a blob with no type decodes all the same, as WebP or as a kit city's PNG.
            return bytes === null ? null : createImageBitmap(new Blob([bytes]));
        },
    };
}
