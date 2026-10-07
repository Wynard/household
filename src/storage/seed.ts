// Realistic, entirely fictional sample data ("Ana" and "Mihai", @example.com).
// Dates are generated relative to today so the dashboard always has three
// months of history.
import {
  DEFAULT_CATEGORIES,
  DEFAULT_PLACES,
  DEFAULT_RECIPE_CATEGORIES,
  MEMBER_COLORS,
} from '../domain/defaults';
import type { DataFile } from '../domain/files';
import { budgetFileName, usageFileName } from '../domain/files';
import { shiftMonth, todayISO, shiftDays } from '../domain/dates';
import { toBase } from '../domain/units';
import {
  SCHEMA_VERSION,
  type BudgetFile,
  type Contribution,
  type CookedEntry,
  type Item,
  type PlanEntry,
  type Purchase,
  type Recipe,
  type ShoppingItem,
  type Unit,
  type UsageEntry,
} from '../domain/schemas';

export const SEED_MEMBERS = [
  { email: 'ana@example.com', name: 'Ana', color: MEMBER_COLORS[0] },
  { email: 'mihai@example.com', name: 'Mihai', color: MEMBER_COLORS[1] },
];
const ANA = SEED_MEMBERS[0].email;
const MIHAI = SEED_MEMBERS[1].email;
const nameOf = (email: string) => SEED_MEMBERS.find((m) => m.email === email)?.name ?? email;

type ItemSeed = [
  id: string,
  name: string,
  cat: string,
  sub: string,
  place: string,
  qty: number,
  unit: Unit,
  low: number,
  extra?: Partial<Item>,
];
const D = 'Dairy & eggs',
  M = 'Meat & fish',
  V = 'Produce',
  B = 'Bakery',
  A = 'Pantry',
  K = 'Drinks',
  S = 'Snacks & sweets',
  F = 'Frozen',
  H = 'Household',
  PC = 'Personal care';

