// Assistant tools (6.10). Read tools run immediately and return compact JSON.
// Proposal tools only build a preview card and answer "shown to the user,
// awaiting approval"; there is no tool that writes or sends data anywhere.
import type { Ctx } from '../../domain/actions';
import type { FunctionDeclaration } from '../gemini';
import type { Pseudonymiser } from '../privacy';
import { makeCard, type Card, type CardStep } from './cards';
import { stockStatus } from '../../domain/stock';
import { availability, badgeLabel, totalMinutes } from '../../domain/recipes';
import { categorise, findKnownItem, normalise } from '../../domain/categorise';
import { monthSummary, potBalance } from '../../domain/budget';
import { spendingInsights, usageInsights } from '../../domain/insights';
import { planAvailability, mealStatus, shortfall } from '../../domain/plan';
import { currentMonth, weekDates, weekStart } from '../../domain/dates';
import { qty as fmtQty } from '../../domain/format';
import { NON_FOOD_CATEGORIES } from '../../domain/defaults';
import type { Item, Recipe, RecipeUnit, Unit } from '../../domain/schemas';
import { answerToRecipe, type RecipeAnswer } from '../recipe';
import { insightsLink } from '../../features/insights/InsightsScreen';

export interface Link {
  label: string;
  to: string;
}
export interface ToolEnv {
  ctx: Ctx;
  pseudo: Pseudonymiser;
}
export interface ToolResult {
  response: Record<string, unknown>;
  card?: Card;
  link?: Link;
}

const S = (props: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties: props,
  required,
});
const str = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
const numb = (description?: string) => ({ type: 'number', ...(description ? { description } : {}) });
const arr = (items: unknown, description?: string) => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
});
const UNIT = { type: 'string', enum: ['g', 'kg', 'ml', 'l', 'pcs'] };
const MONTH = str('YYYY-MM; default this month');
const PERSON = str('"Person A" or "Person B"');

export const READ_TOOLS: FunctionDeclaration[] = [
  {
    name: 'getStock',
    description:
      'Items at home with place, category and status (have, low, out). Simple items only have a status; amount items also have quantity and unit.',
    parameters: S({
      filter: { type: 'string', enum: ['all', 'low', 'out'] },
      place: str(),
      category: str(),
      query: str('name search'),
    }),
  },
  {
    name: 'searchItems',
    description:
      'Find catalog items (including hidden ones) by name or receipt spelling. Use before proposing changes to items.',
    parameters: S({ query: str() }, ['query']),
  },
  {
    name: 'getRecipes',
    description:
      'Recipes with time, servings, categories, favourite flag and whether they can be cooked from current stock.',
    parameters: S({
      query: str(),
      category: str(),
      favouritesOnly: { type: 'boolean' },
      maxMinutes: numb(),
      readyOnly: { type: 'boolean' },
    }),
  },
  {
    name: 'checkRecipeAvailability',
    description: 'Per-ingredient stock check of one recipe for a number of servings.',
    parameters: S({ recipeId: str(), servings: numb() }, ['recipeId']),
  },
  {
    name: 'getPlan',
    description: 'Meal plan for a week (Monday start), with availability computed cumulatively.',
    parameters: S({ weekStart: str('YYYY-MM-DD Monday; default this week') }),
  },
  {
    name: 'getShoppingList',
    description: 'Open shopping list entries and what is already in the cart.',
    parameters: S({}),
  },
  {
    name: 'getSpending',
    description:
      'Spending for a month with filters: total, change vs previous month, by category (or subcategory/item when filtered), by store, by person, top items.',
    parameters: S({ month: MONTH, person: PERSON, category: str(), subcategory: str(), store: str() }),
  },
  {
    name: 'getUsage',
    description: 'What was used (consumed) in a month: value, most used items, meals cooked, bought vs used.',
    parameters: S({ month: MONTH, person: PERSON, category: str(), subcategory: str() }),
  },
  {
    name: 'getBudget',
    description: 'Shared pot balance and a month summary: put in and spent per person, target progress.',
    parameters: S({ month: MONTH }),
  },
  { name: 'getCategories', description: 'Item category tree and recipe categories.', parameters: S({}) },
  { name: 'getPlaces', description: 'Storage places at home.', parameters: S({}) },
  { name: 'getStores', description: 'Stores used before.', parameters: S({}) },
];

