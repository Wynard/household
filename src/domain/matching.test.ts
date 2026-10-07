import { describe, expect, it } from 'vitest';
import { matchReceiptLine, similarity } from './matching';
import { seedSnapshot } from '../test/ctx';

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
