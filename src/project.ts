import { getCrs } from './crs.js';
import { isLengthUnit, METRES_PER_UNIT, type LengthUnit } from './units.js';

/**
 * Project-wide settings that every Mapform project starts from.
 *
 * Coordinates of the origin are given in the unit of the projected system,
 * because that is how surveyors and clients hand them over.
 */
export interface ProjectSettings {
  name: string;
  /** Short project code used in file names, e.g. "MKE07". */
  code: string;
  /** Projected coordinate system (EPSG code). */
  crsEpsg: number;
  /** Vertical datum (EPSG code), optional. */
  verticalEpsg?: number;
  /** Unit used for modelling inside the project. */
  lengthUnit: LengthUnit;
  /** Point of the projected system that becomes the project origin (0,0,0). */
  origin: { easting: number; northing: number; elevation: number };
  /**
   * Angle in degrees, counter-clockwise, from the map easting axis to the
   * project X axis. 0 means the project grid is aligned with the map grid.
   */
  rotationDeg: number;
}

/** Values for IfcMapConversion, in the order of the IFC 4.3 schema. */
export interface MapConversion {
  eastings: number;
  northings: number;
  orthogonalHeight: number;
  xAxisAbscissa: number;
  xAxisOrdinate: number;
  /** Factor from project length units to map units. */
  scale: number;
}

export function mapConversionFor(settings: ProjectSettings): MapConversion {
  const crs = getCrs(settings.crsEpsg);
  if (!crs) throw new Error(`Unknown EPSG:${settings.crsEpsg}`);
  const rad = (settings.rotationDeg * Math.PI) / 180;
  return {
    eastings: settings.origin.easting,
    northings: settings.origin.northing,
    orthogonalHeight: settings.origin.elevation,
    xAxisAbscissa: round(Math.cos(rad)),
    xAxisOrdinate: round(Math.sin(rad)),
    scale: METRES_PER_UNIT[settings.lengthUnit] / METRES_PER_UNIT[crs.unit],
  };
}

/** Return a list of problems; an empty list means the settings are valid. */
export function validateProjectSettings(settings: ProjectSettings): string[] {
  const errors: string[] = [];
  if (!settings.name.trim()) errors.push('Project name is required.');
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(settings.code)) {
    errors.push('Project code: 1-32 characters, letters, digits, "-" or "_".');
  }

  const crs = getCrs(settings.crsEpsg);
  if (!crs || crs.kind !== 'projected') {
    errors.push(`EPSG:${settings.crsEpsg} is not a supported projected coordinate system.`);
  }
  if (settings.verticalEpsg !== undefined) {
    const v = getCrs(settings.verticalEpsg);
    if (!v || v.kind !== 'vertical') {
      errors.push(`EPSG:${settings.verticalEpsg} is not a supported vertical datum.`);
    }
  }

  if (!isLengthUnit(settings.lengthUnit)) errors.push('Unsupported length unit.');

  const { easting, northing, elevation } = settings.origin;
  if (![easting, northing, elevation].every(Number.isFinite)) {
    errors.push('Origin coordinates must be numbers.');
  }
  if (!Number.isFinite(settings.rotationDeg) || Math.abs(settings.rotationDeg) > 360) {
    errors.push('Rotation must be a number between -360 and 360 degrees.');
  }
  return errors;
}

function round(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}
