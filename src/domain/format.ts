// Romanian number formatting: "1 500,00 lei" (space as thousands separator,
// comma as decimal). Switch MONEY_STYLE to 'dot' for "1,500.00 lei".
import type { Unit } from './schemas';
import { humanise } from './units';

export const MONEY_STYLE: 'ro' | 'dot' = 'ro';
const NBSP = ' ';
const MINUS = '−';

export function money(n: number, opts: { sign?: boolean } = {}): string {
  const neg = n < -0.004;
  const [int, dec] = Math.abs(n).toFixed(2).split('.');
  const sep = MONEY_STYLE === 'ro' ? '.' : ',';
  const point = MONEY_STYLE === 'ro' ? ',' : '.';
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const sign = neg ? MINUS : opts.sign && n > 0.004 ? '+' : '';
  return `${sign}${grouped}${point}${dec}${NBSP}lei`;
}

/** Plain number with up to 2 decimals and a decimal comma: 2.5 -> "2,5". */
export function num(n: number, maxDecimals = 2): string {
  const f = 10 ** maxDecimals;
  const r = Math.round(n * f) / f;
  const s = String(r);
  return MONEY_STYLE === 'ro' ? s.replace('.', ',') : s;
}

/** "1,5 kg", "6 pcs", "250 g". */
export function qty(q: number, u: Unit): string {
  const h = humanise(q, u);
  return `${num(h.q, 3)}${NBSP}${h.u}`;
}

/**
 * Parses user-typed numbers. Accepts both "," and "." as decimal separators,
 * spaces as thousands separators, and "1.234,5" (Romanian) style.
 * Returns NaN for empty or invalid input.
 */
export function parseDecimal(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  let t = String(input ?? '')
    .trim()
    .replace(/\s/g, '') // \s includes the no-break space
    .replace(/lei$|ron$/i, '');
  if (!t) return NaN;
  const hasComma = t.includes(',');
  const hasDot = t.includes('.');
  if (hasComma && hasDot) {
    // the last separator is the decimal one
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
  } else if (hasComma) {
    t = t.replace(',', '.');
  }
  if (!/^-?\d*\.?\d+$/.test(t) && !/^-?\d+\.?$/.test(t)) return NaN;
  return parseFloat(t);
}

export const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

/** "2026-10" -> "October 2026" */
export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
/** "2026-10" -> "October" */
export const monthName = (ym: string) => MONTHS[Number(ym.slice(5, 7)) - 1];
/** "2026-10-03" -> "3 Oct" */
export const dayLabel = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS_SHORT[Number(date.slice(5, 7)) - 1]}`;
/** "2026-10-03" -> "3 Oct 2026" */
export const dateLabel = (date: string) => `${dayLabel(date)} ${date.slice(0, 4)}`;

/** "12,99 lei/kg", "6,99 lei/l", "4,90 lei each" — per kg / l / piece, whatever unit was bought. */
export function unitPriceLabel(price: number, quantity: number, unit: Unit): string {
  if (!(quantity > 0)) return '';
  if (unit === 'pcs') return `${money(price / quantity)} each`;
  const perBase = unit === 'g' || unit === 'ml' ? price / quantity : price / (quantity * 1000);
  return `${money(perBase * 1000)}/${unit === 'g' || unit === 'kg' ? 'kg' : 'l'}`;
}

/** "Dairy & eggs › Milk", or just "Lactate & oua" when there's no subcategory. */
export const catLabel = (category: string, subcategory?: string) =>
  subcategory ? `${category} › ${subcategory}` : category || 'No category';