const ITEMS: ItemSeed[] = [
  ['milk', 'Milk 1.5%', D, 'Milk', 'Fridge', 1, 'l', 2, { aliases: ['LAPTE ZUZU 1,5% 1L'] }],
  ['eggs', 'Eggs', D, 'Eggs', 'Fridge', 4, 'pcs', 6, { gramsPerPiece: 60, aliases: ['OUA M 10BUC'] }],
  ['butter', 'Butter', D, 'Butter & cream', 'Fridge', 200, 'g', 100],
  ['telemea', 'Telemea cheese', D, 'Cheese', 'Fridge', 400, 'g', 150],
  ['cascaval', 'Cașcaval', D, 'Cheese', 'Fridge', 250, 'g', 100],
  [
    'sourcream',
    'Sour cream 20%',
    D,
    'Butter & cream',
    'Fridge',
    0,
    'g',
    200,
    { aliases: ['SMANTANA 20% 400G'] },
  ],
  ['yogurt', 'Yogurt', D, 'Yogurt', 'Fridge', 2, 'pcs', 2],
  ['tomatoes', 'Tomatoes', V, 'Vegetables', 'Fridge', 0.6, 'kg', 0.5],
  ['peppers', 'Bell peppers', V, 'Vegetables', 'Fridge', 0.5, 'kg', 0],
  ['cucumbers', 'Cucumbers', V, 'Vegetables', 'Fridge', 0.3, 'kg', 0],
  ['lemons', 'Lemons', V, 'Fruit', 'Fridge', 2, 'pcs', 0, { gramsPerPiece: 120 }],
  ['dill', 'Dill and parsley', V, 'Herbs', 'Fridge', 1, 'pcs', 0],
  ['chicken', 'Chicken breast', M, 'Poultry', 'Freezer', 0, 'g', 300, { aliases: ['PIEPT PUI'] }],
  ['pork', 'Pork neck', M, 'Pork', 'Freezer', 1100, 'g', 0],
  ['mince', 'Beef mince', M, 'Beef', 'Freezer', 500, 'g', 0],
  ['frozenveg', 'Frozen vegetables', F, 'Frozen vegetables', 'Freezer', 1, 'kg', 0],
  ['icecream', 'Ice cream', F, 'Ice cream', 'Freezer', 1, 'pcs', 0],
  ['potatoes', 'Potatoes', V, 'Vegetables', 'Pantry', 2.5, 'kg', 1],
  ['onions', 'Onions', V, 'Vegetables', 'Pantry', 1.25, 'kg', 0.5],
  ['garlic', 'Garlic cloves', V, 'Vegetables', 'Pantry', 8, 'pcs', 4, { gramsPerPiece: 5 }],
  ['apples', 'Apples', V, 'Fruit', 'Pantry', 1, 'kg', 0],
  ['bananas', 'Bananas', V, 'Fruit', 'Pantry', 0, 'kg', 0],
  ['rice', 'Rice', A, 'Pasta & rice', 'Pantry', 1000, 'g', 300],
  ['pasta', 'Pasta', A, 'Pasta & rice', 'Pantry', 500, 'g', 250],
  ['flour', 'Flour', A, 'Flour & baking', 'Pantry', 1000, 'g', 300],
  ['sugar', 'Sugar', A, 'Flour & baking', 'Pantry', 800, 'g', 200],
  ['oil', 'Sunflower oil', A, 'Oils & sauces', 'Pantry', 0.75, 'l', 0.25],
  ['passata', 'Tomato passata', A, 'Canned & jars', 'Pantry', 1, 'pcs', 1],
  ['chickpeas', 'Chickpeas', A, 'Canned & jars', 'Pantry', 2, 'pcs', 0],
  ['bread', 'Bread', B, 'Bread', 'Pantry', 1, 'pcs', 0],
  ['coffee', 'Coffee beans', K, 'Coffee & tea', 'Pantry', 300, 'g', 150],
  ['water', 'Sparkling water', K, 'Water', 'Storage room', 4, 'l', 2],
  ['juice', 'Juice', K, 'Juice & soda', 'Pantry', 1, 'l', 0],
  ['chocolate', 'Chocolate', S, 'Sweets', 'Pantry', 1, 'pcs', 0],
  ['chips', 'Chips', S, 'Chips & nuts', 'Pantry', 1, 'pcs', 0],
  ['beer', 'Beer', K, 'Alcohol', 'Storage room', 4, 'pcs', 0, { showInStock: false }],
  ['wine', 'White wine', K, 'Alcohol', 'Storage room', 1, 'pcs', 0, { showInStock: false }],
  [
    'dishsoap',
    'Dish soap',
    H,
    'Cleaning',
    'Cleaning cupboard',
    0,
    'pcs',
    1,
    { aliases: ['DETERG VASE 450ML'] },
  ],
  ['cleaner', 'All-purpose cleaner', H, 'Cleaning', 'Cleaning cupboard', 1, 'pcs', 1],
  ['laundry', 'Laundry detergent', H, 'Laundry', 'Cleaning cupboard', 1.5, 'l', 1],
  ['toiletpaper', 'Toilet paper', H, 'Paper goods', 'Bathroom', 6, 'pcs', 4],
  ['papertowels', 'Paper towels', H, 'Paper goods', 'Storage room', 2, 'pcs', 1],
  ['trashbags', 'Trash bags', H, 'Bags & foil', 'Storage room', 0, 'pcs', 1],
  ['bulbs', 'Light bulbs', H, 'Paper goods', 'Storage room', 3, 'pcs', 1],
  ['shampoo', 'Shampoo', PC, 'Hygiene', 'Bathroom', 1, 'pcs', 1],
  ['toothpaste', 'Toothpaste', PC, 'Hygiene', 'Bathroom', 2, 'pcs', 1],
  ['vitamins', 'Vitamins', PC, 'Health', 'Bathroom', 1, 'pcs', 0, { showInStock: false }],
];

function buildItems(): Item[] {
  return ITEMS.map(([id, name, category, subcategory, place, quantity, unit, low, extra]) => ({
    id,
    name,
    category,
    subcategory,
    categorySource: 'manual',
    place,
    showInStock: true,
    unit,
    quantity,
    ...(low > 0 ? { lowThreshold: low } : {}),
    aliases: [],
    ...extra,
  }));
}

