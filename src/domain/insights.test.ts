import { describe, expect, it } from 'vitest';
import { compare, drillLevel, spendingInsights, usageInsights } from './insights';
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
  category?: string,
) => ({
  id,
  date,
  store,
  ...(category ? { category } : {}),
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
// the same month as the Budget screen saves it: totals with a budget category
const simple = (
  id: string,
  date: string,
  spentBy: string,
  category: string,
  total: number,
  purpose?: string,
) => ({
  id,
  date,
  category,
  spentBy,
  ...(purpose ? { purpose } : {}),
  lines: [],
  total,
  source: 'manual' as const,
  createdBy: 'x',
  createdAt: date,
});
const totals: BudgetFile = {
  ...budget,
  purchases: [
    simple('s1', '2026-09-05', 'a', 'Groceries', 100),
    simple('s2', '2026-10-01', 'a', 'Rent', 2000),
    simple('s3', '2026-10-03', 'b', 'Groceries', 150, 'Market'),
    simple('s4', '2026-10-20', 'a', 'Groceries', 50),
    // saved before budget categories existed
    purchase('p9', '2026-10-21', 'b', 'Lidl', [line('Milk', 20, 'Dairy', 'Milk', 2, 'l', 'milk')]),
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

  it('groups whole purchases by budget category; older ones show as No category', () => {
    const s = spendingInsights([totals], '2026-10', {});
    expect(s.total).toBe(2220);
    expect(s.byCategory.map((b) => [b.key, b.value])).toEqual([
      ['Rent', 2000],
      ['Groceries', 200],
      ['No category', 20],
    ]);
    expect(s.byPerson.map((b) => [b.key, b.value])).toEqual([
      ['a', 2050],
      ['b', 170],
    ]);
  });

  it('a category filter lists its purchases, newest first, and compares like with like', () => {
    const s = spendingInsights([totals], '2026-10', { category: 'Groceries' });
    expect(s.total).toBe(200);
    expect(s.comparison.prevTotal).toBe(100);
    expect(s.purchases.map((p) => [p.id, p.title])).toEqual([
      ['s4', 'Groceries'],
      ['s3', 'Market'],
    ]);
    expect(s.trend.slice(-2).map((t) => t.total)).toEqual([100, 200]);
  });

  it('applies the person filter everywhere, including the comparison and money in', () => {
    const s = spendingInsights([budget], '2026-10', { person: 'a' });
    expect(s.total).toBe(50);
    expect(s.comparison.prevTotal).toBe(50);
    expect(s.moneyIn).toBe(500);
  });

  it('has a 6-month trend', () => {
    const s = spendingInsights([budget], '2026-10', {});
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
    expect(drillLevel({})).toBe('category');
    expect(drillLevel({ category: 'Dairy' })).toBe('subcategory');
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

  it('counts uses instead of lei when nothing has a price', () => {
    const free: UsageFile = { ...usage, usage: usage.usage.map((e) => ({ ...e, value: 0 })) };
    const u = usageInsights([free], [totals], '2026-10', {});
    expect(u.valued).toBe(false);
    expect(u.mostUsed[0]).toMatchObject({ name: 'Milk', times: 2 });
    expect(u.byDrill.map((b) => [b.key, b.value])).toEqual([
      ['Dairy', 2],
      ['Produce', 1],
    ]);
    expect(usageInsights([usage], [budget], '2026-10', {}).valued).toBe(true);
  });
});

describe('comparison for a month in progress', () => {
  it('compares with the same days of the previous month', () => {
    // up to the 2nd: September had nothing by the 2nd (p1 is on the 3rd)
    const s = spendingInsights([budget], '2026-10', {}, { upToDay: 2 });
    expect(s.comparison).toEqual({ pct: null, direction: 'none', prevTotal: 0 });
    const s3 = spendingInsights([budget], '2026-10', {}, { upToDay: 3 });
    expect(s3.comparison.prevTotal).toBe(50);
  });
});
