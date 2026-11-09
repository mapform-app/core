import Delaunator from 'delaunator';

/*
 * Terrain surfaces: survey points and Civil 3D surfaces read from text, triangulated into a TIN.
 * Coordinates stay in the map system of the project (easting, northing, height in map units).
 */

/** A triangulated surface. Triangles run counter-clockwise seen from above. */
export interface Tin {
  /** x, y, z of each point, one after another: easting, northing, height. */
  points: Float64Array;
  /** 3 point indices per triangle. */
  triangles: Uint32Array;
}

/** Column order of a point file. P is a point number, D a description; both are skipped. */
export type PointFormat = 'PNEZ' | 'PENZ' | 'NEZ' | 'ENZ';

export const POINT_FORMATS: Record<PointFormat, string> = {
  PNEZ: 'Number, Northing, Easting, Elevation (PNEZD)',
  PENZ: 'Number, Easting, Northing, Elevation (PENZD)',
  NEZ: 'Northing, Easting, Elevation (NEZ)',
  ENZ: 'Easting, Northing, Elevation (ENZ / XYZ)',
};

export interface ParsedPoints {
  points: Float64Array;
  format: PointFormat;
  /** Lines that were not points: headers, comments, rows with too few numbers. */
  skipped: number;
}

type Row = string[];

function splitRows(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const sample = lines.filter((l) => l.trim() && !l.trim().startsWith('#')).slice(0, 50).join('\n');
  // Semicolons or tabs between fields leave the comma free as a decimal mark (1234,56).
  let delimiter: RegExp;
  let decimalComma = false;
  if (sample.includes(';')) {
    delimiter = /;/;
    decimalComma = true;
  } else if (sample.includes('\t')) {
    delimiter = /\t/;
    decimalComma = true;
  } else if (sample.includes(',')) {
    delimiter = /,/;
  } else {
    delimiter = /\s+/;
  }
  return lines.map((line) => {
    const fields = line.trim().split(delimiter).map((f) => f.trim());
    return decimalComma ? fields.map((f) => f.replace(',', '.')) : fields;
  });
}

const isNumber = (s: string | undefined) => s !== undefined && s !== '' && Number.isFinite(Number(s));

/** Leading numeric fields of a row. */
function numbersOf(row: Row): number[] {
  const out: number[] = [];
  for (const f of row) {
    if (!isNumber(f)) break;
    out.push(Number(f));
  }
  return out;
}

/**
 * Guesses the column order. A point number shows as a first column of whole numbers, or as a
 * first field that is not a number at all (e.g. "PT12"). Northing or easting first is decided by
 * which reading lies closer to the project origin, when one is given.
 */
function guessFormat(rows: Row[], hint?: { easting: number; northing: number }): PointFormat {
  const sample = rows.filter((r) => r.length >= 3).slice(0, 200);
  let named = 0;
  let wholeFirst = 0;
  let four = 0;
  for (const r of sample) {
    if (!isNumber(r[0]) && r.slice(1, 4).every(isNumber)) named++;
    const n = numbersOf(r);
    if (n.length >= 4) {
      four++;
      if (Number.isInteger(n[0])) wholeFirst++;
    }
  }
  const numbered = named > sample.length / 2 || (four > sample.length / 2 && wholeFirst === four);
  if (!hint) return numbered ? 'PNEZ' : 'ENZ';
  const [a, b] = numbered ? (['PNEZ', 'PENZ'] as const) : (['NEZ', 'ENZ'] as const);
  const da = distanceTo(read(rows, a), hint);
  const db = distanceTo(read(rows, b), hint);
  return da <= db ? a : b;
}

function distanceTo(points: Float64Array, hint: { easting: number; northing: number }): number {
  if (points.length === 0) return Infinity;
  let e = 0;
  let n = 0;
  const count = points.length / 3;
  for (let i = 0; i < points.length; i += 3) {
    e += points[i]!;
    n += points[i + 1]!;
  }
  return Math.hypot(e / count - hint.easting, n / count - hint.northing);
}

function read(rows: Row[], format: PointFormat): Float64Array {
  const out: number[] = [];
  const numbered = format === 'PNEZ' || format === 'PENZ';
  const northFirst = format === 'PNEZ' || format === 'NEZ';
  for (const row of rows) {
    const fields = numbered ? row.slice(1) : row;
    if (numbered && row.length < 4) continue;
    const n = numbersOf(fields);
    if (n.length < 3) continue;
    const [first, second, z] = n as [number, number, number];
    if (northFirst) out.push(second, first, z);
    else out.push(first, second, z);
  }
  return Float64Array.from(out);
}

