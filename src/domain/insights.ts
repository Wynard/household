// Insights aggregation (6.6). Pure functions over budget and usage files.
import type { BaseUnit, BudgetFile, CookedEntry, PurchaseLine, UsageFile } from './schemas';
import { purchaseCategory, purchaseTitle } from './budget';
import { shiftMonth, weekBucket } from './dates';
import { round2, round3 } from './format';
import { toBase } from './units';

export interface Filters {
  person?: string; // member email
  /** Spending: a budget category. Consumption: an item category. */
  category?: string;
  /** consumption only (item subcategory) */
  subcategory?: string;
}

/** Item lines of receipt purchases (consumption: "bought vs used"). */
export interface SpendLine extends PurchaseLine {
  date: string;
  spentBy: string;
  purchaseId: string;
}

export function spendLines(budgets: BudgetFile[], ym: string, f: Filters): SpendLine[] {
  const out: SpendLine[] = [];
  for (const b of budgets)
    for (const p of b.purchases) {
      if (!p.date.startsWith(ym)) continue;
      if (f.person && p.spentBy !== f.person) continue;
      for (const l of p.lines) {
        if (f.category && l.category !== f.category) continue;
        if (f.subcategory && l.subcategory !== f.subcategory) continue;
        out.push({ ...l, date: p.date, spentBy: p.spentBy, purchaseId: p.id });
      }
    }
  return out;
}

/** One purchase as spending: its total, budget category and who paid. */
export interface SpendRow {
  id: string;
  date: string;
  title: string;
  category: string;
  spentBy: string;
  total: number;
}

export function spendRows(budgets: BudgetFile[], ym: string, f: Filters): SpendRow[] {
  const out: SpendRow[] = [];
  for (const b of budgets)
    for (const p of b.purchases) {
      if (!p.date.startsWith(ym)) continue;
      if (f.person && p.spentBy !== f.person) continue;
      const category = purchaseCategory(p);
      if (f.category && category !== f.category) continue;
      out.push({
        id: p.id,
        date: p.date,
        title: purchaseTitle(p),
        category,
        spentBy: p.spentBy,
        total: p.total,
      });
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

/** Consumption drill-down: categories -> subcategories of the chosen category -> items of the chosen subcategory. */
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
  byCategory: Bar[];
  /** 5 buckets: days 1-7, 8-14, 15-21, 22-28, 29-31 */
  weeks: number[];
  byPerson: Bar[];
  /** the month's purchases (filters applied), newest first */
  purchases: SpendRow[];
  /** contributions this month (person filter applies) */
  moneyIn: number;
  /** last 6 months including this one, oldest first */
  trend: { ym: string; total: number }[];
}

const sumOf = (rows: SpendRow[]) => round2(rows.reduce((t, r) => t + r.total, 0));

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
  const f2 = { person: f.person, category: f.category };
  const rows = spendRows(budgets, ym, f2);
  const total = sumOf(rows);
  const prevTotal = sumOf(
    spendRows(budgets, shiftMonth(ym, -1), f2).filter(
      (r) => !opts.upToDay || Number(r.date.slice(8, 10)) <= opts.upToDay,
    ),
  );
  const weeks = [0, 0, 0, 0, 0];
  for (const r of rows) weeks[weekBucket(r.date)] += r.total;

  let moneyIn = 0;
  for (const b of budgets)
    for (const c of b.contributions)
      if (c.date.startsWith(ym) && (!f.person || c.by === f.person)) moneyIn += c.amount;

  const trend = Array.from({ length: 6 }, (_, i) => {
    const m = shiftMonth(ym, i - 5);
    return { ym: m, total: sumOf(spendRows(budgets, m, f2)) };
  });

  return {
    total,
    comparison: compare(total, prevTotal),
    byCategory: bars(
      rows,
      (r) => r.category,
      (r) => r.total,
    ),
    weeks: weeks.map(round2),
    byPerson: bars(
      rows,
      (r) => r.spentBy,
      (r) => r.total,
    ),
    purchases: rows.slice().sort((a, b) => b.date.localeCompare(a.date)),
    moneyIn: round2(moneyIn),
    trend,
  };
}

// ---------- consumption ----------

const unusedShare = (x: { bought: number; used: number }) =>
  x.bought > 0 ? Math.max(0, x.bought - x.used) / x.bought : 0;

export interface UsageInsights {
  totalValue: number;
  /**
   * false when nothing used has a known price (prices came from receipt lines,
   * which the Budget no longer asks for): amounts are counted, not valued
   */
  valued: boolean;
  distinctItems: number;
  meals: number;
  mostUsed: {
    name: string;
    itemId: string;
    quantity: number;
    unit: BaseUnit;
    value: number;
    /** times it was used */
    times: number;
  }[];
  level: DrillLevel;
  /** lei when valued, else times used */
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
    { name: string; itemId: string; quantity: number; unit: BaseUnit; value: number; times: number }
  >();
  for (const e of entries) {
    const x = byItem.get(e.itemId) ?? {
      name: e.name,
      itemId: e.itemId,
      quantity: 0,
      unit: e.unit,
      value: 0,
      times: 0,
    };
    if (x.unit === e.unit) x.quantity += e.quantity;
    x.value += e.value;
    x.times++;
    byItem.set(e.itemId, x);
  }
  const totalValue = round2(entries.reduce((t, e) => t + e.value, 0));
  const valued = totalValue > 0;
  const level = drillLevel(f);
  const cookedCount = new Map<string, number>();
  for (const c of cooked) cookedCount.set(c.recipeId, (cookedCount.get(c.recipeId) ?? 0) + 1);

  // bought this month (same filters, no store filter) vs used
  const bought = new Map<string, { name: string; unit: BaseUnit; q: number }>();
  for (const l of spendLines(budgets, ym, f)) {
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
    totalValue,
    valued,
    distinctItems: new Set(all.map((e) => e.itemId)).size,
    meals: cooked.length,
    mostUsed: [...byItem.values()]
      .map((x) => ({ ...x, value: round2(x.value), quantity: round3(x.quantity) }))
      .sort((a, b) => (valued ? b.value - a.value : b.times - a.times) || b.quantity - a.quantity)
      .slice(0, 8),
    level,
    byDrill: bars(entries, drillKey(level), (e) => (valued ? e.value : 1)),
    mostCooked: [...cookedCount]
      .map(([recipeId, times]) => ({ recipeId, times }))
      .sort((a, b) => b.times - a.times),
    boughtVsUsed,
    ranOutOf: [...outEvents.values()].sort(
      (a, b) => b.times - a.times || b.last.localeCompare(a.last) || a.name.localeCompare(b.name),
    ),
  };
}
