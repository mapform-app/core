import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addTerrainToIfc, newGuid, stepReal, type ProjectSettings } from '../src/index.js';

const project = readFileSync(new URL('./fixtures/project-bng.ifc', import.meta.url), 'utf8');
const settings: ProjectSettings = {
  name: 'LK1',
  code: 'ASD',
  crsEpsg: 27700,
  verticalEpsg: 5701,
  lengthUnit: 'm',
  origin: { easting: 247000, northing: 815500, elevation: 0 },
  rotationDeg: 0,
};

describe('terrain written into IFC', () => {
  it('writes STEP reals and GlobalIds', () => {
    expect(stepReal(12)).toBe('12.');
    expect(stepReal(0.5)).toBe('0.5');
    expect(stepReal(-0.00001)).toBe('0.');
    expect(stepReal(-1234.56789)).toBe('-1234.5679');
    const g = newGuid();
    expect(g).toMatch(/^[0-3][0-9A-Za-z_$]{21}$/);
    expect(newGuid()).not.toBe(g);
  });

  it('adds a TIN under the site, in project coordinates', () => {
    const points = Float64Array.from([247000, 815500, 20, 247020, 815500, 21, 247020, 815510, 22, 247000, 815510, 21]);
    const text = addTerrainToIfc(project, settings, [
      { name: "Bartek's EG", points, triangles: Uint32Array.from([0, 1, 2, 0, 2, 3]) },
    ]).join('');
    expect(text.endsWith('ENDSEC;\nEND-ISO-10303-21;\n')).toBe(true);
    expect(text).toContain('=IFCCARTESIANPOINTLIST3D(((0.,0.,20.),(20.,0.,21.),(20.,10.,22.),(0.,10.,21.)),$);');
    expect(text).toMatch(/=IFCTRIANGULATEDIRREGULARNETWORK\(#\d+,\$,\.F\.,\(\(1,2,3\),\(1,3,4\)\),\$,\(0,0\)\);/);
    expect(text).toMatch(/=IFCGEOGRAPHICELEMENT\('[^']{22}',\$,'Bartek''s EG',\$,\$,#\d+,#\d+,\$,\.TERRAIN\.\);/);
    // Placed relative to the site's placement (#34 in the fixture), contained in the site (#23).
    expect(text).toMatch(/=IFCLOCALPLACEMENT\(#34,#\d+\);/);
    expect(text).toMatch(/=IFCRELCONTAINEDINSPATIALSTRUCTURE\('[^']{22}',\$,\$,\$,\(#\d+\),#23\);/);
    // New entities continue the numbering after #34.
    expect(text).toContain('#35=IFCCOLOURRGB');
  });

  it('undoes rotation and unit scale', () => {
    const turned = { ...settings, rotationDeg: 90, lengthUnit: 'ft' as const };
    const text = addTerrainToIfc(project, turned, [
      {
        name: 'EG',
        points: Float64Array.from([247000, 815500.3048, 0.3048, 247001, 815500, 0, 247000, 815501, 0]),
        triangles: Uint32Array.from([0, 1, 2]),
      },
    ]).join('');
    // 1 ft north on the map is 1 ft along the project's x axis when x points north.
    expect(text).toContain('IFCCARTESIANPOINTLIST3D(((1.,0.,1.),');
  });
});
