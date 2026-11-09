import { describe, expect, it } from 'vitest';
import {
  convertLength,
  getCrs,
  mapConversionFor,
  searchCrs,
  suggestPl2000Zone,
  toGeographic,
  toProjected,
  validateProjectSettings,
  type ProjectSettings,
} from '../src/index.js';

describe('units', () => {
  it('converts between metres, feet and US survey feet', () => {
    expect(convertLength(1, 'ft', 'm')).toBeCloseTo(0.3048, 12);
    expect(convertLength(1, 'usft', 'm')).toBeCloseTo(1200 / 3937, 12);
    expect(convertLength(1000, 'usft', 'ft')).toBeCloseTo(1000.002, 3);
  });
});

describe('coordinate systems', () => {
  it('knows Polish and US State Plane systems with the right units', () => {
    expect(getCrs(2178)?.name).toBe('ETRF2000-PL / CS2000/21');
    expect(getCrs(2178)?.unit).toBe('m');
    expect(getCrs(2289)?.name).toBe('NAD83 / Wisconsin South (ftUS)');
    expect(getCrs(2289)?.unit).toBe('usft');
    expect(getCrs(9651)?.kind).toBe('vertical');
  });

  it('finds systems by code and by words', () => {
    expect(searchCrs('2178')[0]?.epsg).toBe(2178);
    expect(searchCrs('wisconsin south ftus').map((c) => c.epsg)).toContain(2289);
  });

  it('picks the CS2000 zone from longitude', () => {
    expect(suggestPl2000Zone(14.6)).toBe(2176); // Szczecin
    expect(suggestPl2000Zone(17.0)).toBe(2177); // Wroclaw
    expect(suggestPl2000Zone(19.94)).toBe(2178); // Krakow
    expect(suggestPl2000Zone(23.2)).toBe(2179); // Bialystok
  });

  // Reference values computed with PROJ 9.8 (pyproj).
  it.each([
    [2178, 19.9449, 50.0647, 7424461.9412, 5548149.7309],
    [2180, 19.9449, 50.0647, 567606.4645, 244587.4407],
    [2289, -87.9065, 43.0389, 2528119.1339, 385672.222],
    [2240, -84.388, 33.749, 2229307.3948, 1363801.4941],
  ])('projects EPSG:%i within 1 cm of PROJ', (epsg, lon, lat, x, y) => {
    const [px, py] = toProjected(epsg, lon, lat);
    expect(Math.abs(px - x)).toBeLessThan(0.01);
    expect(Math.abs(py - y)).toBeLessThan(0.01);
    const [blon, blat] = toGeographic(epsg, px, py);
    expect(blon).toBeCloseTo(lon, 8);
    expect(blat).toBeCloseTo(lat, 8);
  });
});

describe('project settings', () => {
  const base: ProjectSettings = {
    name: 'Test campus',
    code: 'TST01',
    crsEpsg: 2289,
    verticalEpsg: 6360,
    lengthUnit: 'ft',
    origin: { easting: 2528000, northing: 385600, elevation: 700 },
    rotationDeg: 90,
  };

  it('accepts valid settings', () => {
    expect(validateProjectSettings(base)).toEqual([]);
  });

  it('reports every problem', () => {
    const errors = validateProjectSettings({
      ...base,
      name: ' ',
      code: 'bad code',
      crsEpsg: 9651,
      rotationDeg: Number.NaN,
    });
    expect(errors).toHaveLength(4);
  });

  it('builds IfcMapConversion values with unit scale and rotation', () => {
    const mc = mapConversionFor(base);
    expect(mc.eastings).toBe(2528000);
    expect(mc.xAxisAbscissa).toBe(0);
    expect(mc.xAxisOrdinate).toBe(1);
    // International feet modelled in a US survey feet system.
    expect(mc.scale).toBeCloseTo(0.999998, 6);
    expect(mapConversionFor({ ...base, crsEpsg: 2178, lengthUnit: 'm', rotationDeg: 0 }).scale).toBe(1);
  });
});
