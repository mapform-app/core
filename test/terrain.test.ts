import { describe, expect, it } from 'vitest';
import {
  elevationAt,
  parseLandXml,
  parsePoints,
  tinBoundary,
  tinStats,
  triangulate,
} from '../src/index.js';

const signedArea = (p: Float64Array, t: Uint32Array, i: number) => {
  const a = t[i]! * 3;
  const b = t[i + 1]! * 3;
  const c = t[i + 2]! * 3;
  return (p[b]! - p[a]!) * (p[c + 1]! - p[a + 1]!) - (p[b + 1]! - p[a + 1]!) * (p[c]! - p[a]!);
};

describe('point files', () => {
  it('reads Civil 3D PNEZD with a header and descriptions', () => {
    const text = 'Point,Northing,Easting,Elevation,Desc\n1,5548100.0,7424400.0,210.5,EG\n2,5548100.0,7424410.0,211.0,EG\n3,5548110.0,7424400.0,212.0,TOP\n';
    const r = parsePoints(text);
    expect(r.format).toBe('PNEZ');
    expect(Array.from(r.points)).toEqual([7424400, 5548100, 210.5, 7424410, 5548100, 211, 7424400, 5548110, 212]);
    expect(r.skipped).toBe(1);
  });

  it('reads Polish "Nr X Y H" with decimal commas and picks the order from the origin', () => {
    // X is northing in Polish geodesy.
    const text = '1;5548100,25;7424400,50;210,5\n2;5548101,00;7424401,00;210,7\n3;5548102,00;7424399,00;210,9\n';
    const r = parsePoints(text, { origin: { easting: 7424400, northing: 5548100 } });
    expect(r.format).toBe('PNEZ');
    expect(r.points[0]).toBeCloseTo(7424400.5, 6);
    expect(r.points[1]).toBeCloseTo(5548100.25, 6);
    expect(r.points[2]).toBeCloseTo(210.5, 6);
  });

  it('reads plain XYZ separated by spaces and named points', () => {
    expect(parsePoints('100 200 5\n101 200 6\n100 201 7').format).toBe('ENZ');
    const named = parsePoints('PT1,200,100,5\nPT2,200,101,6\nPT3,201,100,7', {
      origin: { easting: 100, northing: 200 },
    });
    expect(named.format).toBe('PNEZ');
    expect(named.points[0]).toBe(100);
  });

  it('honours a format chosen by the user', () => {
    const r = parsePoints('1,100,200,5\n2,101,200,6\n3,100,201,7', { format: 'PENZ' });
    expect(Array.from(r.points.slice(0, 3))).toEqual([100, 200, 5]);
  });
});

describe('TIN', () => {
  const grid = (n: number, step: number, e0 = 7424400, n0 = 5548100) => {
    const out: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(e0 + i * step, n0 + j * step, 200 + i * 0.1 + j * 0.2);
    return Float64Array.from(out);
  };

  it('triangulates a grid counter-clockwise, with the right area and heights', () => {
    const tin = triangulate(grid(11, 10));
    const s = tinStats(tin);
    expect(s.triangles).toBe(200);
    expect(s.area).toBeCloseTo(100 * 100, 6);
    expect(s.minZ).toBeCloseTo(200, 9);
    expect(s.maxZ).toBeCloseTo(203, 9);
    for (let t = 0; t < tin.triangles.length; t += 3) expect(signedArea(tin.points, tin.triangles, t)).toBeGreaterThan(0);
    // A plane is reproduced exactly between the points.
    expect(elevationAt(tin, 7424400 + 33.3, 5548100 + 71.1)).toBeCloseTo(200 + 0.333 + 1.422, 9);
    expect(elevationAt(tin, 7424300, 5548100)).toBeNull();
    // The outline of a square grid: 4 sides of 10 edges.
    expect(tinBoundary(tin)).toHaveLength(40);
  });

  it('drops long triangles with a maximum edge length', () => {
    const points = Float64Array.from([...grid(3, 1, 0, 0), 100, 0, 0]);
    expect(tinStats(triangulate(points)).triangles).toBeGreaterThan(8);
    expect(tinStats(triangulate(points, { maxEdge: 5 })).triangles).toBe(8);
  });
});

describe('LandXML', () => {
  it('reads a Civil 3D surface: northing first, invisible faces left out', () => {
    const xml = `<?xml version="1.0"?>
<LandXML><Units><Metric linearUnit="meter"/></Units><Surfaces>
<Surface name="EG"><Definition surfType="TIN"><Pnts>
<P id="10">5548100 7424400 210</P><P id="11">5548100 7424410 211</P>
<P id="12">5548110 7424410 212</P><P id="13">5548110 7424400 213</P>
</Pnts><Faces><F>10 12 11</F><F>10 13 12</F><F i="1">11 12 13</F></Faces></Definition></Surface>
</Surfaces></LandXML>`;
    const [s] = parseLandXml(xml);
    expect(s!.name).toBe('EG');
    expect(s!.unit).toBe('meter');
    expect(Array.from(s!.points.slice(0, 3))).toEqual([7424400, 5548100, 210]);
    expect(s!.triangles.length).toBe(6);
    for (let t = 0; t < s!.triangles.length; t += 3) expect(signedArea(s!.points, s!.triangles, t)).toBeGreaterThan(0);
    expect(tinStats(s!).area).toBeCloseTo(100, 9);
  });
});
