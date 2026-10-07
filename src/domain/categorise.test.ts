import { describe, expect, it } from 'vitest';
import { categorise, normalise, ruleCategory } from './categorise';
import { DEFAULT_CATEGORIES } from './defaults';
import type { Item } from './schemas';

const cat = (name: string) => {
  const r = ruleCategory(name);
  return r ? `${r.category} › ${r.subcategory}` : null;
};

describe('normalise', () => {
  it('removes Romanian diacritics in both comma and cedilla forms', () => {
    expect(normalise('Smântână 20%')).toBe('smantana 20%');
    expect(normalise('Cașcaval')).toBe('cascaval');
    expect(normalise('Caşcaval')).toBe('cascaval');
    expect(normalise('ȚUICĂ')).toBe('tuica');
  });
});

describe('keyword rules', () => {
  it.each([
    ['Milk 1.5%', 'Dairy & eggs › Milk'],
    ['LAPTE ZUZU 1,5% 1L', 'Dairy & eggs › Milk'],
    ['smântână', 'Dairy & eggs › Butter & cream'],
    ['smantana 20%', 'Dairy & eggs › Butter & cream'],
    ['Sour cream', 'Dairy & eggs › Butter & cream'],
    ['Cașcaval', 'Dairy & eggs › Cheese'],
    ['cascaval', 'Dairy & eggs › Cheese'],
    ['Brânză telemea', 'Dairy & eggs › Cheese'],
    ['OUA M 10BUC', 'Dairy & eggs › Eggs'],
    ['Iaurt grecesc', 'Dairy & eggs › Yogurt'],
    ['PIEPT PUI', 'Meat & fish › Poultry'],
    ['ceafă de porc', 'Meat & fish › Pork'],
    ['Carne tocată vită', 'Meat & fish › Beef'],
    ['Somon', 'Meat & fish › Fish'],
    ['Șuncă presată', 'Meat & fish › Deli'],
    ['Roșii cherry', 'Produce › Vegetables'],
    ['ROSII CHERRY 250G', 'Produce › Vegetables'],
    ['Cartofi', 'Produce › Vegetables'],
    ['Mere Golden', 'Produce › Fruit'],
    ['Mărar', 'Produce › Herbs'],
    ['Pâine albă', 'Bakery › Bread'],
    ['Cozonac', 'Bakery › Pastries'],
    ['Făină 000', 'Pantry › Flour & baking'],
    ['Orez bob lung', 'Pantry › Pasta & rice'],
    ['Spaghete', 'Pantry › Pasta & rice'],
    ['Ulei floarea soarelui', 'Pantry › Oils & sauces'],
    ['Năut conservă', 'Pantry › Canned & jars'],
    ['Sare iodată', 'Pantry › Spices'],
    ['Cafea boabe', 'Drinks › Coffee & tea'],
    ['Apă minerală', 'Drinks › Water'],
    ['Bere Ursus', 'Drinks › Alcohol'],
    ['Ciocolată cu lapte', 'Snacks & sweets › Sweets'],
    ['Chipsuri', 'Snacks & sweets › Chips & nuts'],
    ['Înghețată vanilie', 'Frozen › Ice cream'],
    ['Mazăre congelată', 'Frozen › Frozen vegetables'],
    ['DETERG VASE 450ML', 'Household › Cleaning'],
    ['Detergent vase', 'Household › Cleaning'],
    ['Dish soap', 'Household › Cleaning'],
    ['Hârtie igienică', 'Household › Paper goods'],
    ['Saci menajeri', 'Household › Bags & foil'],
    ['Șampon', 'Personal care › Hygiene'],
    ['Vitamine C', 'Personal care › Health'],
  ])('%s -> %s', (name, expected) => {
    expect(cat(name)).toBe(expected);
  });

  it('rule order edge cases', () => {
    expect(cat('Laundry detergent')).toBe('Household › Laundry');
    expect(cat('Detergent rufe Ariel')).toBe('Household › Laundry');
    expect(cat('Toothpaste')).toBe('Personal care › Hygiene');
    expect(cat('Pastă de dinți')).toBe('Personal care › Hygiene');
    expect(cat('Ice cream')).toBe('Frozen › Ice cream');
    expect(cat('Cream cheese')).toBe('Dairy & eggs › Cheese');
    expect(cat('Peanut butter')).toBe('Pantry › Canned & jars');
    expect(cat('Orange juice')).toBe('Drinks › Juice & soda');
    expect(cat('Oțet de vin')).toBe('Pantry › Oils & sauces');
    expect(cat('Tomato passata')).toBe('Pantry › Canned & jars');
    expect(cat('Black pepper')).toBe('Pantry › Spices');
    expect(cat('Bell peppers')).toBe('Produce › Vegetables');
    expect(cat('Watermelon')).toBe('Produce › Fruit');
    expect(cat('Garlic bread')).toBe('Bakery › Bread');
    expect(cat('Milk chocolate')).toBe('Snacks & sweets › Sweets');
    expect(cat('Hand soap')).toBe('Personal care › Hygiene');
  });

  it('returns null when nothing matches', () => {
    expect(cat('Xyzzy')).toBeNull();
    expect(cat('')).toBeNull();
  });
});

