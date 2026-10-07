// Recipe import (6.2): from a link (Gemini's URL context tool reads the page,
// since browsers can't fetch most recipe sites) or from pasted text. Steps are
// rewritten as short, clear, numbered actions.
import { z } from 'zod';
import { GeminiError, generate, generateJson } from './gemini';
import { untrusted } from './privacy';
import { catalogForPrompt } from './context';
import {
  RECIPE_UNITS,
  httpsUrl,
  type Ingredient,
  type Item,
  type Recipe,
  type Step,
} from '../domain/schemas';
import { detectTimerSeconds, linkSteps } from '../domain/recipes';
import { normalise } from '../domain/categorise';

export const RECIPE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    servings: { type: 'integer' },
    prepMinutes: { type: ['integer', 'null'] },
    cookMinutes: { type: ['integer', 'null'] },
    categories: { type: 'array', items: { type: 'string' }, description: 'Names from the category list' },
    newCategory: {
      type: ['string', 'null'],
      description: 'At most one new category if none in the list fits',
    },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short ingredient name, e.g. "red onion"' },
          amount: { type: ['number', 'null'] },
          unit: { type: ['string', 'null'], enum: [...RECIPE_UNITS, null] },
          itemId: {
            type: ['string', 'null'],
            description: 'Catalog ID when it is the same product, else null',
          },
          pantryStaple: { type: 'boolean', description: 'Salt, pepper, oil, water, sugar and other basics' },
          optional: { type: 'boolean' },
        },
        required: ['name', 'amount', 'unit', 'itemId', 'pantryStaple', 'optional'],
      },
    },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One action, imperative voice, with temperatures and times' },
          timerSeconds: { type: ['integer', 'null'] },
        },
        required: ['text', 'timerSeconds'],
      },
    },
    notes: { type: ['string', 'null'] },
  },
  required: [
    'title',
    'servings',
    'prepMinutes',
    'cookMinutes',
    'categories',
    'newCategory',
    'ingredients',
    'steps',
    'notes',
  ],
};

const recipeAnswer = z
  .object({
    title: z.string().min(1),
    servings: z.number().int().positive().catch(2),
    prepMinutes: z.number().int().min(0).nullable().catch(null),
    cookMinutes: z.number().int().min(0).nullable().catch(null),
    categories: z.array(z.string()).catch([]),
    newCategory: z.string().nullable().catch(null),
    ingredients: z
      .array(
        z.object({
          name: z.string().min(1),
          amount: z.number().positive().nullable().catch(null),
          unit: z.enum(RECIPE_UNITS).nullable().catch(null),
          itemId: z.string().nullable().catch(null),
          pantryStaple: z.boolean().catch(false),
          optional: z.boolean().catch(false),
        }),
      )
      .min(1),
    steps: z
      .array(
        z.object({
          text: z.string().min(1),
          timerSeconds: z.number().int().positive().nullable().catch(null),
        }),
      )
      .min(1),
    notes: z.string().nullable().catch(null),
  })
  .strip();
export type RecipeAnswer = z.infer<typeof recipeAnswer>;

const PROMPT = (
  categories: string[],
) => `You turn recipes into clean, structured recipes for a two-person household in Romania (metric units, Romanian or English sources).
- Convert amounts to metric where possible: g, kg, ml, l or pcs. Keep tsp, tbsp, cup, pinch or "to taste" for small amounts. 1 cup of liquid = 240 ml.
- Ingredient names are short and lower case, e.g. "red onion", "telemea".
- Mark salt, pepper, cooking oil, water, sugar and dried spices as pantryStaple.
- Rewrite the method as short numbered steps: one action per step, imperative voice ("Chop the onion."), with temperatures and times written in the step. Put a step's waiting or cooking time in timerSeconds.
- Choose categories only from this list: ${categories.join(', ') || '(none yet)'}. If none fits, suggest one newCategory, else null.
- Set itemId only when the ingredient is clearly a product in the catalog; otherwise null.
- Keep the source's language for the title if it's a well-known dish name (e.g. "Ciorbă de perișoare"), but write steps and ingredients in English.`;

