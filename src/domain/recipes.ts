import type { Ingredient, Item, Recipe, RecipeUnit, Step } from './schemas';
import { convert, isStockUnit } from './units';
import { normalise } from './categorise';
import { round3 } from './format';

export const totalMinutes = (r: Pick<Recipe, 'prepMinutes' | 'cookMinutes'>) =>
  (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);

/** Amount of an ingredient for `servings`, scaled from the recipe's own servings. */
export function scaledAmount(g: Ingredient, servings: number, base: number): number | undefined {
  if (g.amount === undefined) return undefined;
  return round3((g.amount * servings) / base);
}

export type IngredientStatus = 'have' | 'partly' | 'missing' | 'staple' | 'untracked';

export interface IngredientRow {
  ingredient: Ingredient;
  item?: Item;
  status: IngredientStatus;
  /** amount needed for the chosen servings, in the ingredient's unit */
  need?: number;
  unit?: RecipeUnit;
  /** need converted to the item's stock unit (when comparable) */
  needInItemUnit?: number;
  /** stock available for this ingredient, in the item's unit */
  have?: number;
  /** missing amount in the item's unit */
  short?: number;
  /** linked to a simple (have / low / out) item: amounts aren't compared */
  simple?: boolean;
  /** a simple item marked Low: available, with a warning */
  low?: boolean;
}

export type StockMap = Map<string, number>;
export const stockMapOf = (items: Item[]): StockMap => new Map(items.map((i) => [i.id, i.quantity]));

/**
 * Checks one ingredient against stock. Staples are never checked strictly;
 * unlinked ingredients and amounts that can't be compared (spoons, "to taste",
 * impossible unit conversions) are "not tracked".
 */
export function checkIngredient(
  g: Ingredient,
  servings: number,
  base: number,
  items: Map<string, Item>,
  stock: StockMap,
): IngredientRow {
  const need = scaledAmount(g, servings, base);
  if (g.pantryStaple) return { ingredient: g, status: 'staple', need, unit: g.unit };
  const item = g.itemId ? items.get(g.itemId) : undefined;
  if (!item) return { ingredient: g, status: 'untracked', need, unit: g.unit };
  if (item.tracking === 'simple') {
    // Have or Low counts as available (Low warns); Out is missing
    const status: IngredientStatus = item.status === 'out' ? 'missing' : 'have';
    return { ingredient: g, item, status, need, unit: g.unit, simple: true, low: item.status === 'low' };
  }
  const unit = g.unit ?? item.unit;
  const have = stock.get(item.id) ?? 0;
  if (need === undefined) {
    // linked but no amount: just needs to be in the house
    return {
      ingredient: g,
      item,
      status: have > 0 ? 'have' : 'missing',
      unit,
      have,
      short: have > 0 ? 0 : undefined,
    };
  }
  if (!isStockUnit(unit)) return { ingredient: g, item, status: 'untracked', need, unit, have };
  const needInItemUnit = convert(need, unit, item.unit, item.gramsPerPiece);
  if (needInItemUnit === null) return { ingredient: g, item, status: 'untracked', need, unit, have };
  const short = Math.max(0, round3(needInItemUnit - have));
  const status: IngredientStatus = short <= 0 ? 'have' : have > 0 ? 'partly' : 'missing';
  return { ingredient: g, item, status, need, unit, needInItemUnit, have, short };
}

export interface Availability {
  rows: IngredientRow[];
  /** required tracked ingredients that are partly or fully missing */
  missing: number;
  tracked: number;
  badge: 'ready' | 'missing' | 'untracked';
}

export function availability(
  recipe: Recipe,
  servings: number,
  items: Item[] | Map<string, Item>,
  stock?: StockMap,
): Availability {
  const map = items instanceof Map ? items : new Map(items.map((i) => [i.id, i]));
  const s = stock ?? new Map([...map.values()].map((i) => [i.id, i.quantity]));
  const rows = recipe.ingredients.map((g) => checkIngredient(g, servings, recipe.servings, map, s));
  const tracked = rows.filter((r) => r.status === 'have' || r.status === 'partly' || r.status === 'missing');
  const missing = tracked.filter(
    (r) => (r.status === 'partly' || r.status === 'missing') && !r.ingredient.optional,
  ).length;
  return {
    rows,
    missing,
    tracked: tracked.length,
    badge: tracked.length === 0 ? 'untracked' : missing === 0 ? 'ready' : 'missing',
  };
}

