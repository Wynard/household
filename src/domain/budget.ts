import { budgetFileName, emptyFile, usageFileName } from './files';
import { O, type Op } from './ops';
import type { BudgetFile, Contribution, PotAdjustment, Purchase } from './schemas';
import type { Ctx } from './actions/types';
import { round2 } from './format';

export const sumContributions = (b: BudgetFile) => b.contributions.reduce((t, c) => t + c.amount, 0);
export const sumPurchases = (b: BudgetFile) => b.purchases.reduce((t, p) => t + p.total, 0);
export const sumAdjustments = (b: BudgetFile) => b.adjustments.reduce((t, a) => t + a.amount, 0);

/** opening + contributions − purchases ± adjustments for one year. */
export const closingBalance = (b: BudgetFile) =>
  round2(b.openingBalance + sumContributions(b) - sumPurchases(b) + sumAdjustments(b));

/**
 * All-time pot balance. The earliest year's opening balance is the starting
 * money; later years' opening balances are just carried-over copies, so they
 * are ignored here (this stays correct even if an old year is edited later).
 */
export function potBalance(budgets: BudgetFile[]): number {
  if (!budgets.length) return 0;
  const sorted = budgets.slice().sort((a, b) => a.year - b.year);
  let bal = sorted[0].openingBalance;
  for (const b of sorted) bal += sumContributions(b) - sumPurchases(b) + sumAdjustments(b);
  return round2(bal);
}

export type LedgerEntry =
  | { kind: 'in'; id: string; date: string; time?: string; by: string; amount: number; c: Contribution }
  | { kind: 'out'; id: string; date: string; time?: string; by: string; amount: number; p: Purchase }
  | { kind: 'adj'; id: string; date: string; time?: string; by: string; amount: number; a: PotAdjustment };

/** Shown for purchases saved before budget categories existed. */
export const NO_CATEGORY = 'No category';
export const purchaseCategory = (p: Purchase) => p.category ?? NO_CATEGORY;
/** "Electricity for June", else the store, else the category. */
export const purchaseTitle = (p: Purchase) => p.purpose || p.store || purchaseCategory(p);

/**
 * Order within a day: the time typed on a purchase, else when it was saved
 * (to the millisecond, so a whole imported sheet keeps its row order).
 */
const orderKey = (date: string, time: string | undefined, createdAt: string | undefined) =>
  `${date} ${time ?? createdAt?.slice(11, 23) ?? ''}`;

/** Chronological ledger (oldest first) with the pot balance after each row. */
export function ledger(budgets: BudgetFile[]): (LedgerEntry & { balanceAfter: number })[] {
  const sorted = budgets.slice().sort((a, b) => a.year - b.year);
  const rows: (LedgerEntry & { key: string })[] = [];
  for (const b of sorted) {
    for (const c of b.contributions)
      rows.push({
        kind: 'in',
        id: c.id,
        date: c.date,
        by: c.by,
        amount: c.amount,
        c,
        time: c.createdAt.slice(11, 16),
        key: orderKey(c.date, undefined, c.createdAt),
      });
    for (const p of b.purchases)
      rows.push({
        kind: 'out',
        id: p.id,
        date: p.date,
        time: p.time,
        by: p.spentBy,
        amount: p.total,
        p,
        key: orderKey(p.date, p.time, p.createdAt),
      });
    for (const a of b.adjustments)
      rows.push({
        kind: 'adj',
        id: a.id,
        date: a.date,
        by: a.by,
        amount: a.amount,
        a,
        time: a.createdAt?.slice(11, 16),
        key: orderKey(a.date, undefined, a.createdAt),
      });
  }
  rows.sort((x, y) => x.key.localeCompare(y.key));
  let bal = sorted[0]?.openingBalance ?? 0;
  return rows.map(({ key: _key, ...r }) => {
    bal += r.kind === 'out' ? -r.amount : r.amount;
    return { ...r, balanceAfter: round2(bal) };
  });
}

