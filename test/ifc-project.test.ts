import { describe, expect, it } from 'vitest';
import { compoundAngle, createProjectIfc, stepRealExact, toGeographic, type ProjectSettings } from '../src/index.js';

const wisconsin: ProjectSettings = {
  name: "MKE's campus",
  code: 'WI1',
  crsEpsg: 2289,
  verticalEpsg: 6360,
  lengthUnit: 'ft',
  origin: { easting: 2528119.13, northing: 385672.22, elevation: 700 },
  rotationDeg: 30,
};

describe('project file written in the browser', () => {
  it('writes STEP reals at full precision', () => {
    expect(stepRealExact(12)).toBe('12.');
    expect(stepRealExact(0.866025403784)).toBe('0.866025403784');
    expect(stepRealExact(1e-7)).toBe('1.E-07');
    expect(stepRealExact(-2.5e-12)).toBe('-2.5E-12');
  });

  it('turns degrees into IFC compound angles of one sign', () => {
    expect(compoundAngle(57.2046487)).toEqual([57, 12, 16, 735320]);
    expect(compoundAngle(-4.5)).toEqual([-4, -30, -0, -0]);
  });

  it('has units, contexts, georeferencing and a site', () => {
    const ifc = createProjectIfc(wisconsin, new Date('2026-11-09T12:00:00Z'));
    expect(ifc).toContain("FILE_NAME('WI1.ifc','2026-11-09T12:00:00',(''),(''),'Mapform 0.1.0','Mapform 0.1.0','');");
    expect(ifc).toContain("FILE_SCHEMA(('IFC4X3_ADD2'));");
    expect(ifc).toMatch(/IFCPROJECT\('[^']{22}',\$,'WI1',\$,\$,'MKE''s campus',\$,\(#\d+,#\d+\),#\d+\);/);
    expect(ifc).toContain("IFCCONVERSIONBASEDUNIT(#1,.LENGTHUNIT.,'foot',#3)");
    // The map is in US survey feet: a second length unit for it.
    expect(ifc).toMatch(/IFCCONVERSIONBASEDUNIT\(#\d+,\.LENGTHUNIT\.,'US survey foot',#\d+\)/);
    expect(ifc).toMatch(
      /IFCPROJECTEDCRS\('EPSG:2289','NAD83 \/ Wisconsin South \(ftUS\)','North American Datum 1983','EPSG:6360','SPCS83 Wisconsin South zone \(US survey foot\)',\$,#\d+\);/,
    );
    expect(ifc).toMatch(/IFCMAPCONVERSION\(#\d+,#\d+,2528119.13,385672.22,700.,0.866025403784,0.5,0.99999\d+\);/);
    const [lon, lat] = toGeographic(2289, 2528119.13, 385672.22);
    expect(ifc).toContain(`(${compoundAngle(lat).join(',')}),(${compoundAngle(lon).join(',')}),700.`);
  });

  it('refuses settings that are not valid', () => {
    expect(() => createProjectIfc({ ...wisconsin, code: '' })).toThrow(/code/i);
  });
});
