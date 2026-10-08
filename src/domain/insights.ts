// Insights aggregation (6.6). Pure functions over budget and usage files.
import type { BaseUnit, BudgetFile, CookedEntry, PurchaseLine, UsageFile } from './schemas';
import { shiftMonth, weekBucket } from './dates';
import { round2, round3 } from './format';
import { toBase } from './units';

export interface Filters {
  person?: string; // member email
  category?: string;
  subcategory?: string;
  store?: string; // spending only
}

export interface SpendLine extends PurchaseLine {
  date: string;
  store: string;
  spentBy: string;
  purchaseId: string;
}

export function spendLines(budgets: BudgetFile[], ym: string, f: Filters): SpendLine[] {
  const out: SpendLine[] = [];
  for (const b of budgets)
    for (const p of b.purchases) {
      if (!p.date.startsWith(ym)) continue;
      if (f.person && p.spentBy !== f.person) continue;
      if (f.store && p.store !== f.store) continue;
      for (const l of p.lines) {
        if (f.category && l.category !== f.category) continue;
        if (f.subcategory && l.subcategory !== f.subcategory) continue;
        out.push({ ...l, date: p.date, store: p.store, spentBy: p.spentBy, purchaseId: p.id });
      }
    }
  return out;
}

export interface Bar {
  key: string;
  value: number;
  /** share of the total, 0..1 */
  share: number;
  /** relative to the largest bar, 0..1 */
  rel: number;
}

export function bars<T>(rows: T[], key: (r: T) => string, value: (r: T) => number): Bar[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + value(r));
  const list = [...m]
    .map(([k, v]) => ({ key: k, value: round2(v) }))
    .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
  const total = list.reduce((t, x) => t + x.value, 0) || 1;
  const max = list[0]?.value || 1;
  return list.map((x) => ({ ...x, share: x.value / total, rel: x.value / max }));
}

/** Drill-down level: categories -> subcategories of the chosen category -> items of the chosen subcategory. */
export type DrillLevel = 'category' | 'subcategory' | 'item';
export const drillLevel = (f: Filters): DrillLevel =>
  !f.category ? 'category' : !f.subcategory ? 'subcategory' : 'item';
const drillKey = (lvl: DrillLevel) => (l: { category: string; subcategory: string; name: string }) =>
  lvl === 'category' ? l.category : lvl === 'subcategory' ? l.subcategory : l.name;

export interface Comparison {
  /** null when there's nothing to compare with */
  pct: number | null;
  direction: 'more' | 'less' | 'same' | 'none';
  prevTotal: number;
}

export function compare(total: number, prevTotal: number): Comparison {
  if (prevTotal <= 0) return { pct: null, direction: 'none', prevTotal };
  const diff = (total - prevTotal) / prevTotal;
  const pct = Math.round(Math.abs(diff) * 100);
  return { pct, direction: pct === 0 ? 'same' : diff > 0 ? 'more' : 'less', prevTotal };
}

export interface SpendingInsights {
  total: number;
  comparison: Comparison;
  level: DrillLevel;
  byDrill: Bar[];
  /** 5 buckets: days 1-7, 8-14, 15-21, 22-28, 29-31 */
  weeks: number[];
  byPerson: Bar[];
  byStore: Bar[];
  topItems: {
    name: string;
    itemId?: string;
    value: number;
    quantity: number;
    unit: BaseUnit;
    subcategory: string;
  }[];
  /** contributions this month (person filter applies) */
  moneyIn: number;
  /** last 6 months including this one, oldest first */
  trend: { ym: string; total: number }[];
}

/**
 * `upToDay`: for a month still in progress, compare with the same days of the
 * previous month (1st to that day) instead of the whole month.
 */
