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
  for (const i of live) {
    const score = Math.max(
      similarity(name, i.name),
      similarity(raw, i.name),
      ...i.aliases.map((a) => similarity(raw, a)),
    );
    if (!best || score > best.score) best = { item: i, score };
  }
  const geminiItem = gemini?.itemId ? live.find((i) => i.id === gemini.itemId) : undefined;
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
  if (best && best.score >= 0.6) return { itemId: best.item.id, via: 'fuzzy', confidence: 0.55 };
  return { via: 'none', confidence: gemini?.confidence ?? 0.5 };
}