export const badgeLabel = (a: Availability) =>
  a.badge === 'ready' ? 'Ready to cook' : a.badge === 'untracked' ? 'Not tracked' : `Missing ${a.missing}`;

/**
 * What cooking takes out of stock: tracked, comparable ingredients of amount
 * items, in the item's unit. Simple items are never deducted (cooking offers
 * "Mark as Low / Out" for them instead).
 */
export function deductionsFor(
  recipe: Recipe,
  servings: number,
  items: Item[],
): { itemId: string; amount: number }[] {
  const a = availability(recipe, servings, items);
  const byItem = new Map<string, number>();
  for (const r of a.rows) {
    if (!r.item || r.simple || r.needInItemUnit === undefined) continue;
    byItem.set(r.item.id, round3((byItem.get(r.item.id) ?? 0) + r.needInItemUnit));
  }
  return [...byItem].map(([itemId, amount]) => ({ itemId, amount }));
}

// ---------- step helpers ----------

const WORD_NUM: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  o: 1,
  un: 1,
  una: 1,
  doua: 2,
  doi: 2,
  trei: 3,
  patru: 4,
  cinci: 5,
  sase: 6,
  sapte: 7,
  opt: 8,
  noua: 9,
  zece: 10,
  jumatate: 0.5,
  half: 0.5,
};

/**
 * Finds a cooking time in a step ("simmer for 10 minutes", "1-2 min",
 * "1 hour 15 minutes", "fierbe 20 de minute", "o oră"). Ranges use the upper
 * bound. Returns seconds, or undefined.
 */
export function detectTimerSeconds(text: string): number | undefined {
  let t = normalise(text).replace(/,/g, '.');
  let total = 0;
  if (/half an hour|jumatate de ora/.test(t)) {
    total += 1800;
    t = t.replace(/half an hour|jumatate de ora/g, ' ');
  }
  const numRe = '(\\d+(?:\\.\\d+)?|[a-z]+)';
  const val = (s: string) => (/^\d/.test(s) ? parseFloat(s) : WORD_NUM[s]);
  const hr = new RegExp(
    `${numRe}(?:\\s*(?:-|to|or|sau|la)\\s*${numRe})?\\s*(?:de\\s+)?(?:hours?|hrs?|h\\b|ore|ora)`,
    'g',
  );
  for (const m of t.matchAll(hr)) {
    const v = val(m[2] ?? m[1]);
    if (v) total += v * 3600;
  }
  const min = new RegExp(
    `${numRe}(?:\\s*(?:-|to|or|sau|la)\\s*${numRe})?\\s*(?:de\\s+)?(?:minutes?|mins?\\b|minute|minut)`,
    'g',
  );
  for (const m of t.matchAll(min)) {
    const v = val(m[2] ?? m[1]);
    if (v) total += v * 60;
  }
  const sec = new RegExp(`${numRe}\\s*(?:de\\s+)?(?:seconds?|secs?\\b|secunde)`, 'g');
  for (const m of t.matchAll(sec)) {
    const v = val(m[1]);
    if (v) total += v;
  }
  return total > 0 ? Math.round(total) : undefined;
}

/** Words that identify an ingredient in step text ("garlic cloves" -> garlic, cloves). */
function ingredientWords(g: Ingredient, item?: Item): string[] {
  const words = new Set<string>();
  for (const src of [g.name, item?.name ?? '']) {
    for (const w of normalise(src).split(' ')) {
      if (w.length >= 3 && !['and', 'the', 'with', 'fresh', 'cloves', 'de', 'cu', 'si'].includes(w)) {
        words.add(w);
        // simple plural/singular matching: tomatoes ~ tomato, eggs ~ egg
        words.add(w.replace(/(es|s)$/, ''));
      }
    }
  }
  return [...words].filter((w) => w.length >= 3);
}

/** Links each step to the ingredients its text mentions (shown under the step in cooking mode). */
export function linkSteps(steps: Step[], ingredients: Ingredient[], items: Item[] = []): Step[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const words = ingredients.map((g) => ({
    id: g.id,
    words: ingredientWords(g, g.itemId ? byId.get(g.itemId) : undefined),
  }));
  return steps.map((s) => {
    const text = ` ${normalise(s.text)} `;
    const ids = words.filter((w) => w.words.some((x) => new RegExp(`\\b${x}`).test(text))).map((w) => w.id);
    const { ingredientIds: _old, ...rest } = s;
    void _old;
    return ids.length ? { ...rest, ingredientIds: ids } : rest;
  });
}
