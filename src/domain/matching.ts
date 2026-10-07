// Receipt line matching (6.7, 7): alias exact match -> normalised fuzzy match
// -> Gemini's suggestion. Returns the item and how sure we are.
import { normalise } from './categorise';
import type { Item } from './schemas';

export interface Match {
  itemId?: string;
  via: 'alias' | 'fuzzy' | 'gemini' | 'none';
  confidence: number;
}

/** Drops sizes, percentages and pack counts so "LAPTE ZUZU 1,5% 1L" ~ "lapte zuzu". */
export function coreWords(s: string): string[] {
  return normalise(s)
    .replace(/\b\d+([.,]\d+)?\s*(%|g|gr|kg|ml|l|buc|x|pcs)?\b/g, ' ')
    .split(/\s+/)
    .filter(
      (w) => w.length >= 2 && !['buc', 'x', 'kg', 'g', 'ml', 'l', 'la', 'de', 'cu', 'si', 'pt'].includes(w),
    );
}

/**
 * Words that make a different product, not a different brand or size: fresh vs
 * frozen peas, oat milk vs milk, toothpaste ("pasta dinti") vs pasta, cat litter
 * ("nisip tofu") vs tofu. Two names with different kinds never match.
 */
const KINDS: [RegExp, string][] = [
  [/^(congel|surgel|frozen|freez)/, 'frozen'],
  [/^(fresh|proasp)/, 'fresh'],
  [/^(uscat|dried|deshidrat)/, 'dried'],
  [/^(ovaz|oat)/, 'oat'],
  [/^(soia|soy)/, 'soy'],
  [/^(migdal|almond)/, 'almond'],
  [/^(cocos|coconut)/, 'coconut'],
  [/^(dinti|tooth|dentifric|dental)/, 'teeth'],
  [/^(nisip|litter|asternut)/, 'litter'],
  [/^(decofein|decaf)/, 'decaf'],
];

export function kindsOf(s: string): string {
  const out = new Set<string>();
  for (const w of coreWords(s)) for (const [re, k] of KINDS) if (re.test(w)) out.add(k);
  return [...out].sort().join(',');
}

const sameKind = (a: string, b: string) => kindsOf(a) === kindsOf(b);
const sameHead = (a: string, b: string) => {
  const x = coreWords(a)[0];
  const y = coreWords(b)[0];
  return !!x && !!y && (x === y || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y)));
};

/** Dice coefficient over word-prefix tokens (handles receipt abbreviations: "PIEPT PUI" ~ "piept de pui"). */
export function similarity(a: string, b: string): number {
  const A = coreWords(a);
  const B = coreWords(b);
  if (!A.length || !B.length) return 0;
  let hits = 0;
  const used = new Set<number>();
  for (const x of A) {
    const j = B.findIndex(
      (y, k) =>
        !used.has(k) && (y === x || (x.length >= 3 && y.startsWith(x)) || (y.length >= 3 && x.startsWith(y))),
    );
    if (j >= 0) {
      used.add(j);
      hits++;
    }
  }
  return (2 * hits) / (A.length + B.length);
}

export function matchReceiptLine(
  raw: string,
  name: string,
  items: Item[],
  gemini?: { itemId?: string | null; confidence?: number },
): Match {
  const live = items.filter((i) => !i.archived);
  // 1. exact alias or name (raw receipt text first, then the cleaned-up name)
  for (const s of [raw, name]) {
    const n = normalise(s);
    if (!n) continue;
    const hit = live.find((i) => i.aliases.some((a) => normalise(a) === n) || normalise(i.name) === n);
    if (hit) return { itemId: hit.id, via: 'alias', confidence: 0.98 };
  }
  // 2. normalised fuzzy match
  let best: { item: Item; score: number } | null = null;
  // the line's kind (frozen, oat, teeth…) comes from the cleaned-up name and the raw text together
  const lineKind = `${name} ${raw}`;
  for (const i of live) {
    if (!sameKind(lineKind, i.name)) continue;
    const score = Math.max(
      similarity(name, i.name),
      similarity(raw, i.name),
      ...i.aliases.map((a) => similarity(raw, a)),
    );
    if (!best || score > best.score) best = { item: i, score };
  }
  const suggested = gemini?.itemId ? live.find((i) => i.id === gemini.itemId) : undefined;
  // Gemini can fall for the same traps: never accept a match of a different kind
  const geminiItem = suggested && sameKind(lineKind, suggested.name) ? suggested : undefined;
  if (best && best.score >= 0.8)
    return { itemId: best.item.id, via: 'fuzzy', confidence: Math.min(0.95, best.score) };
  // 3. Gemini's suggestion (only if it names a real item)
  if (geminiItem) {
    const c = gemini?.confidence ?? 0.6;
    // agreement with a weaker fuzzy match raises confidence
    return {
      itemId: geminiItem.id,
      via: 'gemini',
      confidence: best?.item.id === geminiItem.id ? Math.max(c, 0.8) : Math.min(c, 0.85),
    };
  }
  // a weak match needs the same head word: "Nisip tofu" is not "Tofu"
  if (best && best.score >= 0.6 && (sameHead(name, best.item.name) || sameHead(raw, best.item.name)))
    return { itemId: best.item.id, via: 'fuzzy', confidence: 0.55 };
  return { via: 'none', confidence: gemini?.confidence ?? 0.5 };
}