describe('categorise', () => {
  const items = [
    {
      id: 'zuzu',
      name: 'Milk 1.5%',
      category: 'Dairy & eggs',
      subcategory: 'Milk',
      aliases: ['LAPTE ZUZU 1,5% 1L'],
      archived: false,
    },
    { id: 'odd', name: 'Mystery jar', category: 'Pantry', subcategory: 'Spices', aliases: [] },
  ] as unknown as Item[];

  it('prefers a known item by name or alias', () => {
    expect(categorise('lapte zuzu 1,5% 1l', items, DEFAULT_CATEGORIES)).toMatchObject({
      via: 'known',
      itemId: 'zuzu',
    });
    expect(categorise('Mystery jar', items, DEFAULT_CATEGORIES)).toMatchObject({
      via: 'known',
      category: 'Pantry',
      subcategory: 'Spices',
    });
  });

  it('falls back to rules, and only suggests categories that exist in the tree', () => {
    expect(categorise('Smântână', items, DEFAULT_CATEGORIES)).toMatchObject({
      via: 'rule',
      subcategory: 'Butter & cream',
    });
    const renamed = DEFAULT_CATEGORIES.map((c) => (c.name === 'Dairy & eggs' ? { ...c, name: 'Dairy' } : c));
    expect(categorise('Smântână', items, renamed)).toBeNull();
  });
});

describe('traps from our own kind of list (fictional names)', () => {
  it('categorises by what the thing is, not by a word it shares', () => {
    expect(cat('Pasta dinti')).toBe('Personal care › Hygiene'); // toothpaste, not pasta
    expect(cat('Nisip tofu')).toBe('Household › Pets'); // cat litter, not tofu
    expect(cat('Lapte ovaz')).toBe('Dairy & eggs › Milk'); // oat milk, not oats
    expect(cat('Mazare congelata')).toBe('Frozen › Frozen vegetables');
    expect(cat('Mazare')).toBe('Produce › Vegetables');
  });

  it('known items in a tree without subcategories still count', () => {
    const tree = [{ name: 'Lactate & oua', subcategories: [] }];
    const own = [
      { id: 'l', name: 'Lapte', category: 'Lactate & oua', subcategory: '', aliases: [], archived: false },
    ] as unknown as Item[];
    expect(categorise('lapte', own, tree)).toMatchObject({
      via: 'known',
      category: 'Lactate & oua',
      subcategory: '',
    });
    // with our own tree the English rules have nowhere to go: no wrong guess
    expect(categorise('Lapte ovaz', own, tree)).toBeNull();
  });
});
