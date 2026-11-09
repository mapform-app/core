/** Length units supported by Mapform projects and coordinate systems. */
export type LengthUnit = 'm' | 'ft' | 'usft';

/** Exact length of one unit in metres. */
export const METRES_PER_UNIT: Readonly<Record<LengthUnit, number>> = {
  m: 1,
  ft: 0.3048,
  usft: 1200 / 3937,
};

export const LENGTH_UNIT_LABELS: Readonly<Record<LengthUnit, string>> = {
  m: 'Metres',
  ft: 'International feet',
  usft: 'US survey feet',
};

export const LENGTH_UNIT_SYMBOLS: Readonly<Record<LengthUnit, string>> = {
  m: 'm',
  ft: 'ft',
  usft: 'US ft',
};

export function isLengthUnit(value: unknown): value is LengthUnit {
  return value === 'm' || value === 'ft' || value === 'usft';
}

/** Convert a length between units. */
export function convertLength(value: number, from: LengthUnit, to: LengthUnit): number {
  if (from === to) return value;
  return (value * METRES_PER_UNIT[from]) / METRES_PER_UNIT[to];
}
