import { describe, expect, it } from 'vitest';
import { matchReceiptLine, similarity } from './matching';
import { seedSnapshot } from '../test/ctx';
import type { Item } from './schemas';

const items = seedSnapshot().items.items;

describe('receipt line matching', () => {
  it('1. exact alias match wins', () => {
    expect(matchReceiptLine('LAPTE ZUZU 1,5% 1L', 'Milk', items)).toEqual({
      itemId: 'milk',
      via: 'alias',
      confidence: 0.98,
    });
    expect(matchReceiptLine('DETERG VASE 450ML', 'Dish soap', items)).toMatchObject({
      itemId: 'dishsoap',
      via: 'alias',
    });
  });

  it('2. normalised fuzzy match on names and aliases', () => {
    expect(matchReceiptLine('PIEPT PUI FILE 0,842 KG', 'Chicken breast fillet', items)).toMatchObject({
      itemId: 'chicken',
      via: 'fuzzy',
    });
    expect(matchReceiptLine('TELEMEA VACA', 'Telemea cheese', items)).toMatchObject({ itemId: 'telemea' });
    expect(similarity('Sour cream 20%', 'Sour cream 20%')).toBe(1);
  });

  it("3. falls back to Gemini's suggestion only when it names a real item", () => {
    const m = matchReceiptLine('XYZ 500G', 'Something', items, { itemId: 'rice', confidence: 0.7 });
    expect(m).toMatchObject({ itemId: 'rice', via: 'gemini', confidence: 0.7 });
    expect(
      matchReceiptLine('XYZ 500G', 'Something', items, { itemId: 'made-up', confidence: 0.9 }),
    ).toMatchObject({ via: 'none' });
  });

  it('returns no match for unknown products', () => {
    expect(matchReceiptLine('HUMUS CLASIC 200G', 'Hummus', items)).toMatchObject({ via: 'none' });
  });
});

describe('matching traps (fictional catalog in the imported-list style)', () => {
  const mk = (id: string, name: string) =>
    ({ id, name, aliases: [], archived: false, category: 'X', subcategory: '' }) as unknown as Item;
  const own = [
    mk('lapte', 'Lapte'),
    mk('tofu', 'Tofu'),
    mk('pasta', 'Pasta'),
    mk('mazare', 'Mazare'),
    mk('mazarec', 'Mazare (congelat)'),
    mk('marar', 'Marar fresh'),
  ];

  it('oat milk is not milk, cat litter is not tofu, toothpaste is not pasta', () => {
    expect(matchReceiptLine('LAPTE OVAZ 1L', 'Lapte ovaz', own)).toMatchObject({ via: 'none' });
    expect(matchReceiptLine('NISIP TOFU 6L', 'Nisip tofu', own)).toMatchObject({ via: 'none' });
    expect(matchReceiptLine('PASTA DINTI 75ML', 'Pasta dinti', own)).toMatchObject({ via: 'none' });
    // and Gemini can't push them through either
    expect(
      matchReceiptLine('LAPTE OVAZ 1L', 'Lapte ovaz', own, { itemId: 'lapte', confidence: 0.9 }),
    ).toMatchObject({
      via: 'none',
    });
  });

  it('fresh and frozen versions are different items', () => {
    expect(matchReceiptLine('MAZARE CONGELATA 400G', 'Mazare congelata', own)).toMatchObject({
      itemId: 'mazarec',
    });
    expect(matchReceiptLine('MAZARE BOABE 500G', 'Mazare', own)).toMatchObject({ itemId: 'mazare' });
    expect(matchReceiptLine('MARAR LEGATURA', 'Marar', own)).toMatchObject({ via: 'none' });
  });

  it('plain lines still match the plain item', () => {
    expect(matchReceiptLine('LAPTE 3,5% 1L', 'Lapte', own)).toMatchObject({ itemId: 'lapte' });
  });
});
