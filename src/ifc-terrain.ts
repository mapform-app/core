import { mapConversionFor, type ProjectSettings } from './project.js';

/*
 * Writes terrain surfaces into an IFC 4.3 project file as text, in the browser. A TIN of a
 * million triangles is tens of MB: written here it never travels to a server and back.
 *
 * Each surface becomes an IfcGeographicElement (TERRAIN) with an IfcTriangulatedIrregularNetwork,
 * placed under the site and coloured as ground. Points arrive in map coordinates and are turned
 * into project coordinates by undoing IfcMapConversion, as the server does for the project.
 */

export interface TerrainSurface {
  name: string;
  /** x, y, z of each point in map coordinates: easting, northing, height. */
  points: Float64Array;
  /** 3 point indices per triangle, counter-clockwise seen from above. */
  triangles: Uint32Array;
}

const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** A new IFC GlobalId: 128 random bits in IFC's 22-character base 64. */
export function newGuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Marked as a version 4 UUID, as other IFC tools do.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  for (let i = 0; i < 22; i++) {
    out = GUID_CHARS[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

/** A REAL as STEP wants it: always with a decimal point, to 0.1 mm (or 0.0001 ft). */
export function stepReal(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Not a number: ${v}`);
  let s = v.toFixed(4);
  s = s.replace(/0+$/, '');
  if (s === '-0.') s = '0.';
  return s;
}

const stepText = (s: string) =>
  `'${s.replace(/\\/g, '\\\\').replace(/'/g, "''").replace(/[^\x20-\x7e]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`)}'`;

/** Splits an entity's arguments at its top-level commas. */
function args(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === "'") quoted = s[i + 1] === "'" ? (i++, true) : false;
    } else if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/** Points per piece of text: keeps every string well below what browsers allow. */
const PIECE = 20000;

/**
 * The project file with the surfaces added, as pieces of text to put in a Blob. The file must
 * be one Mapform made for these settings: it has a site and a Body context.
 */
export function addTerrainToIfc(
  ifc: string,
  settings: ProjectSettings,
  surfaces: TerrainSurface[],
): string[] {
  if (surfaces.length === 0) return [ifc];
  const end = ifc.lastIndexOf('ENDSEC;');
  if (end < 0) throw new Error('Not an IFC file: no end of data');
  const site = /#(\d+)\s*=\s*IFCSITE\s*\(([^;]*)\)\s*;/.exec(ifc);
  if (!site) throw new Error('The project has no site to put the terrain on');
  const sitePlacement = args(site[2]!)[5];
  const body = /#(\d+)\s*=\s*IFCGEOMETRICREPRESENTATIONSUBCONTEXT\s*\(\s*'Body'\s*,\s*'Model'/.exec(ifc);
  if (!body) throw new Error('The project has no Body context');
  let next = 0;
  for (const m of ifc.matchAll(/#(\d+)\s*=/g)) next = Math.max(next, Number(m[1]));
  const id = () => `#${++next}`;

  const mc = mapConversionFor(settings);
  const a = mc.xAxisAbscissa;
  const b = mc.xAxisOrdinate;
  const k = 1 / mc.scale;

  const out: string[] = [ifc.slice(0, end)];
  const add = (s: string) => out.push(s);

  const colour = id();
  const shading = id();
  const style = id();
  add(`${colour}=IFCCOLOURRGB($,0.42,0.55,0.38);\n`);
  add(`${shading}=IFCSURFACESTYLESHADING(${colour},0.);\n`);
  add(`${style}=IFCSURFACESTYLE('Terrain',.BOTH.,(${shading}));\n`);
  const origin = id();
  add(`${origin}=IFCCARTESIANPOINT((0.,0.,0.));\n`);

  const elements: string[] = [];
  for (const s of surfaces) {
    const p = s.points;
    const t = s.triangles;
    const count = p.length / 3;
    for (const i of t) if (i >= count) throw new Error(`Surface ${s.name}: a triangle refers to a missing point`);

    const list = id();
    add(`${list}=IFCCARTESIANPOINTLIST3D((`);
    for (let start = 0; start < count; start += PIECE) {
      const parts: string[] = [];
      for (let i = start; i < Math.min(count, start + PIECE); i++) {
        const de = p[i * 3]! - mc.eastings;
        const dn = p[i * 3 + 1]! - mc.northings;
        const x = (a * de + b * dn) * k;
        const y = (-b * de + a * dn) * k;
        const z = (p[i * 3 + 2]! - mc.orthogonalHeight) * k;
        parts.push(`(${stepReal(x)},${stepReal(y)},${stepReal(z)})`);
      }
      add((start ? ',' : '') + parts.join(','));
    }
    add('),$);\n');

    const tin = id();
    const triangles = t.length / 3;
    add(`${tin}=IFCTRIANGULATEDIRREGULARNETWORK(${list},$,.F.,(`);
    for (let start = 0; start < triangles; start += PIECE) {
      const parts: string[] = [];
      for (let i = start; i < Math.min(triangles, start + PIECE); i++)
        parts.push(`(${t[i * 3]! + 1},${t[i * 3 + 1]! + 1},${t[i * 3 + 2]! + 1})`);
      add((start ? ',' : '') + parts.join(','));
    }
    // Flags: 0 for each triangle, a visible face with no breaklines.
    add('),$,(');
    for (let start = 0; start < triangles; start += PIECE * 10) {
      const n = Math.min(triangles, start + PIECE * 10) - start;
      add((start ? ',' : '') + new Array<string>(n).fill('0').join(','));
    }
    add('));\n');

    const styled = id();
    add(`${styled}=IFCSTYLEDITEM(${tin},(${style}),$);\n`);
    const shape = id();
    add(`${shape}=IFCSHAPEREPRESENTATION(#${body[1]},'Body','Tessellation',(${tin}));\n`);
    const product = id();
    add(`${product}=IFCPRODUCTDEFINITIONSHAPE($,$,(${shape}));\n`);
    const axes = id();
    add(`${axes}=IFCAXIS2PLACEMENT3D(${origin},$,$);\n`);
    const placement = id();
    add(`${placement}=IFCLOCALPLACEMENT(${sitePlacement},${axes});\n`);
    const element = id();
    add(
      `${element}=IFCGEOGRAPHICELEMENT('${newGuid()}',$,${stepText(s.name)},$,$,${placement},${product},$,.TERRAIN.);\n`,
    );
    elements.push(element);
  }
  add(
    `${id()}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${newGuid()}',$,$,$,(${elements.join(',')}),#${site[1]});\n`,
  );
  out.push(ifc.slice(end));
  return out;
}
