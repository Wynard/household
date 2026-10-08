import { MEASURE_UNITS, UNITS, type BaseUnit, type RecipeUnit, type Unit } from './schemas';

/** Counted one by one: pcs and a household's own units (can, jar…). A piece weight converts them to grams. */
export const isCountUnit = (u: string) => !['g', 'kg', 'ml', 'l'].includes(u) && !isMeasure(u);
const isMeasure = (u: string) => (MEASURE_UNITS as readonly string[]).includes(u);

/** Converts to the base unit (g, ml or pcs). */
export function toBase(q: number, u: Unit): { q: number; u: BaseUnit } {
  if (u === 'kg') return { q: q * 1000, u: 'g' };
  if (u === 'l') return { q: q * 1000, u: 'ml' };
  return { q, u };
}

export const baseOf = (u: Unit): BaseUnit => toBase(1, u).u;

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Converts a quantity between stock units. Uses `gramsPerPiece` for pcs <-> g/kg.
 * Returns null when the conversion is impossible (e.g. ml -> g, or pcs -> g with
 * no piece weight) instead of guessing.
 */
export function convert(q: number, from: Unit, to: Unit, gramsPerPiece?: number): number | null {
  if (from === to) return q;
  const a = toBase(q, from);
  const bFactor = toBase(1, to);
  if (a.u === bFactor.u) return r6(a.q / bFactor.q);
  if (gramsPerPiece && gramsPerPiece > 0) {
    if (isCountUnit(a.u) && bFactor.u === 'g') return r6((a.q * gramsPerPiece) / bFactor.q);
    if (a.u === 'g' && isCountUnit(bFactor.u)) return r6(a.q / gramsPerPiece);
  }
  return null;
}

/** Recipe units that can be compared to stock. Spoons/cups/pinch are not tracked. */
export function isStockUnit(u: RecipeUnit | undefined): u is Unit {
  return !!u && !isMeasure(u);
}

/** Picks a readable unit for display: 1500 g -> 1,5 kg. */
export function humanise(q: number, u: Unit): { q: number; u: Unit } {
  if (u === 'g' && Math.abs(q) >= 1000) return { q: q / 1000, u: 'kg' };
  if (u === 'ml' && Math.abs(q) >= 1000) return { q: q / 1000, u: 'l' };
  return { q, u };
}

/** Built-in units followed by the household's own (can, jar…). */
export const allUnits = (household?: { units?: string[] }): string[] => [
  ...UNITS,
  ...(household?.units ?? []).filter((u) => !(UNITS as readonly string[]).includes(u)),
];
