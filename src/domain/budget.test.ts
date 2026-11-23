import { describe, expect, it } from 'vitest';
import { balanceBefore, closingBalance, ledger, monthSummary, potBalance } from './budget';
import { ACTIONS, applyToSnapshot, planAction } from './actions';
import { makeCtx, seedSnapshot } from '../test/ctx';
import type { BudgetFile } from './schemas';

const env = { schemaVersion: 1, updatedAt: 'x', updatedBy: 'x' };
const year = (y: number, opening: number, over: Partial<BudgetFile> = {}): BudgetFile => ({
  ...env,
  year: y,
  openingBalance: opening,
  contributions: [],
  purchases: [],
  adjustments: [],
  deleted: [],
  ...over,
});
const c = (id: string, date: string, by: string, amount: number) => ({
  id,
  date,
  by,
  amount,
  createdAt: `${date}T09:00:00Z`,
});
const p = (id: string, date: string, spentBy: string, total: number) => ({
  id,
  date,
  store: 'Lidl',
  spentBy,
  lines: [],
  total,
  source: 'manual' as const,
  createdBy: 'Ana',
  createdAt: `${date}T10:00:00Z`,
});

describe('budget math', () => {
  const b = year(2026, 100, {
    contributions: [c('c1', '2026-09-01', 'a', 500), c('c2', '2026-10-01', 'b', 300)],
    purchases: [p('p1', '2026-09-10', 'a', 120.5), p('p2', '2026-10-02', 'b', 80.25)],
    adjustments: [{ id: 'j', date: '2026-10-03', by: 'a', amount: -4.25, reason: 'bank fee' }],
  });

  it('pot balance = opening + contributions − purchases ± adjustments', () => {
    expect(potBalance([b])).toBe(695);
    expect(closingBalance(b)).toBe(695);
  });

  it('per-person and per-month totals, and progress vs target', () => {
    const s = monthSummary([b], '2026-10', 100, ['a', 'b']);
    expect(s).toMatchObject({ contributed: 300, spent: 80.25, tone: 'warn' });
    expect(s.byPerson).toEqual({ a: { in: 0, out: 0 }, b: { in: 300, out: 80.25 } });
    expect(monthSummary([b], '2026-10', 50, ['a', 'b']).tone).toBe('over');
    expect(monthSummary([b], '2026-10', 1000, ['a', 'b']).tone).toBe('ok');
  });

  it('ledger has a running balance and the balance at the start of a month', () => {
    const rows = ledger([b]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([600, 479.5, 779.5, 699.25, 695]);
    expect(balanceBefore([b], '2026-10')).toBe(479.5);
  });

  it('later years only carry the opening balance, so editing an old year stays correct', () => {
    const y1 = year(2026, 100, { contributions: [c('c1', '2026-12-01', 'a', 50)] });
    const y2 = year(2027, 150, { purchases: [p('p1', '2027-01-02', 'a', 20)] });
    expect(potBalance([y2, y1])).toBe(130);
  });
});

describe('budget actions', () => {
  it('adds a manual purchase with stock, last price and a new store', () => {
    const ctx = makeCtx();
    const plan = planAction(ACTIONS.addPurchase, ctx, {
      store: 'Market stall',
      date: '2026-10-07',
      spentBy: 'mihai@example.com',
      lines: [
        {
          itemId: 'potatoes',
          name: 'Potatoes',
          quantity: 2,
          unit: 'kg',
          price: 10,
          category: 'Produce',
          subcategory: 'Vegetables',
          toStock: true,
        },
      ],
    });
    expect(plan.title).toBe('Add a purchase of 10,00 lei');
    expect(plan.lines).toEqual([
      'Market stall, 7 Oct, paid by Mihai',
      'Potatoes, 2 kg, 10,00 lei, Produce › Vegetables',
      'Stock: Potatoes 2,5 kg → 4,5 kg, Pantry',
    ]);
    const { snap, inverse } = applyToSnapshot(ctx.snap, plan.ops);
    expect(snap.household.stores).toContain('Market stall');
    const pot = snap.items.items.find((i) => i.id === 'potatoes')!;
    expect(pot.quantity).toBe(4.5);
    expect(pot.lastPrice).toEqual({ amount: 5, per: 'kg', date: '2026-10-07', store: 'Market stall' });
    expect(potBalance(Object.values(snap.budgets))).toBe(
      round(potBalance(Object.values(ctx.snap.budgets)) - 10),
    );
    expect(snap.budgets[2026].purchases.at(-1)).toMatchObject({
      createdBy: 'Ana',
      total: 10,
      source: 'manual',
    });
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('creates items for new lines added to stock, and learns receipt spellings', () => {
    const ctx = makeCtx();
    const plan = planAction(ACTIONS.addPurchase, ctx, {
      store: 'lidl',
      date: '2026-10-07',
      spentBy: 'ana@example.com',
      source: 'receipt',
      total: 19.48,
      lines: [
        {
          name: 'Hummus',
          rawText: 'HUMUS CLASIC 200G',
          quantity: 200,
          unit: 'g',
          price: 6.99,
          category: 'Pantry',
          subcategory: 'Canned & jars',
          toStock: true,
          place: 'Fridge',
        },
        {
          itemId: 'eggs',
          name: 'Eggs',
          rawText: 'OUA L 10 BUC',
          quantity: 10,
          unit: 'pcs',
          price: 12.49,
          category: 'Dairy & eggs',
          subcategory: 'Eggs',
          toStock: true,
          learnAlias: true,
        },
      ],
      checkShoppingIds: ['sh2'],
    });
    const { snap } = applyToSnapshot(ctx.snap, plan.ops);
    const hummus = snap.items.items.find((i) => i.name === 'Hummus')!;
    // new items start simple: bought means "Have"
    expect(hummus).toMatchObject({
      place: 'Fridge',
      tracking: 'simple',
      status: 'have',
      aliases: ['HUMUS CLASIC 200G'],
    });
    expect(snap.items.items.find((i) => i.id === 'eggs')!.aliases).toContain('OUA L 10 BUC');
    expect(snap.shopping.items.find((s) => s.id === 'sh2')!.checked).toBe(true);
    expect(snap.budgets[2026].purchases.at(-1)!.store).toBe('Lidl'); // matched the existing store
  });

  it('blocks impossible stock units with a clear message', () => {
    const ctx = makeCtx();
    const plan = planAction(ACTIONS.addPurchase, ctx, {
      store: 'Lidl',
      date: '2026-10-07',
      spentBy: 'ana@example.com',
      lines: [
        {
          itemId: 'milk',
          name: 'Milk',
          quantity: 1,
          unit: 'kg',
          price: 7,
          category: 'Dairy & eggs',
          subcategory: 'Milk',
          toStock: true,
        },
      ],
    });
    expect(plan.blocked).toMatch(/counted in l/);
  });

  it('explains what is missing', () => {
    const ctx = makeCtx();
    const base = { date: '2026-10-07', spentBy: 'ana@example.com' };
    expect(planAction(ACTIONS.addPurchase, ctx, { ...base, category: 'Rent' }).blocked).toMatch(/amount/);
    expect(planAction(ACTIONS.addPurchase, ctx, { ...base, total: 20 }).blocked).toMatch(/Pick a category/);
    expect(
      planAction(ACTIONS.addPurchase, ctx, { ...base, total: 20, category: 'Holidays' }).blocked,
    ).toMatch(/isn't one of your budget categories/);
  });

  it('adds a purchase as just a total, a budget category, who paid and a description', () => {
    const ctx = makeCtx();
    const plan = planAction(ACTIONS.addPurchase, ctx, {
      date: '2026-10-06',
      spentBy: 'mihai@example.com',
      total: 2500,
      // the household's spelling wins
      category: 'rent',
      purpose: 'October rent',
    });
    expect(plan.blocked).toBeUndefined();
    expect(plan.lines[0]).toBe('October rent, 6 Oct, paid by Mihai, Rent');
    const { snap } = applyToSnapshot(ctx.snap, plan.ops);
    const saved = snap.budgets[2026].purchases.find((x) => x.id === plan.result)!;
    expect(saved).toMatchObject({ category: 'Rent', purpose: 'October rent', total: 2500, lines: [] });
    expect(saved.store).toBeUndefined();
    // no stock, no stores
    expect(snap.items).toEqual(ctx.snap.items);
    expect(snap.household.stores).toEqual(ctx.snap.household.stores);
    expect(potBalance(Object.values(snap.budgets))).toBe(
      round(potBalance(Object.values(ctx.snap.budgets)) - 2500),
    );
  });

  it('first entry of a new year creates the year file with the closing balance', () => {
    const ctx = makeCtx(seedSnapshot('2026-10-07'));
    const closing = closingBalance(ctx.snap.budgets[2026]);
    const plan = planAction(ACTIONS.addContribution, ctx, {
      date: '2027-01-01',
      by: 'ana@example.com',
      amount: 500,
    });
    const { snap } = applyToSnapshot(ctx.snap, plan.ops);
    expect(snap.budgets[2027].openingBalance).toBe(closing);
    expect(snap.household.years).toContain(2027);
    expect(potBalance(Object.values(snap.budgets))).toBe(round(closing + 500));
  });

  it('soft-deletes into the deleted log and restores', () => {
    const ctx = makeCtx();
    const del = planAction(ACTIONS.deletePurchase, ctx, { id: 'p0' });
    expect(del.danger).toBe(true);
    const s1 = applyToSnapshot(ctx.snap, del.ops).snap;
    expect(s1.budgets[2026].purchases.find((x) => x.id === 'p0')).toBeUndefined();
    const log = s1.budgets[2026].deleted[0];
    expect(log).toMatchObject({ kind: 'purchase', by: 'Ana' });
    const s2 = applyToSnapshot(s1, planAction(ACTIONS.restoreDeleted, makeCtx(s1), { id: log.id }).ops).snap;
    expect(s2.budgets[2026].purchases.find((x) => x.id === 'p0')).toBeDefined();
    expect(s2.budgets[2026].deleted).toHaveLength(0);
  });

  it('edits amount, category, who and description; receipt lines and the store stay', () => {
    const ctx = makeCtx(undefined, { me: 1 });
    const orig = ctx.snap.budgets[2026].purchases.find((x) => x.id === 'p0')!;
    const plan = planAction(ACTIONS.updatePurchase, ctx, {
      id: 'p0',
      date: orig.date,
      spentBy: 'ana@example.com',
      total: 200,
      category: 'Home',
      purpose: 'Big shop',
    });
    expect(plan.lines).toContain('Category: Groceries → Home');
    const saved = applyToSnapshot(ctx.snap, plan.ops).snap.budgets[2026].purchases.find(
      (x) => x.id === 'p0',
    )!;
    expect(saved).toMatchObject({
      editedBy: 'Mihai',
      purpose: 'Big shop',
      total: 200,
      category: 'Home',
      spentBy: 'ana@example.com',
      store: orig.store,
      lines: orig.lines,
    });
    expect(planAction(ACTIONS.updatePurchase, ctx, { ...orig, total: 5, category: 'Nope' }).blocked).toMatch(
      /isn't one of your budget categories/,
    );
  });

  it('budget categories: rename updates purchases, renaming onto another merges, delete only when unused', () => {
    const ctx = makeCtx();
    const groceries = (s: typeof ctx.snap, c: string) =>
      Object.values(s.budgets)
        .flatMap((b) => b.purchases)
        .filter((p) => p.category === c).length;
    const n = groceries(ctx.snap, 'Groceries');
    expect(n).toBeGreaterThan(0);
    expect(planAction(ACTIONS.deleteBudgetCategory, ctx, { name: 'Groceries' }).blocked).toMatch(
      /can only be renamed|Rename it/,
    );
    const ren = planAction(ACTIONS.renameBudgetCategory, ctx, { from: 'Groceries', to: 'Food' });
    const s1 = applyToSnapshot(ctx.snap, ren.ops).snap;
    expect(groceries(s1, 'Food')).toBe(n);
    expect(s1.household.budgetCategories[0]).toBe('Food');
    const merge = planAction(ACTIONS.renameBudgetCategory, makeCtx(s1), { from: 'Food', to: 'home' });
    expect(merge.title).toBe('Merge Food into Home');
    const s2 = applyToSnapshot(s1, merge.ops).snap;
    expect(s2.household.budgetCategories).not.toContain('Food');
    expect(groceries(s2, 'Home')).toBeGreaterThanOrEqual(n);
    const del = planAction(ACTIONS.deleteBudgetCategory, makeCtx(s2), { name: 'Other' });
    expect(applyToSnapshot(s2, del.ops).snap.household.budgetCategories).not.toContain('Other');
    expect(planAction(ACTIONS.addBudgetCategory, makeCtx(s2), { name: 'rent' }).blocked).toMatch(/already/);
  });

  it('keeps rows saved together in their order within a day (imports)', () => {
    const b = year(2026, 0, {
      contributions: [{ ...c('c1', '2026-03-01', 'a', 100), createdAt: '2026-11-01T10:00:00.002Z' }],
      purchases: [
        { ...p('p1', '2026-03-01', 'a', 30), createdAt: '2026-11-01T10:00:00.001Z' },
        { ...p('p2', '2026-03-01', 'a', 20), createdAt: '2026-11-01T10:00:00.003Z' },
      ],
    });
    expect(ledger([b]).map((r) => [r.id, r.balanceAfter])).toEqual([
      ['p1', -30],
      ['c1', 70],
      ['p2', 50],
    ]);
  });

  it('adjustments need a reason', () => {
    const ctx = makeCtx();
    expect(
      planAction(ACTIONS.adjustPot, ctx, { date: '2026-10-07', amount: -5, reason: '' }).blocked,
    ).toMatch(/reason/);
    const ok = planAction(ACTIONS.adjustPot, ctx, {
      date: '2026-10-07',
      amount: -5,
      reason: 'Counted the cash',
    });
    expect(ok.title).toBe('Adjust the pot by −5,00 lei');
  });
});

function round(n: number) {
  return Math.round(n * 100) / 100;
}