/** Pot balance at the start of a month (YYYY-MM). */
export function balanceBefore(budgets: BudgetFile[], ym: string): number {
  const sorted = budgets.slice().sort((a, b) => a.year - b.year);
  let bal = sorted[0]?.openingBalance ?? 0;
  for (const r of ledger(budgets)) {
    if (r.date.slice(0, 7) >= ym) break;
    bal = r.balanceAfter;
  }
  return round2(bal);
}

/**
 * Descriptions used before in a category, most used first (for one-tap
 * suggestions when adding a purchase).
 */
export function recentDescriptions(budgets: BudgetFile[], category: string, limit = 4): string[] {
  const count = new Map<string, { text: string; n: number; last: string }>();
  for (const b of budgets)
    for (const p of b.purchases) {
      if (p.category !== category || !p.purpose?.trim()) continue;
      const k = p.purpose.trim().toLowerCase();
      const x = count.get(k) ?? { text: p.purpose.trim(), n: 0, last: '' };
      x.n++;
      if (p.date >= x.last) {
        x.last = p.date;
        x.text = p.purpose.trim(); // the latest spelling
      }
      count.set(k, x);
    }
  return [...count.values()]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, limit)
    .map((x) => x.text);
}

/** Purchases per budget category (for Settings: what can be deleted). */
export function budgetCategoryUse(budgets: BudgetFile[], category: string): number {
  let n = 0;
  for (const b of budgets) for (const p of b.purchases) if (p.category === category) n++;
  return n;
}

export interface MonthSummary {
  contributed: number;
  spent: number;
  byPerson: Record<string, { in: number; out: number }>;
  target: number;
  /** spent / target (0 when there's no target) */
  progress: number;
  tone: 'ok' | 'warn' | 'over';
}

export function monthSummary(
  budgets: BudgetFile[],
  ym: string,
  target: number,
  members: string[],
): MonthSummary {
  const byPerson: MonthSummary['byPerson'] = {};
  for (const m of members) byPerson[m] = { in: 0, out: 0 };
  let contributed = 0;
  let spent = 0;
  for (const b of budgets) {
    for (const c of b.contributions)
      if (c.date.startsWith(ym)) {
        contributed += c.amount;
        (byPerson[c.by] ??= { in: 0, out: 0 }).in += c.amount;
      }
    for (const p of b.purchases)
      if (p.date.startsWith(ym)) {
        spent += p.total;
        (byPerson[p.spentBy] ??= { in: 0, out: 0 }).out += p.total;
      }
  }
  const progress = target > 0 ? spent / target : 0;
  return {
    contributed: round2(contributed),
    spent: round2(spent),
    byPerson,
    target,
    progress,
    tone: progress > 1 ? 'over' : progress > 0.8 ? 'warn' : 'ok',
  };
}

/**
 * Ops that make sure the budget and usage files for `year` exist. The first
 * entry of a new year creates budget-YYYY.json with the previous year's
 * closing balance as its opening balance (year rollover).
 */
export function ensureYearOps(ctx: Ctx, year: number): Op[] {
  if (ctx.snap.household.years.includes(year) && ctx.snap.budgets[year]) return [];
  const prevYears = Object.values(ctx.snap.budgets)
    .filter((b) => b.year < year)
    .sort((a, b) => b.year - a.year);
  const opening = prevYears.length ? closingBalance(prevYears[0]) : 0;
  const ops: Op[] = [];
  if (!ctx.snap.budgets[year])
    ops.push({
      t: 'init',
      file: budgetFileName(year),
      value: emptyFile(budgetFileName(year), ctx.me.email, { openingBalance: opening }) as Record<
        string,
        unknown
      >,
    });
  if (!ctx.snap.usage[year])
    ops.push({
      t: 'init',
      file: usageFileName(year),
      value: emptyFile(usageFileName(year), ctx.me.email) as Record<string, unknown>,
    });
  if (!ctx.snap.household.years.includes(year)) ops.push(O.household.addYear(year));
  return ops;
}
