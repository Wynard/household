import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx } from '../../test/ctx';

describe('settings actions', () => {
  it('renaming a place cascades to items; undo restores', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.renamePlace, ctx, { from: 'Pantry', to: 'Larder' });
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.household.places).toContain('Larder');
    expect(snap.items.items.some((i) => i.place === 'Pantry')).toBe(false);
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('blocks deleting a place that still holds items', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.deletePlace, ctx, { name: 'Bathroom' }).blocked).toBe(
      'Holds 4 items. Move them to another place first.',
    );
    const add = planAction(ACTIONS.addPlace, ctx, { name: 'Garage' });
    const s1 = applyToSnapshot(ctx.snap, add.ops).snap;
    expect(planAction(ACTIONS.deletePlace, makeCtx(s1), { name: 'Garage' }).blocked).toBeUndefined();
  });

  it('renaming a category cascades to items, purchase lines and usage', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.renameCategory, ctx, { from: 'Dairy & eggs', to: 'Dairy' });
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    const has = (s: string) =>
      snap.items.items.some((i) => i.category === s) ||
      snap.budgets[2026].purchases.some((x) => x.lines.some((l) => l.category === s)) ||
      snap.usage[2026].usage.some((u) => u.category === s);
    expect(has('Dairy & eggs')).toBe(false);
    expect(has('Dairy')).toBe(true);
    expect(snap.household.categories.find((c) => c.name === 'Dairy')!.subcategories).toContain('Milk');
  });

  it('renaming a subcategory only touches that category', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.renameSubcategory, ctx, {
      category: 'Produce',
      from: 'Vegetables',
      to: 'Veg',
    });
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.items.items.find((i) => i.id === 'potatoes')!.subcategory).toBe('Veg');
    expect(snap.items.items.find((i) => i.id === 'frozenveg')!.subcategory).toBe('Frozen vegetables');
  });

  it('blocks deleting categories in use with a plain explanation', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.deleteCategory, ctx, { name: 'Bakery' }).blocked).toMatch(
      /^Used by 1 item and \d+ purchase lines\./,
    );
    expect(
      planAction(ACTIONS.deleteSubcategory, ctx, { category: 'Frozen', name: 'Ready meals' }).blocked,
    ).toBeUndefined();
  });

  it('deleting a recipe category removes it from recipes', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.deleteRecipeCategory, ctx, { name: 'Breakfast' });
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.recipes.recipes.some((r) => r.categories.includes('Breakfast'))).toBe(false);
    expect(snap.recipes.recipes).toHaveLength(6);
  });

  it('renaming a store cascades to purchases and merges into an existing store', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.renameStore, ctx, { from: 'Piața Obor', to: 'lidl' });
    expect(p.title).toBe('Merge Piața Obor into Lidl');
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.household.stores.filter((s) => s === 'Lidl')).toHaveLength(1);
    expect(snap.household.stores).not.toContain('Piața Obor');
    expect(snap.budgets[2026].purchases.some((x) => x.store === 'Piața Obor')).toBe(false);
  });

  it('blocks deleting a store with purchases', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.deleteStore, ctx, { name: 'Lidl' }).blocked).toMatch(/can only be renamed/);
    expect(planAction(ACTIONS.deleteStore, ctx, { name: 'Penny' }).blocked).toBeUndefined();
  });
});
