// Cumulative plan availability (6.3): uncooked meals from today onwards are
// checked in date order (lunch before dinner); each one reserves the stock it
// needs, so a later meal can show "missing" even if stock looks fine now.
import type { Item, PlanEntry, Recipe, ShoppingItem } from './schemas';
import { convert } from './units';
import { availability, stockMapOf, type Availability } from './recipes';
import { round3 } from './format';

export interface PlannedMeal {
  entry: PlanEntry;
  recipe?: Recipe;
  /** availability given what earlier meals already reserved; undefined for cooked/past meals */
  av?: Availability;
  /** shortfall per item (item unit) attributed to this meal */
  short: Map<string, number>;
}

const slotOrder = (s: PlanEntry['slot']) => (s === 'lunch' ? 0 : 1);
export const sortEntries = (a: PlanEntry, b: PlanEntry) =>
  a.date.localeCompare(b.date) || slotOrder(a.slot) - slotOrder(b.slot);

export function planAvailability(
  entries: PlanEntry[],
  recipes: Recipe[],
  items: Item[],
  today: string,
): Map<string, PlannedMeal> {
  const byRecipe = new Map(recipes.map((r) => [r.id, r]));
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const remaining = stockMapOf(items);
  const out = new Map<string, PlannedMeal>();
  for (const e of entries.slice().sort(sortEntries)) {
    const recipe = byRecipe.get(e.recipeId);
    if (!recipe || e.cooked || e.date < today) {
      out.set(e.id, { entry: e, recipe, short: new Map() });
      continue;
    }
    const av = availability(recipe, e.servings, itemMap, remaining);
    const short = new Map<string, number>();
    for (const r of av.rows) {
      if (!r.item || r.needInItemUnit === undefined) continue;
      const have = remaining.get(r.item.id) ?? 0;
      if (!r.ingredient.optional && r.short && r.short > 0)
        short.set(r.item.id, round3((short.get(r.item.id) ?? 0) + r.short));
      remaining.set(r.item.id, Math.max(0, round3(have - r.needInItemUnit)));
    }
    out.set(e.id, { entry: e, recipe, av, short });
  }
  return out;
}

/** Total shortfall per item over the given meals (e.g. one week). */
export function shortfall(meals: PlannedMeal[]): Map<string, number> {
  const total = new Map<string, number>();
  for (const m of meals) for (const [id, q] of m.short) total.set(id, round3((total.get(id) ?? 0) + q));
  return total;
}

/** Shortfall items not yet covered by an open shopping-list entry with enough amount. */
export function uncovered(
  short: Map<string, number>,
  shopping: ShoppingItem[],
  items: Map<string, Item>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, q] of short) {
    const it = items.get(id);
    const open = shopping.find((s) => !s.checked && s.itemId === id);
    const onList =
      open && it
        ? open.amount === undefined
          ? Infinity
          : (convert(open.amount, open.unit ?? it.unit, it.unit, it.gramsPerPiece) ?? 0)
        : 0;
    if (onList + 1e-9 < q) out.set(id, round3(q - (Number.isFinite(onList) ? onList : 0)));
  }
  return out;
}

export function mealStatus(m: PlannedMeal): {
  label: string;
  tone: 'ready' | 'missing' | 'muted' | 'cooked';
} {
  if (m.entry.cooked) return { label: 'Cooked', tone: 'cooked' };
  if (!m.recipe) return { label: 'Recipe deleted', tone: 'muted' };
  if (!m.av) return { label: 'Not marked cooked', tone: 'muted' };
  if (m.av.badge === 'untracked') return { label: 'Not tracked', tone: 'muted' };
  if (m.av.missing) return { label: `Missing ${m.av.missing}`, tone: 'missing' };
  return { label: 'Ready', tone: 'ready' };
}
