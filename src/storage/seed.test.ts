import { describe, expect, it } from 'vitest';
import { parseFile, type DataFile } from '../domain/files';
import { buildSeed } from './seed';

describe('seed data', () => {
  for (const today of ['2026-10-07', '2027-01-03', '2026-03-31']) {
    it(`is valid against every file schema (today ${today})`, () => {
      const seed = buildSeed(today);
      for (const [name, data] of Object.entries(seed)) {
        expect(() => parseFile(name as DataFile, data)).not.toThrow();
      }
    });
  }

  it('has ~40 items with non-food and hidden ones, 6 recipes, three months of purchases', () => {
    const seed = buildSeed('2026-10-07') as Record<
      string,
      { items?: unknown[]; recipes?: unknown[]; purchases?: { date: string }[] }
    >;
    const items = seed.items.items as { showInStock: boolean; category: string }[];
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(items.some((i) => !i.showInStock)).toBe(true);
    expect(items.some((i) => i.category === 'Household')).toBe(true);
    expect(seed.recipes.recipes).toHaveLength(6);
    const months = new Set(seed['budget-2026'].purchases!.map((p) => p.date.slice(0, 7)));
    expect([...months].sort()).toEqual(['2026-08', '2026-09', '2026-10']);
  });

  it('never dates anything in the future', () => {
    const seed = buildSeed('2026-10-01') as Record<
      string,
      { purchases?: { date: string }[]; usage?: { date: string }[] }
    >;
    for (const p of seed['budget-2026'].purchases!) expect(p.date <= '2026-10-01').toBe(true);
    for (const u of seed['usage-2026'].usage!) expect(u.date <= '2026-10-01').toBe(true);
  });

  it('splits budget files across New Year with the opening balance carried forward', () => {
    const seed = buildSeed('2027-01-15') as Record<string, { openingBalance?: number }>;
    expect(seed['budget-2026']).toBeDefined();
    expect(seed['budget-2027']).toBeDefined();
    expect(seed['budget-2027'].openingBalance).not.toBe(180);
  });
});
