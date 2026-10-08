import { describe, expect, it } from 'vitest';
import { migrateV1toV2 } from './migrations';
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
    expect(parsed.schemaVersion).toBe(3); // v1 -> v2 -> v3
    expect(parsed.items[0]).toMatchObject({ tracking: 'amount', quantity: 1000, active: true });
    expect(migrateV1toV2({ schemaVersion: 1, entries: [] }, 'plan')).toEqual({
      schemaVersion: 2,
      entries: [],
    });
  });
});