/**
 * Reads survey points from a text file: comma, semicolon, tab or space separated, with or
 * without point numbers, descriptions and header lines. Decimal commas work with semicolons or
 * tabs between fields.
 */
export function parsePoints(
  text: string,
  options: { format?: PointFormat; origin?: { easting: number; northing: number } } = {},
): ParsedPoints {
  const rows = splitRows(text).filter((r) => r.length > 0 && r[0] !== '' && !r[0]!.startsWith('#'));
  const format = options.format ?? guessFormat(rows, options.origin);
  const points = read(rows, format);
  return { points, format, skipped: rows.length - points.length / 3 };
}

export interface LandXmlSurface extends Tin {
  name: string;
  /** The linear unit the file says it uses, e.g. "meter" or "USSurveyFoot". */
  unit: string | null;
}

/**
 * Reads the TIN surfaces of a LandXML file, as Civil 3D and OpenRoads write them. Points in
 * LandXML are northing, easting, elevation; invisible faces (i="1") are left out.
 */
export function parseLandXml(text: string): LandXmlSurface[] {
  const unit = /<(?:Metric|Imperial)\b[^>]*\blinearUnit="([^"]+)"/.exec(text)?.[1] ?? null;
  const surfaces: LandXmlSurface[] = [];
  const surfaceRe = /<Surface\b([^>]*)>([\s\S]*?)<\/Surface>/g;
  for (let m = surfaceRe.exec(text); m; m = surfaceRe.exec(text)) {
    const name = /\bname="([^"]*)"/.exec(m[1] ?? '')?.[1] ?? `Surface ${surfaces.length + 1}`;
    const body = m[2] ?? '';
    const ids = new Map<string, number>();
    const coords: number[] = [];
    const pointRe = /<P\b([^>]*)>([^<]*)<\/P>/g;
    for (let p = pointRe.exec(body); p; p = pointRe.exec(body)) {
      const id = /\bid="([^"]*)"/.exec(p[1] ?? '')?.[1];
      const [n, e, z] = (p[2] ?? '').trim().split(/\s+/).map(Number);
      if (id === undefined || !Number.isFinite(n) || !Number.isFinite(e)) continue;
      ids.set(id, coords.length / 3);
      coords.push(e!, n!, Number.isFinite(z) ? z! : 0);
    }
    const tris: number[] = [];
    const faceRe = /<F\b([^>]*)>([^<]*)<\/F>/g;
    for (let f = faceRe.exec(body); f; f = faceRe.exec(body)) {
      if (/\bi="1"/.test(f[1] ?? '')) continue;
      const [a, b, c] = (f[2] ?? '').trim().split(/\s+/).map((id) => ids.get(id));
      if (a === undefined || b === undefined || c === undefined) continue;
      tris.push(a, b, c);
    }
    if (coords.length === 0) continue;
    const points = Float64Array.from(coords);
    const triangles = tris.length ? Uint32Array.from(tris) : triangulate(points).triangles;
    surfaces.push({ name, unit, points, triangles: counterClockwise(points, triangles) });
  }
  return surfaces;
}

