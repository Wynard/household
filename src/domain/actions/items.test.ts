import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx } from '../../test/ctx';

const base = {
  name: 'Greek yogurt',
  category: 'Dairy & eggs',
  subcategory: 'Yogurt',
  categorySource: 'auto' as const,
  place: 'Fridge',
  showInStock: true,
  unit: 'pcs' as const,
  quantity: 2,
};

describe('item actions', () => {
  it('adds an item with a preview and undoes exactly', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.upsertItem, ctx, base);
    expect(p.title).toBe('Add Greek yogurt to Fridge');
    expect(p.lines[0]).toBe('Dairy & eggs › Yogurt');
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.items.items.find((i) => i.name === 'Greek yogurt')).toMatchObject({
      categorySource: 'auto',
      aliases: [],
    });
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('edits only changed fields and renames shopping entries', () => {
    const ctx = makeCtx();
    const milk = ctx.snap.items.items.find((i) => i.id === 'milk')!;
    const p = planAction(ACTIONS.upsertItem, ctx, { ...milk, name: 'Milk 3.5%' });
    expect(p.title).toBe('Save changes to Milk 3.5%');
    expect(p.lines).toContain('Name: Milk 1.5% → Milk 3.5%');
    const patch = p.ops[0] as { t: string; set: Record<string, unknown> };
    expect(Object.keys(patch.set)).toEqual(['name']);
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.shopping.items.find((s) => s.itemId === 'milk')!.name).toBe('Milk 3.5%');
  });

  it('blocks unknown places and categories', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.upsertItem, ctx, { ...base, place: 'Garage' }).blocked).toMatch(/Garage/);
    expect(planAction(ACTIONS.upsertItem, ctx, { ...base, subcategory: 'Nope' }).blocked).toBeTruthy();
    expect(planAction(ACTIONS.upsertItem, ctx, { ...base, name: '  ' }).blocked).toBeTruthy();
  });

  it('blocks deleting an item used in a recipe, with a plain explanation', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.deleteItem, ctx, { id: 'eggs' });
    expect(p.blocked).toMatch(/^Used in 4 recipes/);
  });

  it('deletes an unused item and its open shopping entries; danger flag set', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.deleteItem, ctx, { id: 'trashbags' });
    expect(p.danger).toBe(true);
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.items.items.find((i) => i.id === 'trashbags')).toBeUndefined();
    expect(snap.shopping.items.find((s) => s.itemId === 'trashbags')).toBeUndefined();
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('moves items between places', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.moveItems, ctx, { itemIds: ['dishsoap', 'cleaner'], place: 'Storage room' });
    expect(p.title).toBe('Move 2 items to Storage room');
    expect(p.lines).toEqual([
      'Dish soap: Cleaning cupboard → Storage room',
      'All-purpose cleaner: Cleaning cupboard → Storage room',
    ]);
  });

  it('merges duplicates: sums quantity with unit conversion, combines aliases, re-points references', () => {
    const ctx = makeCtx();
    const add = planAction(ACTIONS.upsertItem, ctx, {
      ...base,
      name: 'Rice basmati',
      category: 'Pantry',
      subcategory: 'Pasta & rice',
      place: 'Pantry',
      tracking: 'amount',
      unit: 'kg',
      quantity: 0.5,
    });
    const s1 = applyToSnapshot(ctx.snap, add.ops).snap;
    const dupId = s1.items.items.find((i) => i.name === 'Rice basmati')!.id;
    const p = planAction(ACTIONS.mergeItems, makeCtx(s1), { keepId: 'rice', mergeIds: [dupId] });
    const { snap, inverse } = applyToSnapshot(s1, p.ops);
    const rice = snap.items.items.find((i) => i.id === 'rice')!;
    expect(rice.quantity).toBe(1500);
    expect(rice.aliases).toContain('Rice basmati');
    expect(snap.items.items.find((i) => i.id === dupId)).toBeUndefined();
    expect(applyToSnapshot(snap, inverse).snap).toEqual(s1);
  });

  it('refuses impossible merges instead of guessing', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.mergeItems, ctx, { keepId: 'oil', mergeIds: ['flour'] });
    expect(p.blocked).toMatch(/Can't add/);
  });

  it('creates categories and subcategories, rejecting duplicates', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.addCategory, ctx, { name: 'Garden' }).ops).toHaveLength(1);
    expect(planAction(ACTIONS.addCategory, ctx, { name: 'produce' }).blocked).toBeTruthy();
    expect(planAction(ACTIONS.addSubcategory, ctx, { category: 'Produce', name: 'Mushrooms' }).title).toBe(
      'New subcategory: Produce › Mushrooms',
    );
  });
});
