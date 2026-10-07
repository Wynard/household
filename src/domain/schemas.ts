import { z } from 'zod';

// ---------- primitives ----------
export const UNITS = ['g', 'kg', 'ml', 'l', 'pcs'] as const;
export const unitSchema = z.enum(UNITS);
export type Unit = z.infer<typeof unitSchema>;

export const BASE_UNITS = ['g', 'ml', 'pcs'] as const;
export const baseUnitSchema = z.enum(BASE_UNITS);
export type BaseUnit = z.infer<typeof baseUnitSchema>;

export const RECIPE_UNITS = [...UNITS, 'tsp', 'tbsp', 'cup', 'pinch', 'to taste'] as const;
export const recipeUnitSchema = z.enum(RECIPE_UNITS);
export type RecipeUnit = z.infer<typeof recipeUnitSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const isoDateTime = z.string().min(10);
const id = z.string().min(1);
const money = z.number().finite();
const qty = z.number().finite().min(0);

/** https only; anything else is dropped (security rule from 2b). */
export const httpsUrl = z.string().refine((v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Only https:// links are allowed');

// ---------- household.json ----------
export const memberSchema = z.object({
  email: z.string().min(3),
  name: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});
export type Member = z.infer<typeof memberSchema>;

export const categoryNodeSchema = z.object({
  name: z.string().min(1),
  subcategories: z.array(z.string().min(1)),
});
export const categoryTreeSchema = z.array(categoryNodeSchema);
export type CategoryNode = z.infer<typeof categoryNodeSchema>;
export type CategoryTree = z.infer<typeof categoryTreeSchema>;

export const householdPayload = z.object({
  members: z.array(memberSchema),
  monthlyTarget: z.number().min(0),
  categories: categoryTreeSchema,
  places: z.array(z.string().min(1)),
  stores: z.array(z.string().min(1)),
  recipeCategories: z.array(z.string().min(1)),
  /** Years that have a budget-YYYY.json / usage-YYYY.json file. */
  years: z.array(z.number().int()),
  /** Drive file ID of every data file, so each phone can tell "not created yet" from "not shared with me yet". */
  fileIds: z.record(z.string(), z.string()).optional(),
});

// ---------- items.json ----------
export const itemSchema = z.object({
  id,
  name: z.string().min(1),
  category: z.string(),
  /** optional second level; '' = none (many imported categories have none) */
  subcategory: z.string().default(''),
  categorySource: z.enum(['auto', 'manual']),
  place: z.string(),
  showInStock: z.boolean(),
  /** 'simple' (the default) = only have / low / out; 'amount' = exact quantity */
  tracking: z.enum(['simple', 'amount']).default('simple'),
  /** the truth for simple items; for amount items it's derived from quantity vs threshold */
  status: z.enum(['have', 'low', 'out']).default('have'),
  /** amount items only (simple items keep the defaults, which are ignored) */
  unit: unitSchema.default('pcs'),
  quantity: qty.default(0),
  /** amount items only: status becomes 'low' below this */
  lowThreshold: qty.optional(),
  /** when the item goes on the shopping list automatically */
  addToListWhen: z.enum(['low', 'out', 'never']).default('out'),
  gramsPerPiece: z.number().positive().optional(),
  aliases: z.array(z.string()),
  lastPrice: z.object({ amount: money, per: unitSchema, date: isoDate, store: z.string() }).optional(),
  archived: z.boolean().optional(),
});
export type Item = z.infer<typeof itemSchema>;
export type ItemStatus = Item['status'];
export const itemsPayload = z.object({ items: z.array(itemSchema) });

// ---------- recipes.json ----------
export const ingredientSchema = z.object({
  id,
  itemId: z.string().optional(),
  name: z.string().min(1),
  amount: z.number().positive().optional(),
  unit: recipeUnitSchema.optional(),
  optional: z.boolean().optional(),
  pantryStaple: z.boolean().optional(),
});
export type Ingredient = z.infer<typeof ingredientSchema>;

export const stepSchema = z.object({
  id,
  text: z.string().min(1),
  timerSeconds: z.number().int().positive().optional(),
  ingredientIds: z.array(z.string()).optional(),
});
export type Step = z.infer<typeof stepSchema>;

export const recipeSchema = z.object({
  id,
  title: z.string().min(1),
  servings: z.number().int().positive(),
  favourite: z.boolean(),
  categories: z.array(z.string()),
  sourceUrl: httpsUrl.optional(),
  prepMinutes: z.number().int().min(0).optional(),
  cookMinutes: z.number().int().min(0).optional(),
  ingredients: z.array(ingredientSchema),
  steps: z.array(stepSchema),
  notes: z.string().optional(),
});
export type Recipe = z.infer<typeof recipeSchema>;
export const recipesPayload = z.object({ recipes: z.array(recipeSchema) });

// ---------- plan.json ----------
export const planEntrySchema = z.object({
  id,
  date: isoDate,
  slot: z.enum(['lunch', 'dinner']),
  recipeId: z.string(),
  servings: z.number().int().positive(),
  cooked: z.boolean().optional(),
});
export type PlanEntry = z.infer<typeof planEntrySchema>;
export type Slot = PlanEntry['slot'];
export const planPayload = z.object({ entries: z.array(planEntrySchema) });

// ---------- shopping.json ----------
export const shoppingItemSchema = z.object({
  id,
  itemId: z.string().optional(),
  name: z.string().min(1),
  amount: z.number().positive().optional(),
  unit: unitSchema.optional(),
  source: z.enum(['manual', 'low-stock', 'recipe', 'plan']),
  sourceRef: z.string().optional(),
  checked: z.boolean(),
  addedBy: z.string(),
  addedAt: isoDateTime,
});
export type ShoppingItem = z.infer<typeof shoppingItemSchema>;
export const shoppingPayload = z.object({ items: z.array(shoppingItemSchema) });

// ---------- budget-YYYY.json ----------
export const contributionSchema = z.object({
  id,
  date: isoDate,
  by: z.string(),
  amount: z.number().positive(),
  note: z.string().optional(),
  createdBy: z.string().optional(),
  createdAt: isoDateTime,
  editedBy: z.string().optional(),
  editedAt: isoDateTime.optional(),
});
export type Contribution = z.infer<typeof contributionSchema>;

export const purchaseLineSchema = z.object({
  id,
  rawText: z.string().optional(),
  itemId: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().finite().positive(),
  unit: unitSchema,
  unitPrice: money.optional(),
  price: money,
  category: z.string(),
  subcategory: z.string(),
  note: z.string().optional(),
});
export type PurchaseLine = z.infer<typeof purchaseLineSchema>;

export const purchaseSchema = z.object({
  id,
  date: isoDate,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  store: z.string().min(1),
  spentBy: z.string(),
  purpose: z.string().optional(),
  lines: z.array(purchaseLineSchema),
  total: money,
  source: z.enum(['receipt', 'manual']),
  receiptFileId: z.string().optional(),
  receiptFileIds: z.array(z.string()).optional(),
  createdBy: z.string(),
  createdAt: isoDateTime,
  editedBy: z.string().optional(),
  editedAt: isoDateTime.optional(),
});
export type Purchase = z.infer<typeof purchaseSchema>;

export const potAdjustmentSchema = z.object({
  id,
  date: isoDate,
  by: z.string(),
  amount: money,
  reason: z.string().min(1),
  createdAt: isoDateTime.optional(),
});
export type PotAdjustment = z.infer<typeof potAdjustmentSchema>;

export const deletedEntrySchema = z.object({
  id,
  kind: z.enum(['contribution', 'purchase', 'adjustment']),
  by: z.string(),
  at: isoDateTime,
  snapshot: z.unknown(),
});
export type DeletedEntry = z.infer<typeof deletedEntrySchema>;

export const budgetPayload = z.object({
  year: z.number().int(),
  openingBalance: money,
  contributions: z.array(contributionSchema),
  purchases: z.array(purchaseSchema),
  adjustments: z.array(potAdjustmentSchema),
  deleted: z.array(deletedEntrySchema),
});
export type BudgetYear = z.infer<typeof budgetPayload>;

// ---------- usage-YYYY.json ----------
export const usageEntrySchema = z.object({
  id,
  date: isoDate,
  by: z.string(),
  itemId: z.string(),
  name: z.string(),
  category: z.string(),
  subcategory: z.string(),
  /** 0 for status events of simple items */
  quantity: z.number().finite().min(0),
  unit: baseUnitSchema,
  value: money,
  reason: z.enum(['cooked', 'manual-decrease', 'expired', 'other']),
  recipeId: z.string().optional(),
  /** a simple item went to Low or Out (no quantity or value) */
  status: z.enum(['low', 'out']).optional(),
});
export type UsageEntry = z.infer<typeof usageEntrySchema>;

export const cookedEntrySchema = z.object({
  id,
  date: isoDate,
  by: z.string(),
  recipeId: z.string(),
  servings: z.number().int().positive(),
});
export type CookedEntry = z.infer<typeof cookedEntrySchema>;

export const usagePayload = z.object({
  year: z.number().int(),
  usage: z.array(usageEntrySchema),
  cooked: z.array(cookedEntrySchema),
});
export type UsageYear = z.infer<typeof usagePayload>;

// ---------- file envelope ----------
export const SCHEMA_VERSION = 2;
export const envelope = z.object({
  schemaVersion: z.number().int(),
  updatedAt: isoDateTime,
  updatedBy: z.string(),
});
export type Envelope = z.infer<typeof envelope>;

export const householdFile = envelope.merge(householdPayload);
export const itemsFile = envelope.merge(itemsPayload);
export const recipesFile = envelope.merge(recipesPayload);
export const planFile = envelope.merge(planPayload);
export const shoppingFile = envelope.merge(shoppingPayload);
export const budgetFile = envelope.merge(budgetPayload);
export const usageFile = envelope.merge(usagePayload);

export type HouseholdFile = z.infer<typeof householdFile>;
export type ItemsFile = z.infer<typeof itemsFile>;
export type RecipesFile = z.infer<typeof recipesFile>;
export type PlanFile = z.infer<typeof planFile>;
export type ShoppingFile = z.infer<typeof shoppingFile>;
export type BudgetFile = z.infer<typeof budgetFile>;
export type UsageFile = z.infer<typeof usageFile>;
