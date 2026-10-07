import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx } from '../../test/ctx';
import { deductionsFor } from '../recipes';

describe('recipe actions', () => {
  it('toggles favourite and previews it', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.toggleFavourite, ctx, { recipeId: 'shakshuka' });
    expect(p.title).toBe('Add Shakshuka to favourites');
    expect(
      applyToSnapshot(ctx.snap, p.ops).snap.recipes.recipes.find((r) => r.id === 'shakshuka')!.favourite,
    ).toBe(true);
  });

  it('sets categories and creates a new one on the spot', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.setRecipeCategories, ctx, {
      recipeId: 'shakshuka',
      categories: ['Arabic', 'Vegetarian'],
    });
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.household.recipeCategories).toContain('Vegetarian');
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('saves a recipe with linked steps and explains what is missing', () => {
    const ctx = makeCtx();
    const draft = {
      title: 'Lentil soup',
      servings: 2,
      favourite: false,
      categories: ['Romanian'],
      cookMinutes: 30,
      ingredients: [
        { id: 'g1', itemId: 'onions', name: 'onion', amount: 0.1, unit: 'kg' },
        { id: 'g2', name: 'red lentils' },
      ],
      steps: [{ id: 's1', text: 'Soften the onion for 5 minutes.', timerSeconds: 300 }],
    };
    const p = planAction(ACTIONS.upsertRecipe, ctx, draft);
    expect(p.title).toBe('Add recipe: Lentil soup');
    expect(p.lines).toEqual([
      'Romanian, 30 min, serves 2',
      '2 ingredients, 1 linked to your items',
      '1 step, 1 with timers',
    ]);
    const saved = applyToSnapshot(ctx.snap, p.ops).snap.recipes.recipes.at(-1)!;
    expect(saved.steps[0].ingredientIds).toEqual(['g1']);
    expect(planAction(ACTIONS.upsertRecipe, ctx, { ...draft, steps: [] }).blocked).toMatch(/step/);
    expect(planAction(ACTIONS.upsertRecipe, ctx, { ...draft, ingredients: [] }).blocked).toMatch(
      /ingredient/,
    );
  });

  it('deleting a recipe also removes it from the plan; undo restores both', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.deleteRecipe, ctx, { id: 'tomatopasta' });
    expect(p.danger).toBe(true);
    expect(p.lines).toEqual(['Also removes it from the meal plan (1 meal)']);
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.plan.entries.some((e) => e.recipeId === 'tomatopasta')).toBe(false);
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('cooking deducts stock, logs one usage entry per ingredient and a cooked entry, marks the plan', () => {
    const ctx = makeCtx();
    const r = ctx.snap.recipes.recipes.find((x) => x.id === 'tomatopasta')!;
    const deductions = deductionsFor(r, 2, ctx.snap.items.items);
    const p = planAction(ACTIONS.cookRecipe, ctx, {
      recipeId: r.id,
      servings: 2,
      deductions,
      planEntryId: 'e1',
    });
    const before = ctx.snap.usage[2026];
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    const pasta = snap.items.items.find((i) => i.id === 'pasta')!;
    expect(pasta.quantity).toBe(250);
    const newUsage = snap.usage[2026].usage.slice(before.usage.length);
    expect(newUsage).toHaveLength(4);
    expect(newUsage.every((u) => u.reason === 'cooked' && u.recipeId === 'tomatopasta')).toBe(true);
    expect(snap.usage[2026].cooked.at(-1)).toMatchObject({
      recipeId: 'tomatopasta',
      servings: 2,
      by: 'ana@example.com',
    });
    expect(snap.plan.entries.find((e) => e.id === 'e1')!.cooked).toBe(true);
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });
});

describe('addToShoppingList', () => {
  it('merges with existing entries, summing amounts in the same unit', () => {
    const ctx = makeCtx();
    // milk is on the list for 2 l (low stock); add 500 ml more
    const p = planAction(ACTIONS.addToShoppingList, ctx, {
      entries: [{ itemId: 'milk', name: 'Milk 1.5%', amount: 500, unit: 'ml' }],
      source: 'recipe',
      sourceRef: 'pancakes',
    });
    const milk = applyToSnapshot(ctx.snap, p.ops).snap.shopping.items.filter((s) => s.itemId === 'milk');
    expect(milk).toHaveLength(1);
    expect(milk[0]).toMatchObject({ amount: 2.5, unit: 'l' });
    expect(p.result).toBe('Milk 1.5%: amount updated on the shopping list');
  });

  it('adding again from the same recipe replaces instead of doubling', () => {
    const ctx = makeCtx();
    const add = {
      entries: [{ itemId: 'flour', name: 'Flour', amount: 200, unit: 'g' }],
      source: 'recipe',
      sourceRef: 'pancakes',
    };
    const s1 = applyToSnapshot(ctx.snap, planAction(ACTIONS.addToShoppingList, ctx, add).ops).snap;
    const s2 = applyToSnapshot(s1, planAction(ACTIONS.addToShoppingList, makeCtx(s1), add).ops).snap;
    expect(s2.shopping.items.filter((s) => s.itemId === 'flour').map((s) => s.amount)).toEqual([200]);
  });

  it('merges unlinked entries by name and rounds pieces up', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.addToShoppingList, ctx, {
      entries: [
        { name: 'bread', amount: 1, unit: 'pcs' },
        { itemId: 'eggs', name: 'Eggs', amount: 2.4, unit: 'pcs' },
      ],
    });
    const list = applyToSnapshot(ctx.snap, p.ops).snap.shopping.items;
    expect(list.filter((s) => s.name.toLowerCase() === 'bread')).toHaveLength(1);
    expect(list.find((s) => s.itemId === 'eggs')!.amount).toBe(13); // 10 + 2.4 -> 13 pcs
  });
});
