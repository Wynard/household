import { describe, expect, it } from 'vitest';
import {
  availability,
  badgeLabel,
  deductionsFor,
  detectTimerSeconds,
  linkSteps,
  stockMapOf,
} from './recipes';
import { seedSnapshot } from '../test/ctx';
import type { Recipe } from './schemas';

const snap = seedSnapshot();
const items = snap.items.items;
const recipe = (id: string) => snap.recipes.recipes.find((r) => r.id === id)!;

describe('recipe availability', () => {
  it('checks every ingredient for the chosen servings', () => {
    // omelette for 2: 4 eggs (have 4), 100 g telemea (400), 20 g butter (200), 0,2 kg tomatoes (0,6)
    const a = availability(recipe('omelette'), 2, items);
    expect(a.badge).toBe('ready');
    expect(a.rows.map((r) => r.status)).toEqual(['have', 'have', 'have', 'have', 'staple']);
    // for 4 people: 8 eggs but only 4 in the house
    const a4 = availability(recipe('omelette'), 4, items);
    const eggs = a4.rows[0];
    expect(eggs).toMatchObject({ status: 'partly', need: 8, have: 4, short: 4 });
    expect(badgeLabel(a4)).toBe('Missing 1');
  });

  it('marks fully missing ingredients and counts them', () => {
    // chicken with potatoes needs 600 g chicken (0 in stock) and 200 g sour cream (0)
    const a = availability(recipe('chickenpotatoes'), 4, items);
    expect(a.rows.find((r) => r.ingredient.itemId === 'chicken')!.status).toBe('missing');
    expect(a.missing).toBe(2);
  });

  it('converts units, including pieces via grams per piece', () => {
    const r: Recipe = {
      ...recipe('omelette'),
      ingredients: [
        { id: 'a', itemId: 'eggs', name: 'eggs', amount: 120, unit: 'g' }, // 2 eggs at 60 g
        { id: 'b', itemId: 'oil', name: 'oil', amount: 100, unit: 'ml' }, // oil stocked in l
      ],
    };
    const a = availability(r, r.servings, items);
    expect(a.rows[0]).toMatchObject({ status: 'have', needInItemUnit: 2 });
    expect(a.rows[1]).toMatchObject({ status: 'have', needInItemUnit: 0.1 });
  });

  it('treats staples, unlinked, optional and incomparable ingredients correctly', () => {
    const r: Recipe = {
      ...recipe('omelette'),
      ingredients: [
        { id: 'a', name: 'salt', pantryStaple: true },
        { id: 'b', name: 'chives' },
        { id: 'c', itemId: 'oil', name: 'oil', amount: 1, unit: 'tbsp' },
        { id: 'd', itemId: 'chicken', name: 'chicken', amount: 100, unit: 'g', optional: true },
      ],
    };
    const a = availability(r, r.servings, items);
    expect(a.rows.map((x) => x.status)).toEqual(['staple', 'untracked', 'untracked', 'missing']);
    expect(a.missing).toBe(0); // the only missing one is optional
    expect(a.badge).toBe('ready');
  });

  it('shows Not tracked when nothing is linked to stock', () => {
    const r: Recipe = { ...recipe('omelette'), ingredients: [{ id: 'a', name: 'something' }] };
    expect(badgeLabel(availability(r, 2, items))).toBe('Not tracked');
  });

  it('respects a custom stock map (used for cumulative plan availability)', () => {
    const stock = stockMapOf(items);
    stock.set('eggs', 0);
    expect(availability(recipe('omelette'), 2, items, stock).missing).toBe(1);
  });

  it('computes deductions in the item unit', () => {
    const d = deductionsFor(recipe('pancakes'), 8, items);
    expect(d).toEqual([
      { itemId: 'flour', amount: 500 },
      { itemId: 'milk', amount: 1 },
      { itemId: 'eggs', amount: 6 },
      { itemId: 'oil', amount: 0.1 },
    ]);
  });
});

describe('timer detection', () => {
  it.each([
    ['Simmer for 10 minutes.', 600],
    ['Cook 1 minute per side', 60],
    ['Fry for 2-3 min', 180],
    ['Bake for 1 hour 15 minutes', 4500],
    ['Rest for half an hour', 1800],
    ['Fierbe 20 de minute', 1200],
    ['Lasă la cuptor o oră', 3600],
    ['Toast for 30 seconds', 30],
    ['Stir in five minutes later', 300],
    ['Heat the oven to 200°C.', undefined],
  ])('%s -> %s', (text, secs) => {
    expect(detectTimerSeconds(text)).toBe(secs);
  });
});

describe('step linking', () => {
  it('links steps to the ingredients they mention, including plurals', () => {
    const r = recipe('tomatopasta');
    const linked = linkSteps(
      [
        { id: '1', text: 'Chop the tomato and slice the garlic.' },
        { id: '2', text: 'Drain and serve.' },
      ],
      r.ingredients,
      items,
    );
    const names = (ids?: string[]) => ids?.map((id) => r.ingredients.find((g) => g.id === id)!.name);
    expect(names(linked[0].ingredientIds)).toEqual(['tomatoes', 'garlic cloves']);
    expect(linked[1].ingredientIds).toBeUndefined();
  });
});
