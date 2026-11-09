import { getCrs, toGeographic } from './crs.js';
import { newGuid } from './ifc-terrain.js';
import { mapConversionFor, validateProjectSettings, type ProjectSettings } from './project.js';
import type { LengthUnit } from './units.js';

/*
 * A new IFC 4.3 project file, written in the browser: units, representation contexts,
 * georeferencing (IfcProjectedCRS and IfcMapConversion) and a site with its latitude and
 * longitude. The same file the Mapform server makes with IfcOpenShell, without a round trip.
 */

export const APP_NAME = 'Mapform';
export const APP_VERSION = '0.1.0';

/** A REAL at full precision, as STEP wants it: always with a decimal point. */
export function stepRealExact(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`Not a number: ${v}`);
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return `${v}.`;
  const s = String(v);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]?\d+)$/i.exec(s);
  if (m) {
    const exp = Number(m[4]);
    return `${m[1]}${m[2]}.${m[3] ?? ''}E${exp < 0 ? '-' : ''}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return s.includes('.') ? s : `${s}.`;
}

const text = (s: string) =>
  `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x20-\x7e]/g, (c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`)}'`;
const optText = (s: string | null | undefined) => (s ? text(s) : '$');

/** Degrees as IFC's compound angle: degrees, minutes, seconds and millionths, all of one sign. */
export function compoundAngle(deg: number): [number, number, number, number] {
  const sign = deg < 0 ? -1 : 1;
  let rest = Math.round(Math.abs(deg) * 3600 * 1e6);
  const millionths = rest % 1e6;
  rest = (rest - millionths) / 1e6;
  const seconds = rest % 60;
  rest = (rest - seconds) / 60;
  const minutes = rest % 60;
  const degrees = (rest - minutes) / 60;
  return [sign * degrees, sign * minutes, sign * seconds, sign * millionths];
}

const FOOT: Record<Exclude<LengthUnit, 'm'>, [string, number]> = {
  ft: ['foot', 0.3048],
  usft: ['US survey foot', 1200 / 3937],
};

/** The text of a new project file. Throws when the settings are not valid. */
export function createProjectIfc(settings: ProjectSettings, now = new Date()): string {
  const problems = validateProjectSettings(settings);
  if (problems.length) throw new Error(problems.join(' '));
  const crs = getCrs(settings.crsEpsg)!;
  const vertical = settings.verticalEpsg !== undefined ? getCrs(settings.verticalEpsg) : undefined;

  const lines: string[] = [];
  let next = 0;
  const add = (entity: string) => {
    const id = `#${++next}`;
    lines.push(`${id}=${entity};`);
    return id;
  };

  const metre = () => add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)');
  const lengthUnit = (unit: LengthUnit) => {
    if (unit === 'm') return metre();
    const [name, factor] = FOOT[unit];
    const dims = add('IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0)');
    const base = metre();
    const measure = add(`IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(${stepRealExact(factor)}),${base})`);
    return add(`IFCCONVERSIONBASEDUNIT(${dims},.LENGTHUNIT.,${text(name)},${measure})`);
  };

  // Units: length, area, volume and degrees for angles.
  const length = lengthUnit(settings.lengthUnit);
  let area: string;
  let volume: string;
  if (settings.lengthUnit === 'm') {
    area = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
    volume = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
  } else {
    // Square and cubic international feet for both kinds of foot: the difference to US survey
    // units is 4 ppm, far below take-off tolerances.
    const d2 = add('IFCDIMENSIONALEXPONENTS(2,0,0,0,0,0,0)');
    const m2 = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)');
    const f2 = add(`IFCMEASUREWITHUNIT(IFCAREAMEASURE(0.09290304),${m2})`);
    area = add(`IFCCONVERSIONBASEDUNIT(${d2},.AREAUNIT.,'square foot',${f2})`);
    const d3 = add('IFCDIMENSIONALEXPONENTS(3,0,0,0,0,0,0)');
    const m3 = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)');
    const f3 = add(`IFCMEASUREWITHUNIT(IFCVOLUMEMEASURE(0.028316846592),${m3})`);
    volume = add(`IFCCONVERSIONBASEDUNIT(${d3},.VOLUMEUNIT.,'cubic foot',${f3})`);
  }
  const d0 = add('IFCDIMENSIONALEXPONENTS(0,0,0,0,0,0,0)');
  const radian = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)');
  const perDegree = add(`IFCMEASUREWITHUNIT(IFCPLANEANGLEMEASURE(${stepRealExact(Math.PI / 180)}),${radian})`);
  const degree = add(`IFCCONVERSIONBASEDUNIT(${d0},.PLANEANGLEUNIT.,'degree',${perDegree})`);
  const units = add(`IFCUNITASSIGNMENT((${length},${area},${volume},${degree}))`);

  // Representation contexts: 3D model with Body and Axis, and a 2D plan.
  const origin = add('IFCCARTESIANPOINT((0.,0.,0.))');
  const up = add('IFCDIRECTION((0.,0.,1.))');
  const east = add('IFCDIRECTION((1.,0.,0.))');
  const world = add(`IFCAXIS2PLACEMENT3D(${origin},${up},${east})`);
  const model = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${world},$)`);
  add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${model},$,.MODEL_VIEW.,$)`);
  add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,${model},$,.GRAPH_VIEW.,$)`);
  const origin2d = add('IFCCARTESIANPOINT((0.,0.))');
  const east2d = add('IFCDIRECTION((1.,0.))');
  const world2d = add(`IFCAXIS2PLACEMENT2D(${origin2d},${east2d})`);
  const plan = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Plan',2,1.E-05,${world2d},$)`);

  const project = add(
    `IFCPROJECT('${newGuid()}',$,${text(settings.code)},$,$,${optText(settings.name)},$,(${model},${plan}),${units})`,
  );

  // Georeferencing: where the project origin sits in the projected system, and how it is turned.
  const mapUnit = crs.unit === settings.lengthUnit ? length : lengthUnit(crs.unit);
  const projected = add(
    `IFCPROJECTEDCRS(${text(`EPSG:${crs.epsg}`)},${text(crs.name)},${optText(crs.datum)},${
      vertical ? text(`EPSG:${vertical.epsg}`) : '$'
    },${optText(crs.projection)},$,${mapUnit})`,
  );
  const mc = mapConversionFor(settings);
  add(
    `IFCMAPCONVERSION(${model},${projected},${stepRealExact(mc.eastings)},${stepRealExact(mc.northings)},${stepRealExact(
      mc.orthogonalHeight,
    )},${stepRealExact(mc.xAxisAbscissa)},${stepRealExact(mc.xAxisOrdinate)},${stepRealExact(mc.scale)})`,
  );

  // The site, with latitude and longitude for programs that do not read IfcMapConversion.
  const siteAxes = add(`IFCAXIS2PLACEMENT3D(${add('IFCCARTESIANPOINT((0.,0.,0.))')},$,$)`);
  const sitePlacement = add(`IFCLOCALPLACEMENT($,${siteAxes})`);
  let latLon = '$,$,$';
  try {
    const [lon, lat] = toGeographic(crs.epsg, settings.origin.easting, settings.origin.northing);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90)
      latLon = `(${compoundAngle(lat).join(',')}),(${compoundAngle(lon).join(',')}),${stepRealExact(settings.origin.elevation)}`;
  } catch {
    // Left out when the point lies outside the system.
  }
  const site = add(`IFCSITE('${newGuid()}',$,'Site',$,$,${sitePlacement},$,$,$,${latLon},$,$)`);
  add(`IFCRELAGGREGATES('${newGuid()}',$,$,$,${project},(${site}))`);

  const stamp = now.toISOString().replace(/\.\d+Z$/, '');
  const app = `${APP_NAME} ${APP_VERSION}`;
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition[DesignTransferView]'),'2;1');",
    `FILE_NAME(${text(`${settings.code}.ifc`)},'${stamp}',(''),(''),${text(app)},${text(app)},'');`,
    "FILE_SCHEMA(('IFC4X3_ADD2'));",
    'ENDSEC;',
    'DATA;',
    ...lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n');
}
