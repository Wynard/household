import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from './quickAdd';
import { mergeIntoList } from './shopping';
import { ACTIONS, applyToSnapshot, planAction } from './actions';
import { makeCtx } from '../test/ctx';
import type { ShoppingItem } from './schemas';

describe('quick add parsing', () => {
  it.each([
    ['2 kg potatoes', { name: 'Potatoes', amount: 2, unit: 'kg' }],
    ['cartofi 2kg', { name: 'Cartofi', amount: 2, unit: 'kg' }],
    ['milk 1,5 l', { name: 'Milk', amount: 1.5, unit: 'l' }],
    ['6 eggs', { name: 'Eggs', amount: 6, unit: 'pcs' }],
    ['500g flour', { name: 'Flour', amount: 500, unit: 'g' }],
    ['bread', { name: 'Bread' }],
    ['Milk 1.5%', { name: 'Milk 1.5%' }],
  ])('%s', (input, out) => {
    expect(parseQuickAdd(input)).toEqual(out);
  });
});

describe('shopping list merge', () => {
  const base = (over: Partial<ShoppingItem>): ShoppingItem => ({
    id: 'x',
    name: 'Flour',
    source: 'manual',
    checked: false,
    addedBy: 'Ana',
    addedAt: '2026-10-07T10:00:00Z',
    ...over,
  });
  const opts = { source: 'manual' as const, actor: 'Ana', now: 'n', newId: () => 'new' };

  it('dedupes by item and sums converted amounts', () => {
    const r = mergeIntoList(
      [base({ itemId: 'flour', amount: 1, unit: 'kg' })],
      [{ itemId: 'flour', name: 'Flour', amount: 500, unit: 'g' }],
      opts,
    );
    expect(r.ops).toEqual([
      {
        t: 'patch',
        file: 'shopping',
        coll: 'items',
        id: 'x',
        set: { amount: 1.5, unit: 'kg' },
        unset: undefined,
      },
    ]);
  });

  it('ignores checked entries (those are in the cart)', () => {
    const r = mergeIntoList(
      [base({ itemId: 'flour', checked: true })],
      [{ itemId: 'flour', name: 'Flour' }],
      opts,
    );
    expect(r.added).toEqual(['Flour']);
  });

  it('keeps the larger amount when units cannot be converted', () => {
    const r = mergeIntoList(
      [base({ itemId: 'flour', amount: 2, unit: 'pcs' })],
      [{ itemId: 'flour', name: 'Flour', amount: 500, unit: 'g' }],
      opts,
    );
    expect((r.ops[0] as unknown as { set: { amount: number } }).set.amount).toBe(500);
  });
});

describe('shopping actions', () => {
  it('checks off, unchecks and clears with undo', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.checkShoppingItems, ctx, { ids: ['sh7', 'sh8'], checked: true });
    const s1 = applyToSnapshot(ctx.snap, p.ops).snap;
    expect(s1.shopping.items.filter((s) => s.checked).map((s) => s.id)).toEqual(['sh7', 'sh8']);
    const clear = planAction(ACTIONS.removeShoppingItems, makeCtx(s1), { ids: ['sh7', 'sh8'] });
    const { snap, inverse } = applyToSnapshot(s1, clear.ops);
    expect(snap.shopping.items).toHaveLength(6);
    expect(applyToSnapshot(snap, inverse).snap).toEqual(s1);
  });

  it('"I bought these" adds to stock in the item unit and clears the entries', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.stockFromShopping, ctx, {
      lines: [
        { shoppingId: 'sh1', itemId: 'milk', amount: 2, unit: 'l' },
        { shoppingId: 'sh3', itemId: 'chicken', amount: 0.6, unit: 'kg' },
      ],
    });
    expect(p.lines).toEqual([
      'Milk 1.5%: 1 l → 3 l, Fridge',
      'Chicken breast: 0 g → 600 g, Freezer',
      '2 items cleared from the list',
    ]);
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.items.items.find((i) => i.id === 'chicken')!.quantity).toBe(600);
    expect(snap.shopping.items.find((s) => s.id === 'sh1')).toBeUndefined();
  });

  it('refuses impossible unit conversions', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.stockFromShopping, ctx, {
      lines: [{ shoppingId: 'sh1', itemId: 'milk', amount: 2, unit: 'kg' }],
    });
    expect(p.blocked).toMatch(/counted in l/);
  });
});