function request(source: { url?: string; text?: string }, items: Item[], categories: string[]) {
  return {
    systemInstruction: PROMPT(categories),
    contents: [
      {
        role: 'user' as const,
        parts: [
          {
            text: [
              source.url
                ? `Read the recipe at this address (use the URL context tool): ${source.url}`
                : 'Here is a recipe someone pasted:',
              source.text ? untrusted('pasted recipe text', source.text.slice(0, 30000)) : '',
              untrusted('item catalog (id | name | known spellings | unit)', catalogForPrompt(items)),
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
      },
    ],
  };
}

export async function importRecipe(
  source: { url?: string; text?: string },
  items: Item[],
  categories: string[],
  signal?: AbortSignal,
): Promise<RecipeAnswer> {
  if (source.url && !httpsUrl.safeParse(source.url).success)
    throw new GeminiError('other', 'Only https:// links can be imported.');
  if (!source.url)
    return generateJson(request(source, items, categories), RECIPE_JSON_SCHEMA, recipeAnswer, { signal });
  const req = {
    ...request(source, items, categories),
    tools: [{ url_context: {} as Record<string, never> }],
  };
  try {
    // URL context + response schema in one call (supported by current models)
    return await generateJson(req, RECIPE_JSON_SCHEMA, recipeAnswer, { signal });
  } catch (e) {
    if (!(e instanceof GeminiError) || e.kind !== 'other') throw e;
    // the model refused tools + schema together: read the page first, then structure it
    const page = await generate(
      {
        tools: req.tools,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Copy out the full recipe at ${source.url}: title, servings, times, every ingredient with its amount, and every method step. Plain text only.`,
              },
            ],
          },
        ],
      },
      { signal },
    );
    if (!page.text.trim())
      throw new GeminiError('other', "Couldn't read that page. Paste the recipe text instead.");
    return generateJson(request({ text: page.text }, items, categories), RECIPE_JSON_SCHEMA, recipeAnswer, {
      signal,
    });
  }
}

/** Turns Gemini's answer into a recipe draft for the review screen. */
export function answerToRecipe(
  a: RecipeAnswer,
  items: Item[],
  knownCategories: string[],
  sourceUrl?: string,
): Partial<Recipe> & { newCategory?: string } {
  const ids = new Set(items.map((i) => i.id));
  const known = new Map(knownCategories.map((c) => [normalise(c), c]));
  const ingredients: Ingredient[] = a.ingredients.map((g) => ({
    id: crypto.randomUUID(),
    name: g.name.trim(),
    ...(g.itemId && ids.has(g.itemId) && !g.pantryStaple ? { itemId: g.itemId } : {}),
    ...(g.amount ? { amount: g.amount } : {}),
    ...(g.unit ? { unit: g.unit } : {}),
    ...(g.pantryStaple ? { pantryStaple: true } : {}),
    ...(g.optional ? { optional: true } : {}),
  }));
  const steps: Step[] = a.steps.map((s) => ({
    id: crypto.randomUUID(),
    text: s.text.trim(),
    ...((s.timerSeconds ?? detectTimerSeconds(s.text))
      ? { timerSeconds: s.timerSeconds ?? detectTimerSeconds(s.text) }
      : {}),
  }));
  const categories = [
    ...new Set(a.categories.map((c) => known.get(normalise(c))).filter((c): c is string => !!c)),
  ];
  const newCategory =
    a.newCategory && !known.has(normalise(a.newCategory)) ? a.newCategory.trim() : undefined;
  return {
    title: a.title.trim(),
    servings: a.servings,
    favourite: false,
    categories,
    ...(a.prepMinutes ? { prepMinutes: a.prepMinutes } : {}),
    ...(a.cookMinutes ? { cookMinutes: a.cookMinutes } : {}),
    ...(sourceUrl && httpsUrl.safeParse(sourceUrl).success ? { sourceUrl } : {}),
    ...(a.notes ? { notes: a.notes } : {}),
    ingredients,
    steps: linkSteps(steps, ingredients, items),
    ...(newCategory ? { newCategory } : {}),
  };
}
