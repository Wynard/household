import { describe, expect, it } from 'vitest';
import { compare, drillLevel, priceHistory, spendingInsights, usageInsights } from './insights';
import type { BudgetFile, UsageFile } from './schemas';

const env = { schemaVersion: 1, updatedAt: 'x', updatedBy: 'x' };
const line = (
  name: string,
  price: number,
  category: string,
  subcategory: string,
  quantity = 1,
  unit: 'kg' | 'g' | 'pcs' | 'l' = 'pcs',
  itemId?: string,
) => ({
  id: name + price,
  name,
  price,
  category,
  subcategory,
  quantity,
  unit,
  ...(itemId ? { itemId } : {}),
});
const purchase = (
  id: string,
  date: string,
  spentBy: string,
  store: string,
  lines: ReturnType<typeof line>[],
) => ({
  id,
  date,
  store,
  spentBy,
  lines,
  total: lines.reduce((t, l) => t + l.price, 0),
  source: 'manual' as const,
  createdBy: 'x',
  createdAt: date,
});
const budget: BudgetFile = {
  ...env,
  year: 2026,
  openingBalance: 0,
  contributions: [
    { id: 'c1', date: '2026-10-01', by: 'a', amount: 500, createdAt: 'x' },
    { id: 'c2', date: '2026-10-01', by: 'b', amount: 400, createdAt: 'x' },
  ],
  adjustments: [],
  deleted: [],
  purchases: [
    purchase('p1', '2026-09-03', 'a', 'Lidl', [line('Milk', 50, 'Dairy', 'Milk', 4, 'l', 'milk')]),
    purchase('p2', '2026-10-02', 'a', 'Lidl', [
      line('Milk', 20, 'Dairy', 'Milk', 2, 'l', 'milk'),
      line('Cheese', 30, 'Dairy', 'Cheese', 0.5, 'kg', 'cheese'),
    ]),
    purchase('p3', '2026-10-09', 'b', 'Kaufland', [
      line('Apples', 10, 'Produce', 'Fruit', 2, 'kg', 'apples'),
    ]),
    purchase('p4', '2026-10-30', 'b', 'Lidl', [line('Milk', 15, 'Dairy', 'Milk', 1, 'l', 'milk')]),
  ],
};

describe('spending insights', () => {
  it('totals, compares with the previous month and buckets by week', () => {
    const s = spendingInsights([budget], '2026-10', {});
    expect(s.total).toBe(75);
    expect(s.comparison).toEqual({ pct: 50, direction: 'more', prevTotal: 50 });
    expect(s.weeks).toEqual([50, 10, 0, 0, 15]);
    expect(s.moneyIn).toBe(900);
  });

  it('drills down category -> subcategory -> item', () => {
    expect(drillLevel({})).toBe('category');
    expect(spendingInsights([budget], '2026-10', {}).byDrill.map((b) => [b.key, b.value])).toEqual([
      ['Dairy', 65],
      ['Produce', 10],
    ]);
    const sub = spendingInsights([budget], '2026-10', { category: 'Dairy' });
    expect(sub.level).toBe('subcategory');
    expect(sub.byDrill.map((b) => b.key)).toEqual(['Milk', 'Cheese']);
    const items = spendingInsights([budget], '2026-10', { category: 'Dairy', subcategory: 'Milk' });
    expect(items.level).toBe('item');
    expect(items.byDrill).toHaveLength(1);
    expect(items.byDrill[0]).toMatchObject({ key: 'Milk', value: 35, share: 1, rel: 1 });
  });

  it('applies person and store filters everywhere, including the comparison', () => {
    const s = spendingInsights([budget], '2026-10', { person: 'a' });
    expect(s.total).toBe(50);
    expect(s.comparison.prevTotal).toBe(50);
    expect(s.moneyIn).toBe(500);
    const lidl = spendingInsights([budget], '2026-10', { store: 'Lidl' });
    expect(lidl.byStore.map((b) => b.key)).toEqual(['Lidl']);
    expect(lidl.total).toBe(65);
  });

  it('top items with quantity bought in base units, and a 6-month trend', () => {
    const s = spendingInsights([budget], '2026-10', {});
    expect(s.topItems[0]).toMatchObject({ name: 'Milk', value: 35, quantity: 3000, unit: 'ml' });
    expect(s.trend.map((t) => t.ym)).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);
    expect(s.trend.slice(-2).map((t) => t.total)).toEqual([50, 75]);
  });

  it('comparison handles empty previous months', () => {
    expect(compare(10, 0)).toEqual({ pct: null, direction: 'none', prevTotal: 0 });
    expect(compare(10, 10).direction).toBe('same');
    expect(compare(5, 10)).toMatchObject({ pct: 50, direction: 'less' });
  });

  it('price history per kg / l / piece', () => {
    expect(priceHistory([budget], { itemId: 'milk', name: 'Milk' }).map((p) => p.perUnit)).toEqual([
      12.5, 10, 15,
    ]);
  });
});

describe('usage insights', () => {
  const usage: UsageFile = {
    ...env,
    year: 2026,
    usage: [
      {
        id: 'u1',
        date: '2026-10-03',
        by: 'a',
        itemId: 'milk',
        name: 'Milk',
        category: 'Dairy',
        subcategory: 'Milk',
        quantity: 1000,
        unit: 'ml',
        value: 10,
        reason: 'cooked',
        recipeId: 'r1',
      },
      {
        id: 'u2',
        date: '2026-10-05',
        by: 'b',
        itemId: 'milk',
        name: 'Milk',
        category: 'Dairy',
        subcategory: 'Milk',
        quantity: 500,
        unit: 'ml',
        value: 5,
        reason: 'manual-decrease',
      },
      {
        id: 'u3',
        date: '2026-10-06',
        by: 'b',
        itemId: 'apples',
        name: 'Apples',
        category: 'Produce',
        subcategory: 'Fruit',
        quantity: 1000,
        unit: 'g',
        value: 5,
        reason: 'manual-decrease',
      },
    ],
    cooked: [
      { id: 'k1', date: '2026-10-03', by: 'a', recipeId: 'r1', servings: 2 },
      { id: 'k2', date: '2026-10-08', by: 'b', recipeId: 'r1', servings: 2 },
      { id: 'k3', date: '2026-09-08', by: 'b', recipeId: 'r2', servings: 2 },
    ],
  };

  it('value used, distinct items, meals, most used and most cooked', () => {
    const u = usageInsights([usage], [budget], '2026-10', {});
    expect(u).toMatchObject({ totalValue: 20, distinctItems: 2, meals: 2 });
    expect(u.mostUsed[0]).toMatchObject({ name: 'Milk', quantity: 1500, unit: 'ml', value: 15 });
    expect(u.mostCooked).toEqual([{ recipeId: 'r1', times: 2 }]);
    expect(u.byDrill.map((b) => b.key)).toEqual(['Dairy', 'Produce']);
  });

  it('bought vs used flags possible waste first', () => {
    const u = usageInsights([usage], [budget], '2026-10', {});
    expect(u.boughtVsUsed[0]).toMatchObject({ name: 'Cheese', bought: 500, used: 0, unit: 'g' });
    expect(u.boughtVsUsed.find((x) => x.itemId === 'milk')).toMatchObject({ bought: 3000, used: 1500 });
  });

  it('filters by person', () => {
    const u = usageInsights([usage], [budget], '2026-10', { person: 'b' });
    expect(u).toMatchObject({ totalValue: 10, meals: 1 });
  });
});
