import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { ingredientSchema, recipeSchema, stepSchema, type Recipe } from '../schemas';
import { linkSteps, totalMinutes } from '../recipes';
import { plural, qty as fmtQty, round3 } from '../format';
import { stockDeltaOps, findItem } from './stock';
import { ensureYearOps } from '../budget';
import { usageFileName } from '../files';
import { yearOfDate } from '../dates';

const findRecipe = (ctx: Ctx, id: string) => ctx.snap.recipes.recipes.find((r) => r.id === id);
const missingRecipe = { title: 'Recipe', lines: [], ops: [], blocked: 'This recipe was deleted.' };

export const toggleFavourite = defineAction({
  name: 'toggleFavourite',
  input: z.object({ recipeId: z.string(), favourite: z.boolean().optional() }),
  plan(ctx, { recipeId, favourite }) {
    const r = findRecipe(ctx, recipeId);
    if (!r) return missingRecipe;
    const next = favourite ?? !r.favourite;
    return {
      title: next ? `Add ${r.title} to favourites` : `Remove ${r.title} from favourites`,
      lines: [],
      ops: next === r.favourite ? [] : [O.recipe.patch(r.id, { favourite: next })],
    };
  },
});

export const setRecipeCategories = defineAction({
  name: 'setRecipeCategories',
  input: z.object({ recipeId: z.string(), categories: z.array(z.string()) }),
  plan(ctx, { recipeId, categories }) {
    const r = findRecipe(ctx, recipeId);
    if (!r) return missingRecipe;
    const known = ctx.snap.household.recipeCategories;
    const newOnes = [...new Set(categories)].filter((c) => !known.includes(c));
    return {
      title: `Categories for ${r.title}`,
      lines: [
        categories.length ? categories.join(', ') : 'No category',
        ...newOnes.map((c) => `New category: ${c}`),
      ],
      ops: [
        ...newOnes.map((c) => O.household.listAdd('recipeCategories', c)),
        O.recipe.patch(r.id, { categories: [...new Set(categories)] }),
      ],
    };
  },
});

export const addRecipeCategory = defineAction({
  name: 'addRecipeCategory',
  input: z.object({ name: z.string().trim().min(1) }),
  plan(ctx, { name }) {
    if (ctx.snap.household.recipeCategories.some((c) => c.toLowerCase() === name.toLowerCase()))
      return { title: `New category ${name}`, lines: [], ops: [], blocked: 'That category already exists.' };
    return {
      title: `New recipe category: ${name}`,
      lines: [],
      ops: [O.household.listAdd('recipeCategories', name)],
    };
  },
});

const recipeInput = recipeSchema.extend({
  id: z.string().optional(),
  ingredients: z.array(ingredientSchema).min(1, 'needs at least one ingredient'),
  steps: z.array(stepSchema).min(1, 'needs at least one written step'),
});

export const upsertRecipe = defineAction({
  name: 'upsertRecipe',
  input: recipeInput,
  plan(ctx, input) {
    // an id we don't know (e.g. an imported draft) is treated as a new recipe
    const existing = input.id ? findRecipe(ctx, input.id) : undefined;
    const known = ctx.snap.household.recipeCategories;
    const newCats = [...new Set(input.categories)].filter((c) => !known.includes(c));
    const recipe: Recipe = {
      ...input,
      id: existing?.id ?? ctx.newId(),
      title: input.title.trim(),
      categories: [...new Set(input.categories)],
      steps: linkSteps(input.steps, input.ingredients, ctx.snap.items.items),
    };
    const tracked = recipe.ingredients.filter((g) => g.itemId && !g.pantryStaple).length;
    const timers = recipe.steps.filter((s) => s.timerSeconds).length;
    const mins = totalMinutes(recipe);
    return {
      title: existing ? `Save ${recipe.title}` : `Add recipe: ${recipe.title}`,
      lines: [
        [
          recipe.categories.join(', ') || 'No category',
          mins ? `${mins} min` : '',
          `serves ${recipe.servings}`,
        ]
          .filter(Boolean)
          .join(', '),
        `${plural(recipe.ingredients.length, 'ingredient')}, ${tracked} linked to your items`,
        `${plural(recipe.steps.length, 'step')}${timers ? `, ${timers} with timers` : ''}`,
        ...newCats.map((c) => `New category: ${c}`),
      ],
      ops: [...newCats.map((c) => O.household.listAdd('recipeCategories', c)), O.recipe.upsert(recipe)],
      result: recipe.id,
    };
  },
});

export const deleteRecipe = defineAction({
  name: 'deleteRecipe',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const r = findRecipe(ctx, id);
    if (!r) return missingRecipe;
    const planned = ctx.snap.plan.entries.filter((e) => e.recipeId === id);
    return {
      title: `Delete ${r.title}`,
      lines: planned.length ? [`Also removes it from the meal plan (${plural(planned.length, 'meal')})`] : [],
      ops: [O.recipe.remove(id), ...planned.map((e) => O.plan.remove(e.id))],
      danger: true,
    };
  },
});

/**
 * Confirms a cooked meal (cooking mode or the plan): takes the (edited)
 * amounts out of stock, writes one usage entry per ingredient with
 * reason "cooked", one CookedEntry, and marks the plan entry cooked.
 */
export const cookRecipe = defineAction({
  name: 'cookRecipe',
  input: z.object({
    recipeId: z.string(),
    servings: z.number().int().positive(),
    deductions: z.array(z.object({ itemId: z.string(), amount: z.number().min(0) })),
    planEntryId: z.string().optional(),
  }),
  plan(ctx, input) {
    const r = findRecipe(ctx, input.recipeId);
    if (!r) return missingRecipe;
    const deltas = input.deductions
      .filter((d) => d.amount > 0 && findItem(ctx, d.itemId))
      .map((d) => ({ itemId: d.itemId, delta: -d.amount }));
    const stock = stockDeltaOps(ctx, deltas, { reason: 'cooked', recipeId: r.id });
    const year = yearOfDate(ctx.today);
    // the cooked log needs this year's usage file even when nothing left stock
    const ops: Op[] = [...ensureYearOps(ctx, year), ...stock.ops];
    ops.push(
      O.usage(usageFileName(year)).addCooked({
        id: ctx.newId(),
        date: ctx.today,
        by: ctx.me.email,
        recipeId: r.id,
        servings: input.servings,
      }),
    );
    const entry = input.planEntryId
      ? ctx.snap.plan.entries.find((e) => e.id === input.planEntryId)
      : undefined;
    if (entry) ops.push(O.plan.patch(entry.id, { cooked: true }));
    return {
      title: `Cooked ${r.title} for ${input.servings}`,
      lines: stock.lines.length ? stock.lines : ['Stock stays as it is'],
      ops: dedupeInit(ops),
    };
  },
});

/** Keeps the first init / addYear op per file. */
function dedupeInit(ops: Op[]): Op[] {
  const seen = new Set<string>();
  return ops.filter((o) => {
    if (o.t === 'init' || (o.t === 'listAdd' && o.field === 'years')) {
      const k = `${o.t}:${o.file}:${o.t === 'listAdd' ? String(o.value) : ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
    }
    return true;
  });
}

/** Text for one deduction line: "Flour −250 g, 750 g left". */
export function deductionLine(ctx: Ctx, itemId: string, amount: number): string {
  const it = findItem(ctx, itemId);
  if (!it) return '';
  return `${it.name} −${fmtQty(amount, it.unit)}, ${fmtQty(Math.max(0, round3(it.quantity - amount)), it.unit)} left`;
}