const LINE = S(
  {
    name: str(),
    quantity: numb(),
    unit: UNIT,
    price: numb('line total in lei'),
    itemId: str('catalog id if known'),
    category: str(),
    subcategory: str(),
    addToStock: { type: 'boolean' },
  },
  ['name', 'quantity', 'unit', 'price'],
);

export const PROPOSAL_TOOLS: FunctionDeclaration[] = [
  {
    name: 'proposePurchase',
    description:
      'Prepare a purchase paid from the shared pot (shown as a card; nothing is saved until the user taps Apply).',
    parameters: S(
      {
        store: str('leave empty if the user did not say'),
        date: str('YYYY-MM-DD, default today'),
        spentBy: PERSON,
        purpose: str(),
        lines: arr(LINE),
      },
      ['lines'],
    ),
  },
  {
    name: 'proposeContribution',
    description: 'Prepare money put into the shared pot.',
    parameters: S({ amount: numb(), by: PERSON, date: str(), note: str() }, ['amount']),
  },
  {
    name: 'proposeStockChange',
    description:
      'Prepare stock changes. Simple items (tracking "simple"): give status have, low or out. Amount items: set a quantity or add/remove an amount (in the item unit), or status out to empty it.',
    parameters: S(
      {
        changes: arr(
          S(
            {
              itemId: str(),
              status: { type: 'string', enum: ['have', 'low', 'out'] },
              set: numb(),
              delta: numb(),
            },
            ['itemId'],
          ),
        ),
      },
      ['changes'],
    ),
  },
  {
    name: 'proposeShoppingAdd',
    description: 'Prepare adding things to the shopping list.',
    parameters: S({ entries: arr(S({ itemId: str(), name: str(), amount: numb(), unit: UNIT }, ['name'])) }, [
      'entries',
    ]),
  },
  {
    name: 'proposePlan',
    description: 'Prepare meal plan entries (replaces whatever is planned in that slot).',
    parameters: S(
      {
        entries: arr(
          S(
            {
              date: str('YYYY-MM-DD'),
              slot: { type: 'string', enum: ['lunch', 'dinner'] },
              recipeId: str(),
              servings: numb(),
            },
            ['date', 'slot', 'recipeId'],
          ),
        ),
      },
      ['entries'],
    ),
  },
  {
    name: 'proposeMoveItems',
    description: 'Prepare moving items to another storage place.',
    parameters: S({ itemIds: arr(str()), place: str() }, ['itemIds', 'place']),
  },
  {
    name: 'proposeCategoryChange',
    description: "Prepare changing an item's category.",
    parameters: S({ itemId: str(), category: str(), subcategory: str() }, [
      'itemId',
      'category',
      'subcategory',
    ]),
  },
  {
    name: 'proposeMergeItems',
    description: 'Prepare merging duplicate items into one.',
    parameters: S({ keepId: str(), mergeIds: arr(str()) }, ['keepId', 'mergeIds']),
  },
  {
    name: 'proposeRename',
    description:
      'Prepare renaming a storage place, store, item category, subcategory or recipe category (cascades everywhere).',
    parameters: S(
      {
        kind: { type: 'string', enum: ['place', 'store', 'category', 'subcategory', 'recipeCategory'] },
        from: str(),
        to: str(),
        category: str('parent category, for subcategories'),
      },
      ['kind', 'from', 'to'],
    ),
  },
  {
    name: 'proposeDelete',
    description: 'Prepare deleting something. Shown with a red border and needs two taps.',
    parameters: S(
      {
        kind: {
          type: 'string',
          enum: ['item', 'recipe', 'purchase', 'contribution', 'shoppingEntry', 'planEntry'],
        },
        id: str(),
      },
      ['kind', 'id'],
    ),
  },
  {
    name: 'proposeRecipe',
    description: 'Prepare a new recipe the user described. Steps are short imperative actions.',
    parameters: S(
      {
        title: str(),
        servings: numb(),
        minutes: numb(),
        categories: arr(str()),
        ingredients: arr(
          S(
            {
              name: str(),
              amount: numb(),
              unit: {
                type: 'string',
                enum: ['g', 'kg', 'ml', 'l', 'pcs', 'tsp', 'tbsp', 'cup', 'pinch', 'to taste'],
              },
              itemId: str(),
              pantryStaple: { type: 'boolean' },
            },
            ['name'],
          ),
        ),
        steps: arr(S({ text: str(), timerMinutes: numb() }, ['text'])),
      },
      ['title', 'servings', 'ingredients', 'steps'],
    ),
  },
  {
    name: 'openScreen',
    description:
      'Offer a button that opens a screen (e.g. a recipe, the week plan, or Insights with filters).',
    parameters: S(
      {
        screen: {
          type: 'string',
          enum: ['stock', 'recipes', 'recipe', 'plan', 'shopping', 'budget', 'insights', 'settings'],
        },
        label: str('button text, e.g. "Open Tomato pasta"'),
        recipeId: str(),
        month: str(),
        category: str(),
        subcategory: str(),
        store: str(),
        person: PERSON,
        view: { type: 'string', enum: ['spend', 'use'] },
      },
      ['screen', 'label'],
    ),
  },
];

