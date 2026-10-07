import { describe, expect, it } from 'vitest';
import { mealStatus, planAvailability, shortfall } from './plan';
import { seedSnapshot } from '../test/ctx';
import type { PlanEntry } from './schemas';

const snap = seedSnapshot('2026-10-07');
const { recipes } = snap.recipes;
const { items } = snap.items;
const e = (
  id: string,
  date: string,
  slot: 'lunch' | 'dinner',
  recipeId: string,
  servings: number,
  cooked?: boolean,
): PlanEntry => ({
  id,
  date,
  slot,
  recipeId,
  servings,
  ...(cooked ? { cooked } : {}),
});

describe('cumulative plan availability', () => {
  it('earlier meals reserve stock first, so a later meal can be missing', () => {
    // 4 eggs at home. Omelette for 2 needs 4 eggs; shakshuka for 2 also needs 4.
    const plan = planAvailability(
      [e('b', '2026-10-09', 'dinner', 'shakshuka', 2), e('a', '2026-10-08', 'lunch', 'omelette', 2)],
      recipes,
      items,
      '2026-10-07',
    );
    expect(mealStatus(plan.get('a')!).label).toBe('Ready');
    const later = plan.get('b')!;
    expect(later.av!.rows.find((r) => r.item?.id === 'eggs')!.status).toBe('missing');
    expect(later.short.get('eggs')).toBe(4);
  });

  it('lunch comes before dinner on the same day', () => {
    const plan = planAvailability(
      [e('d', '2026-10-08', 'dinner', 'shakshuka', 2), e('l', '2026-10-08', 'lunch', 'omelette', 2)],
      recipes,
      items,
      '2026-10-07',
    );
    expect(mealStatus(plan.get('l')!).label).toBe('Ready');
    expect(mealStatus(plan.get('d')!).tone).toBe('missing');
  });

  it('ignores cooked and past meals for reservations', () => {
    const plan = planAvailability(
      [
        e('past', '2026-10-05', 'lunch', 'omelette', 2),
        e('done', '2026-10-07', 'lunch', 'omelette', 2, true),
        e('next', '2026-10-08', 'lunch', 'omelette', 2),
      ],
      recipes,
      items,
      '2026-10-07',
    );
    expect(mealStatus(plan.get('past')!).label).toBe('Not marked cooked');
    expect(mealStatus(plan.get('done')!).label).toBe('Cooked');
    expect(mealStatus(plan.get('next')!).label).toBe('Ready');
  });

  it('sums the shortfall over meals, partly covered amounts included', () => {
    // 1 l milk: pancakes for 4 need 0,5 l, then pancakes for 8 need 1 l -> 0,5 l short
    const plan = planAvailability(
      [e('p1', '2026-10-08', 'dinner', 'pancakes', 4), e('p2', '2026-10-10', 'dinner', 'pancakes', 8)],
      recipes,
      items,
      '2026-10-07',
    );
    const total = shortfall([...plan.values()]);
    expect(total.get('milk')).toBe(0.5);
    expect(plan.get('p1')!.short.size).toBe(0);
  });
});
