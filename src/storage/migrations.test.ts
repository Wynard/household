import { describe, expect, it } from 'vitest';
import { migrateV1toV2, migrateV4toV5 } from './migrations';
import { DEFAULT_BUDGET_CATEGORIES } from '../domain/defaults';
import { parseFile } from '../domain/files';

const v1Items = {
  schemaVersion: 1,
  updatedAt: '2026-10-01T10:00:00Z',
  updatedBy: 'ana@example.com',
  items: [
    {
      id: 'a',
      name: 'Rice',
      category: 'Pantry',
      subcategory: 'Pasta & rice',
      categorySource: 'manual',
      place: 'Pantry',
      showInStock: true,
      unit: 'g',
      quantity: 1000,
      lowThreshold: 300,
      aliases: [],
    },
    {
      id: 'b',
      name: 'Eggs',
      category: 'Dairy & eggs',
      subcategory: 'Eggs',
      categorySource: 'manual',
      place: 'Fridge',
      showInStock: true,
      unit: 'pcs',
      quantity: 4,
      lowThreshold: 6,
      aliases: [],
    },
    {
      id: 'c',
      name: 'Soap',
      category: 'Household',
      subcategory: 'Cleaning',
      categorySource: 'auto',
      place: 'Bathroom',
      showInStock: true,
      unit: 'pcs',
      quantity: 0,
      aliases: [],
    },
  ],
};

describe('migration v1 -> v2', () => {
  it('turns v1 items into amount items with derived status and the same list behaviour', () => {
    const out = migrateV1toV2(structuredClone(v1Items), 'items') as unknown as {
      schemaVersion: number;
      items: Record<string, unknown>[];
    };
    expect(out.schemaVersion).toBe(2);
    expect(out.items.map((i) => [i.tracking, i.status, i.addToListWhen])).toEqual([
      ['amount', 'have', 'low'],
      ['amount', 'low', 'low'],
      ['amount', 'out', 'never'],
    ]);
  });

  it('is idempotent', () => {
    const once = migrateV1toV2(structuredClone(v1Items), 'items');
    expect(migrateV1toV2(structuredClone(once), 'items')).toEqual(once);
  });

  it('runs automatically when a v1 file is read, and only bumps other files', () => {
    const parsed = parseFile('items', structuredClone(v1Items));
    expect(parsed.schemaVersion).toBe(5); // v1 -> v2 -> v3 -> v4 -> v5
    expect(parsed.items[0]).toMatchObject({ tracking: 'amount', quantity: 1000, active: true });
    expect(migrateV1toV2({ schemaVersion: 1, entries: [] }, 'plan')).toEqual({
      schemaVersion: 2,
      entries: [],
    });
  });
});

describe('migration v4 -> v5', () => {
  const v4Household = {
    schemaVersion: 4,
    updatedAt: '2026-10-01T10:00:00Z',
    updatedBy: 'ana@example.com',
    members: [],
    monthlyTarget: 0,
    categories: [],
    places: [],
    stores: ['Lidl'],
    recipeCategories: [],
    units: [],
    years: [2026],
  };
  const v4Budget = {
    schemaVersion: 4,
    updatedAt: '2026-10-01T10:00:00Z',
    updatedBy: 'ana@example.com',
    year: 2026,
    openingBalance: 0,
    contributions: [],
    adjustments: [],
    deleted: [],
    purchases: [
      {
        id: 'p',
        date: '2026-10-02',
        store: 'Lidl',
        spentBy: 'ana@example.com',
        lines: [],
        total: 12,
        source: 'manual',
        createdBy: 'Ana',
        createdAt: '2026-10-02T10:00:00Z',
      },
    ],
  };

  it('gives an existing household the default budget categories, once', () => {
    const h = parseFile('household', structuredClone(v4Household));
    expect(h.schemaVersion).toBe(5);
    expect(h.budgetCategories).toEqual(DEFAULT_BUDGET_CATEGORIES);
    const own = { ...v4Household, budgetCategories: ['Rent'] };
    expect(migrateV4toV5(own, 'household', DEFAULT_BUDGET_CATEGORIES).budgetCategories).toEqual(['Rent']);
  });

  it('keeps older purchases as they are (store, no budget category)', () => {
    const b = parseFile('budget-2026', structuredClone(v4Budget));
    expect(b.purchases[0]).toMatchObject({ store: 'Lidl', total: 12 });
    expect(b.purchases[0].category).toBeUndefined();
  });
});