export function spendingInsights(
  budgets: BudgetFile[],
  ym: string,
  f: Filters,
  opts: { upToDay?: number } = {},
): SpendingInsights {
  const lines = spendLines(budgets, ym, f);
  const total = round2(lines.reduce((t, l) => t + l.price, 0));
  const prevTotal = round2(
    spendLines(budgets, shiftMonth(ym, -1), f)
      .filter((l) => !opts.upToDay || Number(l.date.slice(8, 10)) <= opts.upToDay)
      .reduce((t, l) => t + l.price, 0),
  );
  const level = drillLevel(f);
  const weeks = [0, 0, 0, 0, 0];
  for (const l of lines) weeks[weekBucket(l.date)] += l.price;

  const items = new Map<
    string,
    {
      name: string;
      itemId?: string;
      value: number;
      quantity: number;
      unit: BaseUnit;
      subcategory: string;
    }
  >();
  for (const l of lines) {
    const b = toBase(l.quantity, l.unit);
    const k = l.itemId ?? `name:${l.name.toLowerCase()}`;
    const x = items.get(k) ?? {
      name: l.name,
      itemId: l.itemId,
      value: 0,
      quantity: 0,
      unit: b.u,
      subcategory: l.subcategory,
    };
    x.value += l.price;
    if (x.unit === b.u) x.quantity += b.q;
    items.set(k, x);
  }

  let moneyIn = 0;
  for (const b of budgets)
    for (const c of b.contributions)
      if (c.date.startsWith(ym) && (!f.person || c.by === f.person)) moneyIn += c.amount;

  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(ym, i - 5);
    return { ym: m, total: round2(spendLines(budgets, m, f).reduce((t, l) => t + l.price, 0)) };
  });

  return {
    total,
    comparison: compare(total, prevTotal),
    level,
    byDrill: bars(lines, drillKey(level), (l) => l.price),
    weeks: weeks.map(round2),
    byPerson: bars(
      lines,
      (l) => l.spentBy,
      (l) => l.price,
    ),
    byStore: bars(
      lines,
      (l) => l.store,
      (l) => l.price,
    ),
    topItems: [...items.values()]
      .map((x) => ({ ...x, value: round2(x.value), quantity: round3(x.quantity) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8),
    moneyIn: round2(moneyIn),
    trend,
  };
}

/** Unit price paid over time for one item (per its line unit, normalised to per kg / l / piece). */
export function priceHistory(budgets: BudgetFile[], match: { itemId?: string; name: string }) {
  const out: { date: string; store: string; perUnit: number; unit: 'kg' | 'l' | 'pcs' }[] = [];
  for (const b of budgets)
    for (const p of b.purchases)
      for (const l of p.lines) {
        if (match.itemId ? l.itemId !== match.itemId : l.name.toLowerCase() !== match.name.toLowerCase())
          continue;
        const base = toBase(l.quantity, l.unit);
        if (base.q <= 0) continue;
        const unit = base.u === 'g' ? 'kg' : base.u === 'ml' ? 'l' : 'pcs';
        const per = base.u === 'pcs' ? l.price / base.q : (l.price / base.q) * 1000;
        out.push({ date: p.date, store: p.store, perUnit: round2(per), unit });
      }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- consumption ----------

const unusedShare = (x: { bought: number; used: number }) =>
  x.bought > 0 ? Math.max(0, x.bought - x.used) / x.bought : 0;

export interface UsageInsights {
  totalValue: number;
  distinctItems: number;
  meals: number;
  mostUsed: { name: string; itemId: string; quantity: number; unit: BaseUnit; value: number }[];
  level: DrillLevel;
  byDrill: Bar[];
  mostCooked: { recipeId: string; times: number }[];
  /** per item: bought vs used this month, in base units */
  boughtVsUsed: { name: string; itemId: string; unit: BaseUnit; bought: number; used: number }[];
  /** simple items that were marked Out this month, most often first */
  ranOutOf: { itemId: string; name: string; times: number; last: string }[];
}

export function usageInsights(
  usage: UsageFile[],
  budgets: BudgetFile[],
  ym: string,
  f: Filters,
  /** items tracked as have / low / out: no amounts, so left out of "bought vs used" */
  simpleIds: ReadonlySet<string> = new Set(),
): UsageInsights {
  const all = usage
    .flatMap((u) => u.usage)
    .filter(
      (e) =>
        e.date.startsWith(ym) &&
        (!f.person || e.by === f.person) &&
        (!f.category || e.category === f.category) &&
        (!f.subcategory || e.subcategory === f.subcategory),
    );
  // status events (a simple item went Low / Out) carry no amount or value
  const entries = all.filter((e) => !e.status);
  const outEvents = new Map<string, { itemId: string; name: string; times: number; last: string }>();
  for (const e of all) {
    if (e.status !== 'out') continue;
    const x = outEvents.get(e.itemId) ?? { itemId: e.itemId, name: e.name, times: 0, last: e.date };
    x.times++;
    if (e.date > x.last) x.last = e.date;
    outEvents.set(e.itemId, x);
  }
  const cooked: CookedEntry[] = usage
    .flatMap((u) => u.cooked)
    .filter((c) => c.date.startsWith(ym) && (!f.person || c.by === f.person));
  const byItem = new Map<
    string,
    { name: string; itemId: string; quantity: number; unit: BaseUnit; value: number }
  >();
  for (const e of entries) {
    const x = byItem.get(e.itemId) ?? { name: e.name, itemId: e.itemId, quantity: 0, unit: e.unit, value: 0 };
    if (x.unit === e.unit) x.quantity += e.quantity;
    x.value += e.value;
    byItem.set(e.itemId, x);
  }
  const level = drillLevel(f);
  const cookedCount = new Map<string, number>();
  for (const c of cooked) cookedCount.set(c.recipeId, (cookedCount.get(c.recipeId) ?? 0) + 1);

  // bought this month (same filters, no store filter) vs used
  const bought = new Map<string, { name: string; unit: BaseUnit; q: number }>();
  for (const l of spendLines(budgets, ym, { ...f, store: undefined })) {
    if (!l.itemId) continue;
    const b = toBase(l.quantity, l.unit);
    const x = bought.get(l.itemId) ?? { name: l.name, unit: b.u, q: 0 };
    if (x.unit === b.u) x.q += b.q;
    bought.set(l.itemId, x);
  }
  const ids = new Set([...bought.keys(), ...byItem.keys()]);
  const boughtVsUsed = [...ids]
    .map((id) => {
      const b = bought.get(id);
      const u = byItem.get(id);
      const unit = b?.unit ?? u!.unit;
      return {
        name: u?.name ?? b!.name,
        itemId: id,
        unit,
        bought: round3(b && b.unit === unit ? b.q : 0),
        used: round3(u && u.unit === unit ? u.quantity : 0),
      };
    })
    .filter((x) => x.bought > 0 && !simpleIds.has(x.itemId))
    // possible waste first: the biggest share of what was bought that wasn't used
    .sort((a, b) => unusedShare(b) - unusedShare(a) || b.bought - a.bought);

  return {
    totalValue: round2(entries.reduce((t, e) => t + e.value, 0)),
    distinctItems: new Set(all.map((e) => e.itemId)).size,
    meals: cooked.length,
    mostUsed: [...byItem.values()]
      .map((x) => ({ ...x, value: round2(x.value), quantity: round3(x.quantity) }))
      .sort((a, b) => b.value - a.value || b.quantity - a.quantity)
      .slice(0, 8),
    level,
    byDrill: bars(entries, drillKey(level), (e) => e.value),
    mostCooked: [...cookedCount]
      .map(([recipeId, times]) => ({ recipeId, times }))
      .sort((a, b) => b.times - a.times),
    boughtVsUsed,
    ranOutOf: [...outEvents.values()].sort(
      (a, b) => b.times - a.times || b.last.localeCompare(a.last) || a.name.localeCompare(b.name),
    ),
  };
}
