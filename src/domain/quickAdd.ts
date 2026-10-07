import type { Unit } from './schemas';
import { parseDecimal } from './format';

const UNIT_WORDS: Record<string, Unit> = {
  g: 'g',
  gr: 'g',
  grams: 'g',
  gram: 'g',
  grame: 'g',
  kg: 'kg',
  kilo: 'kg',
  kilos: 'kg',
  kilograms: 'kg',
  ml: 'ml',
  l: 'l',
  litre: 'l',
  liter: 'l',
  litres: 'l',
  liters: 'l',
  litri: 'l',
  litru: 'l',
  pcs: 'pcs',
  pc: 'pcs',
  buc: 'pcs',
  bucati: 'pcs',
  x: 'pcs',
};

/**
 * Parses quick shopping input: "2 kg potatoes", "cartofi 2kg", "milk 2 l",
 * "6 eggs", "bread". Returns the name and an optional amount/unit.
 */
export function parseQuickAdd(input: string): { name: string; amount?: number; unit?: Unit } {
  const t = input.trim().replace(/\s+/g, ' ');
  const num = '(\\d+(?:[.,]\\d+)?)';
  const unit = `(${Object.keys(UNIT_WORDS).join('|')})`;
  // leading: "2 kg potatoes" / "2kg potatoes" / "6 eggs" / "2x bread"
  let m = t.match(new RegExp(`^${num}\\s*${unit}?\\.?\\s+(.+)$`, 'i'));
  if (m) {
    const amount = parseDecimal(m[1]);
    const u = m[2] ? UNIT_WORDS[m[2].toLowerCase()] : 'pcs';
    if (amount > 0 && m[3].trim()) return { name: cap(m[3]), amount, unit: u };
  }
  // trailing: "potatoes 2 kg" / "milk 2l"
  m = t.match(new RegExp(`^(.+?)\\s+${num}\\s*${unit}?$`, 'i'));
  if (m) {
    const amount = parseDecimal(m[2]);
    const u = m[3] ? UNIT_WORDS[m[3].toLowerCase()] : 'pcs';
    if (amount > 0) return { name: cap(m[1]), amount, unit: u };
  }
  return { name: cap(t) };
}

const cap = (s: string) => {
  const x = s.trim();
  return x.charAt(0).toUpperCase() + x.slice(1);
};