// ---------- recipes ----------
let ingN = 0;
const ing = (itemId: string | null, name: string, amount?: number, unit?: Unit) => ({
  id: `i${++ingN}`,
  ...(itemId ? { itemId } : { pantryStaple: true }),
  name,
  ...(amount !== undefined ? { amount, unit } : {}),
});
let stepN = 0;
const step = (text: string, timerSeconds?: number, ingredientIds?: string[]) => ({
  id: `s${++stepN}`,
  text,
  ...(timerSeconds ? { timerSeconds } : {}),
  ...(ingredientIds ? { ingredientIds } : {}),
});

function buildRecipes(): Recipe[] {
  ingN = 0;
  stepN = 0;
  const r = (
    id: string,
    title: string,
    minutes: number,
    servings: number,
    favourite: boolean,
    categories: string[],
    ingredients: ReturnType<typeof ing>[],
    steps: (ing: Record<string, string>) => ReturnType<typeof step>[],
  ): Recipe => {
    const byItem: Record<string, string> = {};
    ingredients.forEach((g) => {
      if ('itemId' in g && g.itemId) byItem[g.itemId] = g.id;
    });
    return {
      id,
      title,
      cookMinutes: minutes,
      servings,
      favourite,
      categories,
      ingredients,
      steps: steps(byItem),
    };
  };
  return [
    r(
      'pancakes',
      'Clătite (thin pancakes)',
      30,
      4,
      true,
      ['Romanian', 'Desserts', 'Breakfast'],
      [
        ing('flour', 'flour', 250, 'g'),
        ing('milk', 'milk', 0.5, 'l'),
        ing('eggs', 'eggs', 3, 'pcs'),
        ing('oil', 'oil', 0.05, 'l'),
        ing(null, 'Salt and sugar'),
      ],
      (i) => [
        step('Whisk the eggs with a pinch of salt and 1 tablespoon of sugar.', undefined, [i.eggs]),
        step(
          'Add the milk and the flour in turns, whisking until the batter is smooth and thin like cream.',
          undefined,
          [i.milk, i.flour],
        ),
        step('Stir in 2 tablespoons of oil and let the batter rest for 10 minutes.', 600, [i.oil]),
        step('Heat a lightly oiled pan on medium. Pour in a thin layer and swirl to cover the pan.'),
        step(
          'Cook about 1 minute per side, until golden spots appear. Repeat with the rest of the batter.',
          60,
        ),
      ],
    ),
    r(
      'omelette',
      'Telemea omelette',
      10,
      2,
      true,
      ['Romanian', 'Breakfast'],
      [
        ing('eggs', 'eggs', 4, 'pcs'),
        ing('telemea', 'telemea', 100, 'g'),
        ing('butter', 'butter', 20, 'g'),
        ing('tomatoes', 'tomatoes', 0.2, 'kg'),
        ing(null, 'Salt'),
      ],
      (i) => [
        step('Beat the eggs with a pinch of salt.', undefined, [i.eggs]),
        step('Crumble the telemea and dice the tomatoes.', undefined, [i.telemea, i.tomatoes]),
        step('Melt the butter in a pan on medium heat and pour in the eggs.', undefined, [i.butter]),
        step('Scatter the cheese and tomatoes on top, cover, and cook for 4 minutes, until just set.', 240),
      ],
    ),
    r(
      'tomatopasta',
      'Tomato and garlic pasta',
      20,
      2,
      false,
      ['Italian'],
      [
        ing('pasta', 'pasta', 250, 'g'),
        ing('tomatoes', 'tomatoes', 0.4, 'kg'),
        ing('garlic', 'garlic cloves', 3, 'pcs'),
        ing('oil', 'oil', 0.05, 'l'),
        ing(null, 'Salt'),
      ],
      (i) => [
        step('Bring a large pot of salted water to the boil and cook the pasta for 10 minutes.', 600, [
          i.pasta,
        ]),
        step('Meanwhile, slice the garlic and chop the tomatoes.', undefined, [i.garlic, i.tomatoes]),
        step('Warm the oil in a pan and fry the garlic for 1 minute without letting it brown.', 60, [i.oil]),
        step('Add the tomatoes and simmer for 8 minutes, until saucy.', 480),
        step('Drain the pasta, keeping a splash of the water, and toss everything together.'),
      ],
    ),
    r(
      'chickenpotatoes',
      'Chicken with potatoes and sour cream',
      60,
      4,
      false,
      ['Romanian'],
      [
        ing('chicken', 'chicken breast', 600, 'g'),
        ing('potatoes', 'potatoes', 1, 'kg'),
        ing('onions', 'onions', 0.25, 'kg'),
        ing('sourcream', 'sour cream', 200, 'g'),
        ing('garlic', 'garlic cloves', 2, 'pcs'),
        ing(null, 'Salt and pepper'),
      ],
      (i) => [
        step('Heat the oven to 200°C. Peel the potatoes and cut them into quarters.', undefined, [
          i.potatoes,
        ]),
        step('Slice the onions, crush the garlic, and cut the chicken into large pieces.', undefined, [
          i.onions,
          i.garlic,
          i.chicken,
        ]),
        step('Layer the potatoes, onion and chicken in a tray and season with salt and pepper.'),
        step('Roast in the oven for 35 minutes.', 2100),
        step('Spread the sour cream over the chicken and roast 10 more minutes.', 600, [i.sourcream]),
      ],
    ),
    r(
      'friedrice',
      'Chicken fried rice',
      25,
      2,
      false,
      ['Asian'],
      [
        ing('rice', 'rice', 250, 'g'),
        ing('chicken', 'chicken breast', 300, 'g'),
        ing('eggs', 'eggs', 2, 'pcs'),
        ing('garlic', 'garlic cloves', 2, 'pcs'),
        ing('oil', 'oil', 0.03, 'l'),
        ing(null, 'Soy sauce'),
      ],
      (i) => [
        step('Cook the rice for 15 minutes and spread it on a plate to cool. Day-old rice works best.', 900, [
          i.rice,
        ]),
        step('Cut the chicken into small pieces and slice the garlic.', undefined, [i.chicken, i.garlic]),
        step('Heat the oil in a wok on high and fry the chicken for 5 minutes, until golden.', 300, [i.oil]),
        step('Push the chicken aside and scramble the eggs in the empty space.', undefined, [i.eggs]),
        step('Add the rice and garlic, toss for 3 minutes, and season with soy sauce.', 180),
      ],
    ),
    r(
      'shakshuka',
      'Shakshuka',
      30,
      2,
      false,
      ['Arabic', 'Breakfast'],
      [
        ing('eggs', 'eggs', 4, 'pcs'),
        ing('tomatoes', 'tomatoes', 0.6, 'kg'),
        ing('onions', 'onions', 0.15, 'kg'),
        ing('garlic', 'garlic cloves', 2, 'pcs'),
        ing('oil', 'oil', 0.03, 'l'),
        ing(null, 'Cumin and paprika'),
      ],
      (i) => [
        step('Soften the chopped onion in the oil over medium heat for 5 minutes.', 300, [i.onions, i.oil]),
        step('Add the garlic, 1 teaspoon cumin and 1 teaspoon paprika, and stir for a minute.', undefined, [
          i.garlic,
        ]),
        step('Add the chopped tomatoes and simmer for 10 minutes, until thick.', 600, [i.tomatoes]),
        step('Make 4 hollows in the sauce and crack an egg into each.', undefined, [i.eggs]),
        step('Cover and cook for 6 minutes, until the whites are set but the yolks are still soft.', 360),
      ],
    ),
  ];
}