export const ALL_TOOLS = [...READ_TOOLS, ...PROPOSAL_TOOLS];
const AWAITING = { result: 'Shown to the user as a card, awaiting their approval. Nothing has changed yet.' };

const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function itemRow(i: Item) {
  return {
    id: i.id,
    name: i.name,
    tracking: i.tracking,
    ...(i.tracking === 'amount' ? { quantity: i.quantity, unit: i.unit } : {}),
    place: i.place,
    category: i.category,
    subcategory: i.subcategory,
    status: stockStatus(i),
    shownInStock: i.showInStock,
  };
}

function findItemLoose(ctx: Ctx, idOrName?: string): Item | undefined {
  if (!idOrName) return undefined;
  return ctx.snap.items.items.find((i) => i.id === idOrName) ?? findKnownItem(idOrName, ctx.snap.items.items);
}

/** Runs one tool call. */
export function runTool(name: string, args: Record<string, unknown>, env: ToolEnv): ToolResult {
  const { ctx, pseudo } = env;
  const snap = ctx.snap;
  const person = (v: unknown) => (s(v) ? pseudo.emailFor(s(v)!) : undefined);
  const budgets = Object.values(snap.budgets);
  switch (name) {
    // ---------- read ----------
    case 'getStock': {
      const q = normalise(s(args.query) ?? '');
      const list = snap.items.items
        .filter((i) => i.showInStock && !i.archived)
        .filter((i) => !args.filter || args.filter === 'all' || stockStatus(i) === args.filter)
        .filter((i) => !args.place || i.place === args.place)
        .filter((i) => !args.category || i.category === args.category)
        .filter((i) => !q || normalise(`${i.name} ${i.aliases.join(' ')}`).includes(q));
      return { response: { count: list.length, items: list.slice(0, 40).map(itemRow) } };
    }
    case 'searchItems': {
      const q = normalise(s(args.query) ?? '');
      const words = q.split(' ').filter(Boolean);
      const list = snap.items.items
        .map((i) => ({
          i,
          score: words.filter((w) =>
            normalise(`${i.name} ${i.aliases.join(' ')} ${i.subcategory}`).includes(w),
          ).length,
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 20)
        .map((x) => itemRow(x.i));
      return { response: { items: list } };
    }
    case 'getRecipes': {
      const items = new Map(snap.items.items.map((i) => [i.id, i]));
      const q = normalise(s(args.query) ?? '');
      const list = snap.recipes.recipes
        .filter(
          (r) => !q || normalise(`${r.title} ${r.ingredients.map((g) => g.name).join(' ')}`).includes(q),
        )
        .filter((r) => !args.category || r.categories.includes(String(args.category)))
        .filter((r) => !args.favouritesOnly || r.favourite)
        .filter((r) => !n(args.maxMinutes) || (totalMinutes(r) || 0) <= n(args.maxMinutes)!)
        .map((r) => {
          const av = availability(r, r.servings, items);
          return {
            id: r.id,
            title: r.title,
            minutes: totalMinutes(r) || null,
            servings: r.servings,
            categories: r.categories,
            favourite: r.favourite,
            availability: badgeLabel(av),
            missing: av.missing,
          };
        })
        .filter((r) => !args.readyOnly || r.missing === 0);
      return { response: { recipes: list.slice(0, 30) } };
    }
    case 'checkRecipeAvailability': {
      const r = snap.recipes.recipes.find((x) => x.id === args.recipeId);
      if (!r) return { response: { error: 'No recipe with that id.' } };
      const av = availability(r, n(args.servings) ?? r.servings, snap.items.items);
      return {
        response: {
          title: r.title,
          servings: n(args.servings) ?? r.servings,
          ingredients: av.rows.map((x) => ({
            name: x.ingredient.name,
            itemId: x.item?.id,
            status: x.status,
            short: x.short ? fmtQty(x.short, x.item!.unit) : undefined,
          })),
        },
      };
    }
    case 'getPlan': {
      const mon = weekStart(s(args.weekStart) ?? ctx.today);
      const days = weekDates(mon);
      const meals = planAvailability(snap.plan.entries, snap.recipes.recipes, snap.items.items, ctx.today);
      const inWeek = [...meals.values()].filter((m) => m.entry.date >= mon && m.entry.date <= days[6]);
      const short = shortfall(inWeek);
      return {
        response: {
          weekStart: mon,
          today: ctx.today,
          entries: inWeek.map((m) => ({
            id: m.entry.id,
            date: m.entry.date,
            slot: m.entry.slot,
            recipe: m.recipe?.title,
            recipeId: m.entry.recipeId,
            servings: m.entry.servings,
            status: mealStatus(m).label,
          })),
          freeSlots: days.flatMap((d) =>
            (['lunch', 'dinner'] as const)
              .filter((sl) => !snap.plan.entries.some((e) => e.date === d && e.slot === sl))
              .map((sl) => `${d} ${sl}`),
          ),
          missingForWeek: [...short].map(([id, q]) => {
            const it = snap.items.items.find((i) => i.id === id)!;
            return { itemId: id, name: it.name, amount: q, unit: it.unit };
          }),
        },
      };
    }
    case 'getShoppingList':
      return {
        response: {
          toBuy: snap.shopping.items
            .filter((x) => !x.checked)
            .map((x) => ({
              id: x.id,
              name: x.name,
              itemId: x.itemId,
              amount: x.amount,
              unit: x.unit,
              source: x.source,
            })),
          inCart: snap.shopping.items.filter((x) => x.checked).map((x) => x.name),
        },
      };
    case 'getSpending': {
      const ym = s(args.month) ?? currentMonth();
      const f = {
        person: person(args.person),
        category: s(args.category),
        subcategory: s(args.subcategory),
        store: s(args.store),
      };
      const sp = spendingInsights(budgets, ym, f);
      return {
        response: {
          month: ym,
          total: sp.total,
          previousMonthTotal: sp.comparison.prevTotal,
          changePct: sp.comparison.pct,
          direction: sp.comparison.direction,
          breakdownLevel: sp.level,
          breakdown: sp.byDrill.slice(0, 12).map((b) => ({ name: b.key, lei: b.value })),
          byStore: sp.byStore.slice(0, 8).map((b) => ({ store: b.key, lei: b.value })),
          byPerson: sp.byPerson.map((b) => ({ person: pseudo.label(b.key), lei: b.value })),
          topItems: sp.topItems.slice(0, 6).map((t) => ({ name: t.name, lei: t.value })),
          moneyIn: sp.moneyIn,
        },
      };
    }
    case 'getUsage': {
      const ym = s(args.month) ?? currentMonth();
      const u = usageInsights(
        Object.values(snap.usage),
        budgets,
        ym,
        {
          person: person(args.person),
          category: s(args.category),
          subcategory: s(args.subcategory),
        },
        new Set(snap.items.items.filter((i) => i.tracking === 'simple').map((i) => i.id)),
      );
      return {
        response: {
          month: ym,
          valueUsed: u.totalValue,
          mealsCooked: u.meals,
          mostUsed: u.mostUsed
            .slice(0, 8)
            .map((x) => ({ name: x.name, used: fmtQty(x.quantity, x.unit), lei: x.value })),
          mostCooked: u.mostCooked.map((c) => ({
            recipe: snap.recipes.recipes.find((r) => r.id === c.recipeId)?.title,
            times: c.times,
          })),
          boughtNotUsed: u.boughtVsUsed
            .slice(0, 5)
            .map((x) => ({ name: x.name, bought: fmtQty(x.bought, x.unit), used: fmtQty(x.used, x.unit) })),
          ranOutOf: u.ranOutOf.slice(0, 8).map((x) => ({ name: x.name, times: x.times, last: x.last })),
        },
      };
    }
    case 'getBudget': {
      const ym = s(args.month) ?? currentMonth();
      const sum = monthSummary(
        budgets,
        ym,
        snap.household.monthlyTarget,
        snap.household.members.map((m) => m.email),
      );
      return {
        response: {
          potBalance: potBalance(budgets),
          month: ym,
          spent: sum.spent,
          contributed: sum.contributed,
          monthlyTarget: sum.target,
          perPerson: Object.entries(sum.byPerson).map(([e, v]) => ({
            person: pseudo.label(e),
            putIn: v.in,
            spent: v.out,
          })),
        },
      };
    }
    case 'getCategories':
      return {
        response: {
          itemCategories: snap.household.categories,
          recipeCategories: snap.household.recipeCategories,
        },
      };
    case 'getPlaces':
      return { response: { places: snap.household.places } };
    case 'getStores':
      return { response: { stores: snap.household.stores } };

    // ---------- proposals ----------
    case 'proposePurchase': {
      const lines = (Array.isArray(args.lines) ? args.lines : []) as Record<string, unknown>[];
      const store = (s(args.store) ?? '').trim();
      const tree = snap.household.categories;
      const input = {
        store,
        date:
          s(args.date) && /^\d{4}-\d{2}-\d{2}$/.test(s(args.date)!) && s(args.date)! <= ctx.today
            ? s(args.date)!
            : ctx.today,
        spentBy: person(args.spentBy) ?? ctx.me.email,
        ...(s(args.purpose) ? { purpose: s(args.purpose) } : {}),
        lines: lines.map((l) => {
          const name = s(l.name) ?? 'Item';
          const it = findItemLoose(ctx, s(l.itemId)) ?? findKnownItem(name, snap.items.items);
          const inTree = (c?: string, sub?: string) =>
            !!c && tree.some((x) => x.name === c && x.subcategories.includes(sub ?? ''));
          const guess = it
            ? { category: it.category, subcategory: it.subcategory }
            : inTree(s(l.category), s(l.subcategory))
              ? { category: s(l.category)!, subcategory: s(l.subcategory)! }
              : categorise(name, snap.items.items, tree);
          return {
            ...(it ? { itemId: it.id } : {}),
            name: it?.name ?? name,
            quantity: n(l.quantity) && n(l.quantity)! > 0 ? n(l.quantity)! : 1,
            unit: (['g', 'kg', 'ml', 'l', 'pcs'].includes(String(l.unit)) ? l.unit : 'pcs') as Unit,
            price: n(l.price) ?? 0,
            category: guess?.category ?? '',
            subcategory: guess?.subcategory ?? '',
            toStock:
              typeof l.addToStock === 'boolean'
                ? l.addToStock
                : !!it && it.showInStock && !NON_FOOD_CATEGORIES.includes(it.category),
          };
        }),
      };
      const missingCat = input.lines.find((l) => !l.category);
      const card = makeCard(ctx, [{ action: 'addPurchase', input }], {
        edit: 'purchase',
        ...(!store
          ? { blocked: "I didn't catch the store, tap Edit to add it" }
          : missingCat
            ? { blocked: `I don't know the category of ${missingCat.name}, tap Edit to pick it` }
            : {}),
      });
      return { response: { ...AWAITING, preview: card.lines }, card };
    }
    case 'proposeContribution': {
      const card = makeCard(
        ctx,
        [
          {
            action: 'addContribution',
            input: {
              date: s(args.date) ?? ctx.today,
              by: person(args.by) ?? ctx.me.email,
              amount: n(args.amount) ?? 0,
              note: s(args.note),
            },
          },
        ],
        { edit: 'contribution' },
      );
      return { response: AWAITING, card };
    }
    case 'proposeStockChange': {
      const changes = (Array.isArray(args.changes) ? args.changes : []) as Record<string, unknown>[];
      const steps: CardStep[] = changes.map((c) => {
        const it = findItemLoose(ctx, s(c.itemId));
        const status = s(c.status);
        if (status === 'have' || status === 'low' || status === 'out')
          return { action: 'setItemStatus', input: { itemId: it?.id ?? s(c.itemId) ?? '', status } };
        return {
          action: 'adjustStock',
          input: {
            itemId: it?.id ?? s(c.itemId) ?? '',
            ...(n(c.set) !== undefined ? { set: n(c.set) } : { delta: n(c.delta) ?? 0 }),
          },
        };
      });
      const card = makeCard(
        ctx,
        steps,
        steps.length > 1 ? { title: `Update stock for ${steps.length} items` } : {},
      );
      return { response: AWAITING, card };
    }
    case 'proposeShoppingAdd': {
      const entries = ((Array.isArray(args.entries) ? args.entries : []) as Record<string, unknown>[]).map(
        (e) => {
          const it = findItemLoose(ctx, s(e.itemId) ?? s(e.name));
          return {
            ...(it ? { itemId: it.id } : {}),
            name: it?.name ?? s(e.name) ?? 'Item',
            ...(n(e.amount) ? { amount: n(e.amount), unit: (e.unit as Unit) ?? it?.unit } : {}),
          };
        },
      );
      const card = makeCard(ctx, [{ action: 'addToShoppingList', input: { entries, source: 'manual' } }]);
      return { response: AWAITING, card };
    }
    case 'proposePlan': {
      const entries = ((Array.isArray(args.entries) ? args.entries : []) as Record<string, unknown>[]).map(
        (e) => {
          const r = snap.recipes.recipes.find((x) => x.id === e.recipeId);
          return {
            date: s(e.date) ?? ctx.today,
            slot: e.slot === 'lunch' ? 'lunch' : 'dinner',
            recipeId: s(e.recipeId) ?? '',
            servings: Math.max(1, Math.round(n(e.servings) ?? r?.servings ?? 2)),
          };
        },
      );
      const card = makeCard(ctx, [{ action: 'setPlanEntries', input: { entries } }]);
      return { response: AWAITING, card, link: { label: 'Open the week plan', to: '/recipes?view=plan' } };
    }
    case 'proposeMoveItems': {
      const ids = ((Array.isArray(args.itemIds) ? args.itemIds : []) as string[]).map(
        (x) => findItemLoose(ctx, x)?.id ?? x,
      );
      return {
        response: AWAITING,
        card: makeCard(ctx, [{ action: 'moveItems', input: { itemIds: ids, place: s(args.place) ?? '' } }]),
      };
    }
    case 'proposeCategoryChange': {
      const it = findItemLoose(ctx, s(args.itemId));
      if (!it) return { response: { error: 'No item with that id. Use searchItems first.' } };
      const card = makeCard(
        ctx,
        [
          {
            action: 'upsertItem',
            input: {
              ...it,
              category: s(args.category),
              subcategory: s(args.subcategory),
              categorySource: 'manual',
            },
          },
        ],
        { edit: 'item' },
      );
      return { response: AWAITING, card };
    }
    case 'proposeMergeItems':
      return {
        response: AWAITING,
        card: makeCard(ctx, [
          { action: 'mergeItems', input: { keepId: s(args.keepId), mergeIds: args.mergeIds } },
        ]),
      };
    case 'proposeRename': {
      const kind = s(args.kind);
      const action =
        kind === 'place'
          ? 'renamePlace'
          : kind === 'store'
            ? 'renameStore'
            : kind === 'category'
              ? 'renameCategory'
              : kind === 'subcategory'
                ? 'renameSubcategory'
                : 'renameRecipeCategory';
      const input =
        kind === 'subcategory'
          ? { category: s(args.category), from: s(args.from), to: s(args.to) }
          : { from: s(args.from), to: s(args.to) };
      return { response: AWAITING, card: makeCard(ctx, [{ action, input }]) };
    }
    case 'proposeDelete': {
      const kind = s(args.kind);
      const id = s(args.id) ?? '';
      const step: CardStep =
        kind === 'item'
          ? { action: 'deleteItem', input: { id: findItemLoose(ctx, id)?.id ?? id } }
          : kind === 'recipe'
            ? { action: 'deleteRecipe', input: { id } }
            : kind === 'purchase'
              ? { action: 'deletePurchase', input: { id } }
              : kind === 'contribution'
                ? { action: 'deleteContribution', input: { id } }
                : kind === 'planEntry'
                  ? { action: 'removePlanEntry', input: { id } }
                  : { action: 'removeShoppingItems', input: { ids: [id] } };
      const card = makeCard(ctx, [step]);
      return { response: AWAITING, card: { ...card, danger: true } };
    }
    case 'proposeRecipe': {
      const a = args as Record<string, unknown>;
      const ans: RecipeAnswer = {
        title: s(a.title) ?? 'New recipe',
        servings: Math.max(1, Math.round(n(a.servings) ?? 2)),
        prepMinutes: null,
        cookMinutes: n(a.minutes) ? Math.round(n(a.minutes)!) : null,
        categories: (Array.isArray(a.categories) ? a.categories : []) as string[],
        newCategory: null,
        notes: null,
        ingredients: ((Array.isArray(a.ingredients) ? a.ingredients : []) as Record<string, unknown>[]).map(
          (g) => ({
            name: s(g.name) ?? 'ingredient',
            amount: n(g.amount) ?? null,
            unit: (s(g.unit) as RecipeUnit) ?? null,
            itemId: findItemLoose(ctx, s(g.itemId) ?? s(g.name))?.id ?? null,
            pantryStaple: !!g.pantryStaple,
            optional: false,
          }),
        ),
        steps: ((Array.isArray(a.steps) ? a.steps : []) as Record<string, unknown>[]).map((x) => ({
          text: s(x.text) ?? '',
          timerSeconds: n(x.timerMinutes) ? Math.round(n(x.timerMinutes)! * 60) : null,
        })),
      };
      const draft = answerToRecipe(ans, snap.items.items, snap.household.recipeCategories);
      const card = recipeCard(ctx, draft);
      return { response: AWAITING, card };
    }
    case 'openScreen': {
      const label = s(args.label) ?? 'Open';
      const scr = s(args.screen);
      const to =
        scr === 'recipe' && s(args.recipeId)
          ? `/recipes/${encodeURIComponent(s(args.recipeId)!)}`
          : scr === 'plan'
            ? '/recipes?view=plan'
            : scr === 'insights'
              ? insightsLink({
                  ym: s(args.month),
                  view: args.view === 'use' ? 'use' : 'spend',
                  person: person(args.person),
                  category: s(args.category),
                  subcategory: s(args.subcategory),
                  store: s(args.store),
                })
              : `/${scr === 'shopping' ? 'shopping' : (scr ?? 'stock')}`;
      return { response: { result: 'A button was shown.' }, link: { label, to } };
    }
  }
  return { response: { error: `Unknown tool ${name}` } };
}

/** A recipe card (used by proposeRecipe and the link/text importer). */
export function recipeCard(ctx: Ctx, draft: ReturnType<typeof answerToRecipe>, intro?: string): Card {
  const { newCategory, ...recipe } = draft;
  const input = {
    ...recipe,
    categories: [...(recipe.categories ?? []), ...(newCategory ? [newCategory] : [])],
  };
  const card = makeCard(ctx, [{ action: 'upsertRecipe', input }], { kind: 'recipe', edit: 'recipe' });
  const items = new Map(ctx.snap.items.items.map((i) => [i.id, i]));
  const tracked = (recipe.ingredients ?? []).filter((g) => g.itemId && !g.pantryStaple);
  const staples = (recipe.ingredients ?? []).filter((g) => g.pantryStaple);
  const loose = (recipe.ingredients ?? []).filter((g) => !g.itemId && !g.pantryStaple);
  const timers = (recipe.steps ?? []).filter((x) => x.timerSeconds).length;
  const av = availability(
    {
      ...(input as unknown as Recipe),
      id: 'preview',
      ingredients: recipe.ingredients ?? [],
      servings: recipe.servings ?? 2,
    },
    recipe.servings ?? 2,
    items,
  );
  const mins = (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);
  return {
    ...card,
    lines: [
      [input.categories.join(', ') || 'No category', mins ? `${mins} min` : '', `serves ${recipe.servings}`]
        .filter(Boolean)
        .join(', '),
      `${tracked.length} ingredients matched to your items${tracked.length ? `: ${tracked.map((g) => g.name).join(', ')}` : ''}`,
      ...(staples.length
        ? [`${staples.length} added as staples: ${staples.map((g) => g.name).join('; ')}`]
        : []),
      ...(loose.length ? [`${loose.length} not tracked: ${loose.map((g) => g.name).join(', ')}`] : []),
      `${recipe.steps?.length ?? 0} steps, ${timers} with timers`,
      av.tracked === 0
        ? 'Nothing tracked in stock'
        : av.missing
          ? `You'd need ${av.missing} more things to cook it now`
          : 'You have everything tracked to cook it now',
      ...(newCategory ? [`New category: ${newCategory}`] : []),
    ],
    note: intro,
  };
}
