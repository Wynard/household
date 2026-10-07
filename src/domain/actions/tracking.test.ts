import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx } from '../../test/ctx';
import { stockStatus } from '../stock';
import { availability, deductionsFor } from '../recipes';
import { usageInsights } from '../insights';

const find = (snap: ReturnType<typeof makeCtx>['snap'], id: string) =>
  snap.items.items.find((i) => i.id === id)!;
const onList = (snap: ReturnType<typeof makeCtx>['snap'], id: string) =>
  snap.shopping.items.filter((s) => s.itemId === id && !s.checked);

describe('simple tracking (have / low / out)', () => {
  it('Out puts a simple item on the list (addToListWhen: out); Have takes the automatic entry off', () => {
    const ctx = makeCtx();
    // cleaner: simple, Have, addToListWhen out
    const out = planAction(ACTIONS.setItemStatus, ctx, { itemId: 'cleaner', status: 'out' });
    expect(out.title).toBe('All-purpose cleaner: Out');
    const s1 = applyToSnapshot(ctx.snap, out.ops).snap;
    expect(find(s1, 'cleaner').status).toBe('out');
    expect(onList(s1, 'cleaner')).toHaveLength(1);
    const back = planAction(ACTIONS.setItemStatus, makeCtx(s1), { itemId: 'cleaner', status: 'have' });
    const s2 = applyToSnapshot(s1, back.ops).snap;
    expect(onList(s2, 'cleaner')).toHaveLength(0);
  });

  it('Low does not add an "add when out" item, but does add an "add when low" one', () => {
    const ctx = makeCtx();
    const low = applyToSnapshot(
      ctx.snap,
      planAction(ACTIONS.setItemStatus, ctx, { itemId: 'cleaner', status: 'low' }).ops,
    ).snap;
    expect(onList(low, 'cleaner')).toHaveLength(0);
    // toilet paper: addToListWhen low, already Low in the seed -> set Have, then Low again
    const have = applyToSnapshot(
      ctx.snap,
      planAction(ACTIONS.setItemStatus, ctx, { itemId: 'toiletpaper', status: 'have' }).ops,
    ).snap;
    const again = applyToSnapshot(
      have,
      planAction(ACTIONS.setItemStatus, makeCtx(have), { itemId: 'toiletpaper', status: 'low' }).ops,
    ).snap;
    expect(onList(again, 'toiletpaper')).toHaveLength(1);
  });

  it('records a usage event without quantity when a simple item drops to Low or Out, and undoes cleanly', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.setItemStatus, ctx, { itemId: 'cleaner', status: 'out' });
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.usage[2026].usage.at(-1)).toMatchObject({
      itemId: 'cleaner',
      status: 'out',
      quantity: 0,
      value: 0,
    });
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('amounts cannot be stepped on simple items; Out empties an amount item', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.adjustStock, ctx, { itemId: 'cleaner', delta: 1 }).blocked).toMatch(
      /Have \/ Low \/ Out/,
    );
    const out = applyToSnapshot(
      ctx.snap,
      planAction(ACTIONS.setItemStatus, ctx, { itemId: 'rice', status: 'out' }).ops,
    ).snap;
    expect(find(out, 'rice').quantity).toBe(0);
    expect(stockStatus(find(out, 'rice'))).toBe('out');
  });

  it('buying a simple item sets it to Have and takes it off the list', () => {
    const ctx = makeCtx();
    // dish soap: simple, Out, on the list (manual entry sh5 is not automatic, so it stays until checked)
    const p = planAction(ACTIONS.addPurchase, ctx, {
      store: 'Lidl',
      date: '2026-10-07',
      spentBy: 'ana@example.com',
      lines: [
        {
          itemId: 'trashbags',
          name: 'Trash bags',
          quantity: 1,
          unit: 'pcs',
          price: 9,
          category: 'Household',
          subcategory: 'Bags & foil',
          toStock: true,
        },
      ],
    });
    expect(p.lines).toContain('Stock: Trash bags → Have, Storage room');
    const s = applyToSnapshot(ctx.snap, p.ops).snap;
    expect(find(s, 'trashbags').status).toBe('have');
    expect(onList(s, 'trashbags').filter((x) => x.source === 'low-stock')).toHaveLength(0);
  });
});

/** The seed with butter switched to simple tracking at the given status. */
function withSimpleButter(status: 'have' | 'low' | 'out') {
  const snap = structuredClone(makeCtx().snap);
  const b = snap.items.items.find((i) => i.id === 'butter')!;
  Object.assign(b, { tracking: 'simple', status, quantity: 0 });
  return snap;
}

describe('recipes and cooking with simple items', () => {
  const omelette = (snap: ReturnType<typeof withSimpleButter>) =>
    snap.recipes.recipes.find((r) => r.id === 'omelette')!;

  it('Have and Low count as available (Low warns), Out is missing', () => {
    for (const [status, expected] of [
      ['have', 'have'],
      ['low', 'have'],
      ['out', 'missing'],
    ] as const) {
      const snap = withSimpleButter(status);
      const row = availability(omelette(snap), 2, snap.items.items).rows.find(
        (r) => r.item?.id === 'butter',
      )!;
      expect(row).toMatchObject({ status: expected, simple: true, low: status === 'low' });
    }
  });

  it('cooking never deducts simple items, and applies Mark as Low / Out', () => {
    const snap = withSimpleButter('have');
    const ded = deductionsFor(omelette(snap), 2, snap.items.items);
    expect(ded.map((d) => d.itemId)).not.toContain('butter');
    const ctx = makeCtx(snap);
    const p = planAction(ACTIONS.cookRecipe, ctx, {
      recipeId: 'omelette',
      servings: 2,
      deductions: [...ded, { itemId: 'butter', amount: 20 }],
      statusChanges: [{ itemId: 'butter', status: 'low' }],
    });
    expect(p.lines).toContain('Butter: Have → Low, Fridge');
    const after = applyToSnapshot(snap, p.ops).snap;
    expect(find(after, 'butter')).toMatchObject({ status: 'low', quantity: 0 });
    expect(after.usage[2026].usage.at(-1)).toMatchObject({
      itemId: 'butter',
      status: 'low',
      recipeId: 'omelette',
    });
  });

  it('"I bought these" sets a simple item to Have', () => {
    const snap = withSimpleButter('out');
    const p = planAction(ACTIONS.stockFromShopping, makeCtx(snap), {
      lines: [{ shoppingId: 'none', itemId: 'butter', amount: 1, unit: 'pcs' }],
      clear: false,
    });
    expect(p.lines).toEqual(['Butter: Out → Have, Fridge']);
    expect(find(applyToSnapshot(snap, p.ops).snap, 'butter').status).toBe('have');
  });
});

describe('insights: Ran out of', () => {
  it('lists simple items marked Out, and keeps status events out of value and most used', () => {
    const ctx = makeCtx();
    const snap = applyToSnapshot(
      ctx.snap,
      planAction(ACTIONS.setItemStatus, ctx, { itemId: 'cleaner', status: 'out' }).ops,
    ).snap;
    const before = usageInsights(
      Object.values(ctx.snap.usage),
      Object.values(ctx.snap.budgets),
      '2026-10',
      {},
    );
    const after = usageInsights(Object.values(snap.usage), Object.values(snap.budgets), '2026-10', {});
    expect(after.totalValue).toBe(before.totalValue);
    expect(after.mostUsed).toEqual(before.mostUsed);
    expect(after.ranOutOf.find((x) => x.itemId === 'cleaner')).toMatchObject({
      times: 1,
      last: '2026-10-07',
    });
  });
});