// ---------- purchases (month offset -2, -1, 0) ----------
type L = [name: string, qty: number, unit: Unit, price: number];
type PSeed = [
  mo: number,
  day: number,
  time: string,
  by: 'A' | 'M',
  store: string,
  purpose: string,
  lines: L[],
];
const P_SEED: PSeed[] = [
  [
    -2,
    2,
    '10:15',
    'M',
    'Kaufland',
    'Big weekly shop',
    [
      ['Pork neck', 1.2, 'kg', 38.28],
      ['Chicken breast', 1, 'kg', 29.99],
      ['Potatoes', 3, 'kg', 11.97],
      ['Onions', 1, 'kg', 3.49],
      ['Milk 1.5%', 4, 'l', 27.96],
      ['Eggs', 10, 'pcs', 12.49],
      ['Coffee beans', 500, 'g', 39.9],
      ['Laundry detergent', 1, 'l', 49.99],
    ],
  ],
  [
    -2,
    6,
    '18:30',
    'A',
    'Piața Obor',
    'Market vegetables',
    [
      ['Tomatoes', 2, 'kg', 16],
      ['Cucumbers', 1, 'kg', 7],
      ['Bell peppers', 1, 'kg', 12],
      ['Watermelon', 1, 'pcs', 15],
      ['Dill and parsley', 2, 'pcs', 4],
      ['Telemea cheese', 0.5, 'kg', 25],
    ],
  ],
  [
    -2,
    10,
    '19:05',
    'A',
    'Lidl',
    '',
    [
      ['Pasta', 1000, 'g', 8.98],
      ['Rice', 1000, 'g', 7.99],
      ['Sunflower oil', 1, 'l', 8.49],
      ['Butter', 200, 'g', 11.5],
      ['Yogurt', 4, 'pcs', 9.96],
      ['Bananas', 1.2, 'kg', 7.18],
      ['Chocolate', 2, 'pcs', 9.98],
      ['Beer', 6, 'pcs', 23.94],
    ],
  ],
  [
    -2,
    16,
    '11:20',
    'M',
    'Carrefour',
    'Weekly shop',
    [
      ['Chicken breast', 0.8, 'kg', 23.99],
      ['Salmon', 0.4, 'kg', 39.96],
      ['Sour cream 20%', 400, 'g', 8.99],
      ['Flour', 1000, 'g', 4.49],
      ['Sugar', 1000, 'g', 4.99],
      ['Tomatoes', 1, 'kg', 8.99],
      ['Apples', 2, 'kg', 9.98],
      ['Toilet paper', 8, 'pcs', 24.99],
      ['Dish soap', 1, 'pcs', 9.99],
      ['Sparkling water', 6, 'l', 6.8],
    ],
  ],
  [
    -2,
    23,
    '17:45',
    'A',
    'dm',
    'Bathroom restock',
    [
      ['Shampoo', 1, 'pcs', 18.9],
      ['Toothpaste', 2, 'pcs', 15.98],
      ['Vitamins', 1, 'pcs', 29.9],
    ],
  ],
  [
    -2,
    29,
    '10:00',
    'M',
    'Kaufland',
    '',
    [
      ['Pork neck', 1, 'kg', 31.9],
      ['Milk 1.5%', 4, 'l', 27.96],
      ['Eggs', 10, 'pcs', 12.49],
      ['Potatoes', 2, 'kg', 7.98],
      ['Cașcaval', 0.4, 'kg', 19.96],
      ['Bread', 2, 'pcs', 9.8],
      ['Juice', 2, 'l', 13.98],
      ['Chips', 2, 'pcs', 11.98],
    ],
  ],
  [
    -1,
    1,
    '18:40',
    'A',
    'Lidl',
    '',
    [
      ['Milk 1.5%', 3, 'l', 20.97],
      ['Eggs', 10, 'pcs', 12.49],
      ['Yogurt', 4, 'pcs', 9.96],
      ['Bananas', 1, 'kg', 5.99],
      ['Pasta', 500, 'g', 4.49],
      ['Tomato passata', 2, 'pcs', 9.98],
      ['Chocolate', 1, 'pcs', 4.99],
    ],
  ],
  [
    -1,
    5,
    '11:00',
    'M',
    'Kaufland',
    'Big weekly shop',
    [
      ['Chicken breast', 1.2, 'kg', 35.99],
      ['Beef mince', 0.5, 'kg', 24.99],
      ['Potatoes', 2.5, 'kg', 9.98],
      ['Onions', 1, 'kg', 3.49],
      ['Rice', 1000, 'g', 7.99],
      ['Chickpeas', 2, 'pcs', 9.98],
      ['Coffee beans', 500, 'g', 39.9],
      ['Paper towels', 2, 'pcs', 14.99],
    ],
  ],
  [
    -1,
    12,
    '18:20',
    'A',
    'Mega Image',
    'Dinner with friends',
    [
      ['Salmon', 0.5, 'kg', 49.95],
      ['Lemons', 0.5, 'kg', 4.99],
      ['White wine', 2, 'pcs', 59.98],
      ['Baguette', 2, 'pcs', 7.98],
      ['Cașcaval', 0.3, 'kg', 17.97],
      ['Ice cream', 1, 'pcs', 19.99],
    ],
  ],
  [
    -1,
    14,
    '10:30',
    'A',
    'Piața Obor',
    'Market vegetables',
    [
      ['Tomatoes', 2, 'kg', 14],
      ['Bell peppers', 1.5, 'kg', 15],
      ['Grapes', 1, 'kg', 10],
      ['Telemea cheese', 0.5, 'kg', 25],
      ['Eggs', 10, 'pcs', 15],
      ['Dill and parsley', 2, 'pcs', 4],
    ],
  ],
  [
    -1,
    20,
    '17:00',
    'M',
    'Carrefour',
    '',
    [
      ['Pork neck', 1, 'kg', 32.9],
      ['Milk 1.5%', 4, 'l', 27.96],
      ['Sour cream 20%', 400, 'g', 8.99],
      ['Flour', 1000, 'g', 4.49],
      ['Sunflower oil', 1, 'l', 8.49],
      ['Laundry detergent', 1, 'l', 47.99],
      ['Frozen vegetables', 1, 'kg', 12.99],
      ['Beer', 6, 'pcs', 23.94],
    ],
  ],
  [
    -1,
    27,
    '12:00',
    'M',
    'Lidl',
    '',
    [
      ['Chicken breast', 0.8, 'kg', 22.4],
      ['Eggs', 10, 'pcs', 12.49],
      ['Bread', 2, 'pcs', 9.8],
      ['Apples', 1.5, 'kg', 7.49],
      ['Yogurt', 4, 'pcs', 9.96],
      ['Dish soap', 1, 'pcs', 9.99],
      ['Chips', 1, 'pcs', 5.99],
    ],
  ],
  [
    0,
    1,
    '18:42',
    'M',
    'Kaufland',
    'Big weekly shop',
    [
      ['Coffee beans', 500, 'g', 39.9],
      ['Laundry detergent', 1, 'l', 49.99],
      ['Pork neck', 1.1, 'kg', 35.09],
      ['Telemea cheese', 0.4, 'kg', 25.45],
      ['Toilet paper', 8, 'pcs', 24.99],
      ['Potatoes', 2.5, 'kg', 9.98],
      ['Apples', 1.5, 'kg', 8.98],
      ['Sunflower oil', 1, 'l', 8.49],
      ['Rice', 1000, 'g', 7.99],
      ['Onions', 1, 'kg', 3.49],
    ],
  ],
  [
    0,
    2,
    '12:15',
    'A',
    'Mega Image',
    'Friday dinner',
    [
      ['Butter', 200, 'g', 11.5],
      ['Bread', 2, 'pcs', 9.8],
      ['Tomatoes', 0.6, 'kg', 7.21],
      ['Pasta', 500, 'g', 6.99],
      ['Sparkling water', 6, 'l', 6.8],
      ['Garlic cloves', 10, 'pcs', 4.5],
    ],
  ],
];

