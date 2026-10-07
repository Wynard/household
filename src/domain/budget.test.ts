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
      'Market stall, 7 Oct, money taken by Mihai',
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
    expect(hummus).toMatchObject({
      place: 'Fridge',
      quantity: 200,
      unit: 'g',
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
    expect(
      planAction(ACTIONS.addPurchase, ctx, { store: '', date: '2026-10-07', spentBy: 'a', lines: [] })
        .blocked,
    ).toMatch(/store name/);
    expect(
      planAction(ACTIONS.addPurchase, ctx, { store: 'Lidl', date: '2026-10-07', spentBy: 'a', lines: [] })
        .blocked,
    ).toMatch(/at least one item/);
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

  it('edits record who and when, and keep the printed receipt total unless lines change', () => {
    const ctx = makeCtx(undefined, { me: 1 });
    const orig = ctx.snap.budgets[2026].purchases.find((x) => x.id === 'p0')!;
    const plan = planAction(ACTIONS.updatePurchase, ctx, { ...orig, purpose: 'Big shop' });
    const saved = applyToSnapshot(ctx.snap, plan.ops).snap.budgets[2026].purchases.find(
      (x) => x.id === 'p0',
    )!;
    expect(saved).toMatchObject({ editedBy: 'Mihai', purpose: 'Big shop', total: orig.total });
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
