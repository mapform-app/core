import proj4 from 'proj4';
import { CRS_REGISTRY } from './crs-registry.generated.js';
import type { LengthUnit } from './units.js';

export interface CrsDefinition {
  epsg: number;
  name: string;
  kind: 'projected' | 'vertical';
  unit: LengthUnit;
  /** Area of use from the EPSG database. */
  area: string;
  /** PROJ definition. Present for projected systems only. */
  proj4?: string;
}

const BY_CODE = new Map<number, CrsDefinition>(CRS_REGISTRY.map((c) => [c.epsg, c]));

export function listCrs(kind?: CrsDefinition['kind']): readonly CrsDefinition[] {
  return kind ? CRS_REGISTRY.filter((c) => c.kind === kind) : CRS_REGISTRY;
}

export function getCrs(epsg: number): CrsDefinition | undefined {
  return BY_CODE.get(epsg);
}

/**
 * Search by EPSG code or by words in the name or area of use.
 * Every word in the query must match, so "wisconsin south ftus" finds EPSG:2289.
 */
export function searchCrs(
  query: string,
  options: { kind?: CrsDefinition['kind']; limit?: number } = {},
): CrsDefinition[] {
  const { kind, limit = 20 } = options;
  const q = query.trim().toLowerCase().replace(/^epsg:/, '');
  if (!q) return [];
  const pool = kind ? CRS_REGISTRY.filter((c) => c.kind === kind) : CRS_REGISTRY;

  if (/^\d+$/.test(q)) {
    return pool.filter((c) => String(c.epsg).startsWith(q)).slice(0, limit);
  }

  const words = q.split(/\s+/);
  return pool
    .filter((c) => {
      const text = `${c.name} ${c.area}`.toLowerCase();
      return words.every((w) => text.includes(w));
    })
    .slice(0, limit);
}

/**
 * Pick the Polish CS2000 zone (EPSG:2176-2179) for a longitude in degrees.
 * Zone boundaries follow the official 16.5, 19.5 and 22.5 degree meridians.
 */
export function suggestPl2000Zone(longitude: number): number {
  if (longitude < 16.5) return 2176;
  if (longitude < 19.5) return 2177;
  if (longitude < 22.5) return 2178;
  return 2179;
}

function projDef(epsg: number): string {
  const crs = BY_CODE.get(epsg);
  if (!crs || crs.kind !== 'projected' || !crs.proj4) {
    throw new Error(`EPSG:${epsg} is not a projected system in the Mapform registry`);
  }
  return crs.proj4;
}

const WGS84 = 'EPSG:4326';

/** Longitude/latitude (WGS 84, degrees) to easting/northing in the given system's own unit. */
export function toProjected(epsg: number, longitude: number, latitude: number): [number, number] {
  const [x, y] = proj4(WGS84, projDef(epsg), [longitude, latitude]);
  return [x, y];
}

/** Easting/northing in the given system's own unit to longitude/latitude (WGS 84, degrees). */
export function toGeographic(epsg: number, easting: number, northing: number): [number, number] {
  const [lon, lat] = proj4(projDef(epsg), WGS84, [easting, northing]);
  return [lon, lat];
}