/** Categories for purchase lines that aren't catalog items. */
const EXTRA_LINE_CATS: Record<string, [string, string]> = {
  Watermelon: [V, 'Fruit'],
  Salmon: [M, 'Fish'],
  Baguette: [B, 'Bread'],
  Grapes: [V, 'Fruit'],
};

function dateFor(mo: number, day: number, today: string): string {
  const ym = shiftMonth(today.slice(0, 7), mo);
  const lastDay = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
  let d = Math.min(day, lastDay);
  if (mo === 0) d = Math.min(d, Number(today.slice(8, 10)));
  return `${ym}-${String(d).padStart(2, '0')}`;
}

export function buildSeed(today = todayISO()): Partial<Record<DataFile, unknown>> {
  const items = buildItems();
  const recipes = buildRecipes();
  const byName = new Map(items.map((i) => [i.name, i]));
  const env = (by = ANA) => ({
    schemaVersion: SCHEMA_VERSION,
    updatedAt: `${today}T08:00:00.000Z`,
    updatedBy: by,
  });

  // purchases
  const purchases: Purchase[] = P_SEED.map(([mo, day, time, by, store, purpose, lines], pi) => {
    const date = dateFor(mo, day, today);
    const spentBy = by === 'A' ? ANA : MIHAI;
    const receipt = store !== 'Piața Obor';
    const pl = lines.map(([name, quantity, unit, price], li) => {
      const it = byName.get(name);
      const [category, subcategory] = it
        ? [it.category, it.subcategory]
        : (EXTRA_LINE_CATS[name] ?? ['Pantry', 'Canned & jars']);
      return {
        id: `p${pi}l${li}`,
        ...(it ? { itemId: it.id } : {}),
        name,
        quantity,
        unit,
        unitPrice: Math.round((price / quantity) * 100) / 100,
        price,
        category,
        subcategory,
      };
    });
    return {
      id: `p${pi}`,
      date,
      time,
      store,
      spentBy,
      ...(purpose ? { purpose } : {}),
      lines: pl,
      total: Math.round(pl.reduce((t, l) => t + l.price, 0) * 100) / 100,
      source: receipt ? 'receipt' : 'manual',
      createdBy: nameOf(spentBy),
      createdAt: `${date}T${time}:00.000Z`,
    } satisfies Purchase;
  });

  // last price per item
  for (const p of purchases) {
    for (const l of p.lines) {
      const it = l.itemId ? items.find((i) => i.id === l.itemId) : undefined;
      if (it)
        it.lastPrice = {
          amount: Math.round((l.price / l.quantity) * 100) / 100,
          per: l.unit,
          date: p.date,
          store: p.store,
        };
    }
  }

  // contributions: 500 each on the 1st of every month
  const contributions: Contribution[] = [];
  for (const mo of [-2, -1, 0]) {
    const date = dateFor(mo, 1, today);
    for (const m of SEED_MEMBERS)
      contributions.push({
        id: `c${mo + 2}${m.name[0]}`,
        date,
        by: m.email,
        amount: 500,
        note: 'Monthly contribution',
        createdBy: m.name,
        createdAt: `${date}T09:00:00.000Z`,
      });
  }

  // usage: most food bought gets used (household & personal care are not "consumed" here)
  const factors = [0.9, 0.7, 1, 0.8, 0.6, 0.85];
  const usage: UsageEntry[] = [];
  let k = 0;
  for (const p of purchases) {
    for (const l of p.lines) {
      if (l.category === H || l.category === PC || !l.itemId) continue;
      const f = factors[k % factors.length];
      const b = toBase(l.quantity, l.unit);
      const useDate = shiftDays(p.date, 2 + (k % 4));
      usage.push({
        id: `u${k}`,
        date: useDate > today ? today : useDate,
        by: k % 2 ? ANA : MIHAI,
        itemId: l.itemId,
        name: l.name,
        category: l.category,
        subcategory: l.subcategory,
        quantity: Math.round(b.q * f),
        unit: b.u,
        value: Math.round(l.price * f * 100) / 100,
        reason: k % 3 === 0 ? 'cooked' : 'manual-decrease',
      });
      k++;
    }
  }

  // cooked log
  const COOKED: [mo: number, recipe: string, by: 'A' | 'M', n: number][] = [
    [-2, 'tomatopasta', 'A', 3],
    [-2, 'pancakes', 'M', 2],
    [-2, 'chickenpotatoes', 'M', 2],
    [-2, 'friedrice', 'A', 1],
    [-1, 'omelette', 'A', 4],
    [-1, 'tomatopasta', 'M', 2],
    [-1, 'shakshuka', 'A', 2],
    [-1, 'chickenpotatoes', 'M', 1],
    [0, 'omelette', 'M', 1],
  ];
  const cooked: CookedEntry[] = [];
  COOKED.forEach(([mo, recipeId, by, n], ci) => {
    for (let j = 0; j < n; j++) {
      cooked.push({
        id: `k${ci}-${j}`,
        date: dateFor(mo, 3 + j * 6, today),
        by: by === 'A' ? ANA : MIHAI,
        recipeId,
        servings: recipes.find((r) => r.id === recipeId)?.servings ?? 2,
      });
    }
  });

  // split by year (handles seeds that cross New Year)
  const years = Array.from(
    new Set(
      [...purchases.map((p) => p.date), ...contributions.map((c) => c.date)].map((d) =>
        Number(d.slice(0, 4)),
      ),
    ),
  ).sort();
  const files: Partial<Record<DataFile, unknown>> = {};
  let opening = 180;
  for (const y of years) {
    const inYear = <T extends { date: string }>(list: T[]) =>
      list.filter((x) => Number(x.date.slice(0, 4)) === y);
    const b: BudgetFile = {
      ...env(),
      year: y,
      openingBalance: Math.round(opening * 100) / 100,
      contributions: inYear(contributions),
      purchases: inYear(purchases),
      adjustments: [],
      deleted: [],
    };
    files[budgetFileName(y)] = b;
    opening =
      b.openingBalance +
      b.contributions.reduce((t, c) => t + c.amount, 0) -
      b.purchases.reduce((t, p) => t + p.total, 0);
    files[usageFileName(y)] = { ...env(), year: y, usage: inYear(usage), cooked: inYear(cooked) };
  }

  // the next few days' plan
  const plan: PlanEntry[] = [
    { id: 'e1', date: today, slot: 'dinner', recipeId: 'tomatopasta', servings: 2 },
    { id: 'e2', date: shiftDays(today, 1), slot: 'dinner', recipeId: 'chickenpotatoes', servings: 4 },
    { id: 'e3', date: shiftDays(today, 2), slot: 'lunch', recipeId: 'omelette', servings: 2 },
    { id: 'e4', date: shiftDays(today, 3), slot: 'dinner', recipeId: 'pancakes', servings: 4 },
  ];

  const at = `${today}T07:30:00.000Z`;
  const shop = (
    id: string,
    name: string,
    source: ShoppingItem['source'],
    addedBy: string,
    extra: Partial<ShoppingItem> = {},
  ): ShoppingItem => ({
    id,
    name,
    source,
    checked: false,
    addedBy,
    addedAt: at,
    ...extra,
  });
  const shopping: ShoppingItem[] = [
    shop('sh1', 'Milk 1.5%', 'low-stock', 'Ana', { itemId: 'milk', amount: 2, unit: 'l' }),
    shop('sh2', 'Eggs', 'low-stock', 'Ana', { itemId: 'eggs', amount: 10, unit: 'pcs' }),
    shop('sh3', 'Chicken breast', 'plan', 'Ana', { itemId: 'chicken', amount: 600, unit: 'g' }),
    shop('sh4', 'Sour cream 20%', 'recipe', 'Ana', {
      itemId: 'sourcream',
      amount: 200,
      unit: 'g',
      sourceRef: 'chickenpotatoes',
    }),
    shop('sh5', 'Dish soap', 'manual', 'Mihai', { itemId: 'dishsoap' }),
    shop('sh6', 'Trash bags', 'low-stock', 'Ana', { itemId: 'trashbags', unit: 'pcs' }),
    shop('sh7', 'Bread', 'manual', 'Ana'),
    shop('sh8', 'Apples', 'manual', 'Ana', { amount: 1, unit: 'kg' }),
  ];

  const stores = ['Lidl', 'Kaufland', 'Mega Image', 'Carrefour', 'Piața Obor', 'dm', 'Profi', 'Penny'];

  return {
    ...files,
    household: {
      ...env(),
      members: SEED_MEMBERS,
      monthlyTarget: 900,
      categories: DEFAULT_CATEGORIES,
      places: DEFAULT_PLACES,
      stores,
      recipeCategories: DEFAULT_RECIPE_CATEGORIES,
      years,
    },
    items: { ...env(), items },
    recipes: { ...env(), recipes },
    plan: { ...env(), entries: plan },
    shopping: { ...env(), items: shopping },
  };
}