/** Triangles turned to run counter-clockwise seen from above. */
function counterClockwise(points: Float64Array, triangles: Uint32Array): Uint32Array {
  const out = triangles.slice();
  for (let t = 0; t < out.length; t += 3) {
    const a = out[t]! * 3;
    const b = out[t + 1]! * 3;
    const c = out[t + 2]! * 3;
    const cross =
      (points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
      (points[b + 1]! - points[a + 1]!) * (points[c]! - points[a]!);
    if (cross < 0) {
      out[t + 1] = triangles[t + 2]!;
      out[t + 2] = triangles[t + 1]!;
    }
  }
  return out;
}

/**
 * A Delaunay TIN of the points. Duplicate points (same easting and northing) are left out.
 * With maxEdge, triangles with a side longer than that (in plan) are dropped, so the surface
 * follows a concave boundary instead of bridging gaps.
 */
export function triangulate(points: Float64Array, options: { maxEdge?: number } = {}): Tin {
  const count = points.length / 3;
  // Triangulated near the middle of the points: map coordinates in the millions lose precision.
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i += 3) {
    cx += points[i]!;
    cy += points[i + 1]!;
  }
  cx /= count || 1;
  cy /= count || 1;
  const xy = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) {
    xy[i * 2] = points[i * 3]! - cx;
    xy[i * 2 + 1] = points[i * 3 + 1]! - cy;
  }
  if (count < 3) return { points, triangles: new Uint32Array(0) };
  const d = new Delaunator(xy);
  let triangles = d.triangles;
  const max = options.maxEdge;
  if (max && max > 0) {
    const keep: number[] = [];
    const max2 = max * max;
    const long = (i: number, j: number) =>
      (xy[i * 2]! - xy[j * 2]!) ** 2 + (xy[i * 2 + 1]! - xy[j * 2 + 1]!) ** 2 > max2;
    for (let t = 0; t < triangles.length; t += 3) {
      const a = triangles[t]!;
      const b = triangles[t + 1]!;
      const c = triangles[t + 2]!;
      if (!long(a, b) && !long(b, c) && !long(c, a)) keep.push(a, b, c);
    }
    triangles = Uint32Array.from(keep);
  }
  return { points, triangles: counterClockwise(points, triangles) };
}

export interface TinStats {
  points: number;
  triangles: number;
  minZ: number;
  maxZ: number;
  /** Plan area covered by the triangles, in square map units. */
  area: number;
  min: [number, number];
  max: [number, number];
}

export function tinStats(tin: Tin): TinStats {
  const { points, triangles } = tin;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const min: [number, number] = [Infinity, Infinity];
  const max: [number, number] = [-Infinity, -Infinity];
  const used = new Uint8Array(points.length / 3);
  for (const i of triangles) used[i] = 1;
  let count = 0;
  for (let i = 0; i < used.length; i++) {
    if (!used[i]) continue;
    count++;
    const x = points[i * 3]!;
    const y = points[i * 3 + 1]!;
    const z = points[i * 3 + 2]!;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
    if (x < min[0]) min[0] = x;
    if (y < min[1]) min[1] = y;
    if (x > max[0]) max[0] = x;
    if (y > max[1]) max[1] = y;
  }
  let area = 0;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]! * 3;
    const b = triangles[t + 1]! * 3;
    const c = triangles[t + 2]! * 3;
    area +=
      ((points[b]! - points[a]!) * (points[c + 1]! - points[a + 1]!) -
        (points[b + 1]! - points[a + 1]!) * (points[c]! - points[a]!)) /
      2;
  }
  return { points: count, triangles: triangles.length / 3, minZ, maxZ, area, min, max };
}

/** The outer and inner edges of a TIN: sides that belong to only 1 triangle, as point index pairs. */
export function tinBoundary(tin: Tin): [number, number][] {
  // Numeric keys: a million triangles in under a second, where text keys take several.
  const count = tin.points.length / 3;
  const seen = new Map<number, number>();
  const { triangles } = tin;
  for (let t = 0; t < triangles.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[t + k]!;
      const b = triangles[t + ((k + 1) % 3)]!;
      const key = a < b ? a * count + b : b * count + a;
      if (seen.has(key)) seen.delete(key);
      else seen.set(key, a);
    }
  }
  const out: [number, number][] = [];
  for (const [key, a] of seen) {
    const lo = Math.floor(key / count);
    const hi = key - lo * count;
    out.push([a, a === lo ? hi : lo]);
  }
  return out;
}

/** Height of the surface at a point in plan, or null outside it. */
export function elevationAt(tin: Tin, x: number, y: number): number | null {
  const { points, triangles } = tin;
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t]! * 3;
    const b = triangles[t + 1]! * 3;
    const c = triangles[t + 2]! * 3;
    const x1 = points[a]!, y1 = points[a + 1]!;
    const x2 = points[b]!, y2 = points[b + 1]!;
    const x3 = points[c]!, y3 = points[c + 1]!;
    const det = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
    if (det === 0) continue;
    const l1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / det;
    const l2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / det;
    const l3 = 1 - l1 - l2;
    const eps = -1e-9;
    if (l1 >= eps && l2 >= eps && l3 >= eps)
      return l1 * points[a + 2]! + l2 * points[b + 2]! + l3 * points[c + 2]!;
  }
  return null;
}
