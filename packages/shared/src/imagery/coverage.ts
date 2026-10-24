/**
 * How much of a city a USGS frame covers (`docs/research/M3-interfaces.md` §3.2): the frame's footprint, clipped to the
 * city's bounds, against the bounds' own area. Areas use an equal-area approximation good enough for a city: longitudes
 * are scaled by the cosine of the bounds' middle latitude, latitudes are kept. Pure: the harvest (functions) writes the
 * value, the admin's Imagery area could compute the same live.
 */
import type { BoundsRecord } from '../geo/bbox.js';
import { clamp, toRadians } from '../geo/math.js';

/** A vertex of a footprint, as the scene document stores it. */
export interface FootprintVertex {
    readonly lat: number;
    readonly lng: number;
}

/** At most this many vertices per stored footprint (`usgsSceneDocSchema`). */
export const MAX_FOOTPRINT_VERTICES = 64;

/** One side of the clip window: which vertices are inside, and where an edge crosses it. */
interface ClipEdge {
    inside(vertex: FootprintVertex): boolean;
    cross(from: FootprintVertex, to: FootprintVertex): FootprintVertex;
}

/** The point at `t` along `from` → `to`. */
function along(from: FootprintVertex, to: FootprintVertex, t: number): FootprintVertex {
    return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
}

function lngEdge(limit: number, keep: (lng: number) => boolean): ClipEdge {
    return {
        inside: (vertex) => keep(vertex.lng),
        cross: (from, to) => along(from, to, (limit - from.lng) / (to.lng - from.lng)),
    };
}

function latEdge(limit: number, keep: (lat: number) => boolean): ClipEdge {
    return {
        inside: (vertex) => keep(vertex.lat),
        cross: (from, to) => along(from, to, (limit - from.lat) / (to.lat - from.lat)),
    };
}

function edgesOf(bounds: BoundsRecord): readonly ClipEdge[] {
    return [
        lngEdge(bounds.west, (lng) => lng >= bounds.west),
        lngEdge(bounds.east, (lng) => lng <= bounds.east),
        latEdge(bounds.south, (lat) => lat >= bounds.south),
        latEdge(bounds.north, (lat) => lat <= bounds.north),
    ];
}

/** What one vertex contributes to the clipped ring (Sutherland–Hodgman), given the vertex before it. */
function clipStep(edge: ClipEdge, previous: FootprintVertex, current: FootprintVertex): FootprintVertex[] {
    const [wasIn, isIn] = [edge.inside(previous), edge.inside(current)];
    if (isIn) {
        return wasIn ? [current] : [edge.cross(previous, current), current];
    }
    return wasIn ? [edge.cross(previous, current)] : [];
}

/** Each vertex of an open ring with the one after it (the last with the first): the ring's edges. */
function successors(ring: readonly FootprintVertex[]): (readonly [FootprintVertex, FootprintVertex])[] {
    const next = [...ring.slice(1), ...ring.slice(0, 1)];
    return ring
        .map((vertex, index) => [vertex, next[index]] as const)
        .filter((edge): edge is readonly [FootprintVertex, FootprintVertex] => edge[1] !== undefined);
}

/** The part of an open ring on the inner side of one edge (the window is convex, the ring need not be). */
function clipRing(ring: readonly FootprintVertex[], edge: ClipEdge): FootprintVertex[] {
    return successors(ring).flatMap(([previous, current]) => clipStep(edge, previous, current));
}

/** The area of an open ring in square degrees, longitudes scaled by `scale` (the shoelace formula). */
function ringArea(ring: readonly FootprintVertex[], scale: number): number {
    const twice = successors(ring).reduce(
        (sum, [current, next]) => sum + current.lng * scale * next.lat - next.lng * scale * current.lat,
        0,
    );
    return Math.abs(twice) / 2;
}

/** The share of `bounds` that `footprint` (an open ring) covers, 0 to 1. */
export function footprintCoverage(footprint: readonly FootprintVertex[], bounds: BoundsRecord): number {
    const clipped = edgesOf(bounds).reduce<readonly FootprintVertex[]>((ring, edge) => clipRing(ring, edge), footprint);
    const scale = Math.cos(toRadians((bounds.south + bounds.north) / 2));
    const whole = (bounds.east - bounds.west) * scale * (bounds.north - bounds.south);
    return clamp(ringArea(clipped, scale) / whole, 0, 1);
}

/** A ring of two or more positions whose last one repeats its first (GeoJSON's closing vertex). */
function isClosed(ring: readonly (readonly [number, number])[]): boolean {
    const [first, last] = [ring[0], ring.at(-1)];
    return ring.length > 1 && String(first) === String(last);
}

/**
 * An M2M `spatialCoverage` ring (`[lng, lat]` pairs, usually closed) as the scene document stores it: `{lat, lng}`
 * vertices, open, at most {@link MAX_FOOTPRINT_VERTICES} (evenly thinned when longer). Undefined for fewer than three
 * distinct vertices.
 */
export function footprintOf(ring: readonly (readonly [number, number])[]): FootprintVertex[] | undefined {
    const vertices = ring.map(([lng, lat]) => ({ lat, lng }));
    const open = isClosed(ring) ? vertices.slice(0, -1) : vertices;
    if (open.length < 3) {
        return undefined;
    }
    const step = Math.ceil(open.length / MAX_FOOTPRINT_VERTICES);
    return open.filter((_vertex, index) => index % step === 0);
}
