// Settings tables (6.8): add / rename / delete for places, item categories and
// subcategories, recipe categories and stores. Renames cascade everywhere the
// value is used; deletes are blocked with a plain explanation while something
// still uses it (recipe categories are simply removed from their recipes).
import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { plural } from '../format';
import { budgetFileName, usageFileName } from '../files';
import { MEASURE_UNITS, UNITS, memberSchema, type PurchaseLine } from '../schemas';

const name = z.string().trim().min(1, 'needs a name');
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------- usage counts (shared with the Settings screens) ----------
export function placeUse(ctx: Pick<Ctx, 'snap'>, place: string) {
  return ctx.snap.items.items.filter((i) => i.place === place).length;
}
export function categoryUse(ctx: Pick<Ctx, 'snap'>, cat: string, sub?: string) {
  const hit = (c: string, s: string) => c === cat && (sub === undefined || s === sub);
  const items = ctx.snap.items.items.filter((i) => hit(i.category, i.subcategory)).length;
  let lines = 0;
  for (const b of Object.values(ctx.snap.budgets))
    for (const p of b.purchases) for (const l of p.lines) if (hit(l.category, l.subcategory)) lines++;
  let usage = 0;
  for (const u of Object.values(ctx.snap.usage))
    for (const e of u.usage) if (hit(e.category, e.subcategory)) usage++;
  return { items, lines, usage };
}
export function storeUse(ctx: Pick<Ctx, 'snap'>, store: string) {
  let n = 0;
  for (const b of Object.values(ctx.snap.budgets)) for (const p of b.purchases) if (p.store === store) n++;
  return n;
}
export function recipeCategoryUse(ctx: Pick<Ctx, 'snap'>, c: string) {
  return ctx.snap.recipes.recipes.filter((r) => r.categories.includes(c)).length;
}

/** Ops that rewrite category/subcategory everywhere: items, purchase lines, usage history. */
function cascadeCategory(
  ctx: Ctx,
  match: (c: string, s: string) => boolean,
  to: { category?: string; subcategory?: string },
): Op[] {
  const ops: Op[] = [];
  for (const i of ctx.snap.items.items)
    if (match(i.category, i.subcategory)) ops.push(O.item.patch(i.id, to));
  for (const b of Object.values(ctx.snap.budgets)) {
    const f = O.budget(budgetFileName(b.year));
    for (const p of b.purchases) {
      if (!p.lines.some((l) => match(l.category, l.subcategory))) continue;
      ops.push(
        f.patchPurchase(p.id, {
          lines: p.lines.map((l): PurchaseLine => (match(l.category, l.subcategory) ? { ...l, ...to } : l)),
        }),
      );
    }
  }
  for (const u of Object.values(ctx.snap.usage)) {
    const f = O.usage(usageFileName(u.year));
    for (const e of u.usage) if (match(e.category, e.subcategory)) ops.push(f.patch(e.id, to));
  }
  return ops;
}

// ---------- storage places ----------
export const addPlace = defineAction({
  name: 'addPlace',
  input: z.object({ name }),
  plan(ctx, { name }) {
    if (ctx.snap.household.places.some((p) => same(p, name)))
      return { title: `New place ${name}`, lines: [], ops: [], blocked: 'That place already exists.' };
    return { title: `New storage place: ${name}`, lines: [], ops: [O.household.listAdd('places', name)] };
  },
});

export const renamePlace = defineAction({
  name: 'renamePlace',
  input: z.object({ from: z.string(), to: name }),
  plan(ctx, { from, to }) {
    if (from === to) return { title: 'Rename place', lines: [], ops: [], blocked: 'Type a new name.' };
    if (ctx.snap.household.places.some((p) => p !== from && same(p, to)))
      return { title: 'Rename place', lines: [], ops: [], blocked: 'That name already exists.' };
    const items = ctx.snap.items.items.filter((i) => i.place === from);
    return {
      title: `Rename ${from} to ${to}`,
      lines: items.length ? [`Updates ${plural(items.length, 'item')}`] : [],
      ops: [
        O.household.listRename('places', from, to),
        ...items.map((i) => O.item.patch(i.id, { place: to })),
      ],
    };
  },
});

export const deletePlace = defineAction({
  name: 'deletePlace',
  input: z.object({ name: z.string() }),
  plan(ctx, { name }) {
    const n = placeUse(ctx, name);
    if (n)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: `Holds ${plural(n, 'item')}. Move them to another place first.`,
      };
    if (ctx.snap.household.places.length <= 1)
      return { title: `Delete ${name}`, lines: [], ops: [], blocked: 'Keep at least one storage place.' };
    return {
      title: `Delete ${name}`,
      lines: [],
      ops: [O.household.listRemove('places', name)],
      danger: true,
    };
  },
});

export const movePlace = defineAction({
  name: 'movePlace',
  input: z.object({ name: z.string(), index: z.number().int().min(0) }),
  plan(_ctx, { name, index }) {
    return { title: `Move ${name}`, lines: [], ops: [O.household.listMove('places', name, index)] };
  },
});

// ---------- item categories ----------
export const renameCategory = defineAction({
  name: 'renameCategory',
  input: z.object({ from: z.string(), to: name }),
  plan(ctx, { from, to }) {
    if (from === to) return { title: 'Rename category', lines: [], ops: [], blocked: 'Type a new name.' };
    if (ctx.snap.household.categories.some((c) => c.name !== from && same(c.name, to)))
      return { title: 'Rename category', lines: [], ops: [], blocked: 'That category already exists.' };
    const use = categoryUse(ctx, from);
    return {
      title: `Rename ${from} to ${to}`,
      lines: [
        `Updates ${plural(use.items, 'item')}, ${plural(use.lines, 'purchase line')} and ${plural(use.usage, 'usage entry', 'usage entries')}`,
      ],
      ops: [O.household.catRename(from, to), ...cascadeCategory(ctx, (c) => c === from, { category: to })],
    };
  },
});

export const deleteCategory = defineAction({
  name: 'deleteCategory',
  input: z.object({ name: z.string() }),
  plan(ctx, { name }) {
    const use = categoryUse(ctx, name);
    if (use.items || use.lines)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: `Used by ${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. You can rename it, or move those to another category first.`,
      };
    return { title: `Delete ${name}`, lines: [], ops: [O.household.catRemove(name)], danger: true };
  },
});

export const renameSubcategory = defineAction({
  name: 'renameSubcategory',
  input: z.object({ category: z.string(), from: z.string(), to: name }),
  plan(ctx, { category, from, to }) {
    const c = ctx.snap.household.categories.find((x) => x.name === category);
    if (!c)
      return {
        title: 'Rename subcategory',
        lines: [],
        ops: [],
        blocked: `There's no category called ${category}.`,
      };
    if (from === to) return { title: 'Rename subcategory', lines: [], ops: [], blocked: 'Type a new name.' };
    if (c.subcategories.some((s) => s !== from && same(s, to)))
      return { title: 'Rename subcategory', lines: [], ops: [], blocked: 'That subcategory already exists.' };
    const use = categoryUse(ctx, category, from);
    return {
      title: `Rename ${category} › ${from} to ${to}`,
      lines: [
        `Updates ${plural(use.items, 'item')}, ${plural(use.lines, 'purchase line')} and ${plural(use.usage, 'usage entry', 'usage entries')}`,
      ],
      ops: [
        O.household.subRename(category, from, to),
        ...cascadeCategory(ctx, (cc, s) => cc === category && s === from, { subcategory: to }),
      ],
    };
  },
});

export const deleteSubcategory = defineAction({
  name: 'deleteSubcategory',
  input: z.object({ category: z.string(), name: z.string() }),
  plan(ctx, { category, name }) {
    const c = ctx.snap.household.categories.find((x) => x.name === category);
    if (!c)
      return {
        title: 'Delete subcategory',
        lines: [],
        ops: [],
        blocked: `There's no category called ${category}.`,
      };
    const use = categoryUse(ctx, category, name);
    if (use.items || use.lines)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: `Used by ${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. You can rename it, or move those first.`,
      };
    if (c.subcategories.length <= 1)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: 'A category needs at least one subcategory. Delete the category instead.',
      };
    return {
      title: `Delete ${category} › ${name}`,
      lines: [],
      ops: [O.household.subRemove(category, name)],
      danger: true,
    };
  },
});

// ---------- recipe categories ----------
export const renameRecipeCategory = defineAction({
  name: 'renameRecipeCategory',
  input: z.object({ from: z.string(), to: name }),
  plan(ctx, { from, to }) {
    if (from === to) return { title: 'Rename category', lines: [], ops: [], blocked: 'Type a new name.' };
    if (ctx.snap.household.recipeCategories.some((c) => c !== from && same(c, to)))
      return { title: 'Rename category', lines: [], ops: [], blocked: 'That category already exists.' };
    const rs = ctx.snap.recipes.recipes.filter((r) => r.categories.includes(from));
    return {
      title: `Rename ${from} to ${to}`,
      lines: rs.length ? [`Updates ${plural(rs.length, 'recipe')}`] : [],
      ops: [
        O.household.listRename('recipeCategories', from, to),
        ...rs.map((r) =>
          O.recipe.patch(r.id, { categories: [...new Set(r.categories.map((c) => (c === from ? to : c)))] }),
        ),
      ],
    };
  },
});

export const deleteRecipeCategory = defineAction({
  name: 'deleteRecipeCategory',
  input: z.object({ name: z.string() }),
  plan(ctx, { name }) {
    const rs = ctx.snap.recipes.recipes.filter((r) => r.categories.includes(name));
    return {
      title: `Delete ${name}`,
      lines: rs.length ? [`Removed from ${plural(rs.length, 'recipe')}; the recipes stay`] : [],
      ops: [
        O.household.listRemove('recipeCategories', name),
        ...rs.map((r) => O.recipe.patch(r.id, { categories: r.categories.filter((c) => c !== name) })),
      ],
      danger: true,
    };
  },
});

// ---------- stores ----------
export const addStore = defineAction({
  name: 'addStore',
  input: z.object({ name }),
  plan(ctx, { name }) {
    if (ctx.snap.household.stores.some((s) => same(s, name)))
      return { title: `New store ${name}`, lines: [], ops: [], blocked: 'That store already exists.' };
    return { title: `New store: ${name}`, lines: [], ops: [O.household.listAdd('stores', name)] };
  },
});

export const renameStore = defineAction({
  name: 'renameStore',
  input: z.object({ from: z.string(), to: name }),
  plan(ctx, { from, to }) {
    if (from === to) return { title: 'Rename store', lines: [], ops: [], blocked: 'Type a new name.' };
    // renaming to an existing store merges them
    const target = ctx.snap.household.stores.find((s) => s !== from && same(s, to)) ?? to;
    const ops: Op[] = [O.household.listRename('stores', from, target)];
    let n = 0;
    for (const b of Object.values(ctx.snap.budgets)) {
      const f = O.budget(budgetFileName(b.year));
      for (const p of b.purchases)
        if (p.store === from) {
          ops.push(f.patchPurchase(p.id, { store: target }));
          n++;
        }
    }
    const merging = target !== to || ctx.snap.household.stores.includes(to);
    return {
      title: merging ? `Merge ${from} into ${target}` : `Rename ${from} to ${to}`,
      lines: n ? [`Updates ${plural(n, 'purchase')}`] : [],
      ops,
    };
  },
});

export const deleteStore = defineAction({
  name: 'deleteStore',
  input: z.object({ name: z.string() }),
  plan(ctx, { name }) {
    const n = storeUse(ctx, name);
    if (n)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: `Has ${plural(n, 'purchase')} in your history, so it can only be renamed.`,
      };
    return {
      title: `Delete ${name}`,
      lines: [],
      ops: [O.household.listRemove('stores', name)],
      danger: true,
    };
  },
});

// ---------- household ----------
export const setMonthlyTarget = defineAction({
  name: 'setMonthlyTarget',
  input: z.object({ amount: z.number().min(0) }),
  plan(_ctx, { amount }) {
    return {
      title: `Monthly target: ${amount} lei`,
      lines: [],
      ops: [O.household.set('monthlyTarget', amount)],
    };
  },
});

export const updateMember = defineAction({
  name: 'updateMember',
  input: memberSchema,
  plan(ctx, m) {
    const list = ctx.snap.household.members;
    if (!list.some((x) => x.email === m.email))
      return { title: 'Update person', lines: [], ops: [], blocked: "That person isn't in this household." };
    return {
      title: `Update ${m.name}`,
      lines: [],
      ops: [
        O.household.set(
          'members',
          list.map((x) => (x.email === m.email ? m : x)),
        ),
      ],
    };
  },
});

// ---------- backup ----------
const ENVELOPE = new Set(['schemaVersion', 'updatedAt', 'updatedBy']);

/**
 * Replaces data with a validated backup. Each file's fields are set from the
 * backup (so it can be undone); files missing here are created.
 */
export const restoreBackup = defineAction({
  name: 'restoreBackup',
  input: z.object({ files: z.record(z.string(), z.record(z.string(), z.unknown())) }),
  plan(ctx, { files }) {
    const ops: Op[] = [];
    const lines: string[] = [];
    const current = snapshotFiles(ctx);
    for (const [name, data] of Object.entries(files)) {
      const f = name as keyof typeof current;
      const payload = Object.fromEntries(Object.entries(data).filter(([k]) => !ENVELOPE.has(k)));
      if (!current[f]) {
        ops.push({ t: 'init', file: f as never, value: data });
        lines.push(`${name}: created`);
        continue;
      }
      for (const [k, v] of Object.entries(payload))
        ops.push({ t: 'setField', file: f as never, field: k, value: v });
      lines.push(
        `${name}: ${describeCounts(current[f] as Record<string, unknown>)} → ${describeCounts(data)}`,
      );
    }
    const years = Object.keys(files)
      .filter((n) => /^(budget|usage)-\d{4}$/.test(n))
      .map((n) => Number(n.slice(-4)));
    for (const y of new Set(years))
      if (!ctx.snap.household.years.includes(y) && !('household' in files)) ops.push(O.household.addYear(y));
    return { title: 'Replace your data with the backup', lines, ops, danger: true };
  },
});

function snapshotFiles(ctx: Ctx): Record<string, unknown> {
  const out: Record<string, unknown> = {
    household: ctx.snap.household,
    items: ctx.snap.items,
    recipes: ctx.snap.recipes,
    plan: ctx.snap.plan,
    shopping: ctx.snap.shopping,
  };
  for (const b of Object.values(ctx.snap.budgets)) out[budgetFileName(b.year)] = b;
  for (const u of Object.values(ctx.snap.usage)) out[usageFileName(u.year)] = u;
  return out;
}

/** "45 items" / "6 recipes" / "14 purchases, 6 contributions" for previews. */
export function describeCounts(d: Record<string, unknown>): string {
  const n = (k: string) => (Array.isArray(d[k]) ? (d[k] as unknown[]).length : 0);
  if ('purchases' in d)
    return `${plural(n('purchases'), 'purchase')}, ${plural(n('contributions'), 'contribution')}`;
  if ('usage' in d)
    return `${plural(n('usage'), 'usage entry', 'usage entries')}, ${plural(n('cooked'), 'cooked meal')}`;
  if ('recipes' in d) return plural(n('recipes'), 'recipe');
  if ('entries' in d) return plural(n('entries'), 'planned meal');
  if ('members' in d)
    return `${plural(n('members'), 'person', 'people')}, ${plural(n('categories'), 'category', 'categories')}, ${plural(n('places'), 'place')}`;
  if ('items' in d) return plural(n('items'), 'entry', 'entries');
  return 'data';
}

/**
 * The partner's phone joins: if their email isn't a member yet, they take the
 * partner slot the creator set up (or are added when there's room).
 */
export const joinAsMember = defineAction({
  name: 'joinAsMember',
  input: z.object({
    email: z.string().min(3),
    name: z.string().trim().min(1),
    replaceEmail: z.string().optional(),
  }),
  plan(ctx, { email, name, replaceEmail }) {
    const list = ctx.snap.household.members;
    if (list.some((m) => m.email === email))
      return { title: 'Join', lines: [], ops: [], blocked: "You're already in this household." };
    let next = list;
    if (replaceEmail && list.some((m) => m.email === replaceEmail))
      next = list.map((m) => (m.email === replaceEmail ? { ...m, email } : m));
    else if (list.length < 2) next = [...list, { email, name, color: list.length ? '#E8B030' : '#1F4FA8' }];
    else return { title: 'Join', lines: [], ops: [], blocked: 'This household already has two people.' };
    return {
      title: `Join as ${next.find((m) => m.email === email)?.name ?? name}`,
      lines: [],
      ops: [O.household.set('members', next)],
    };
  },
});

// ---------- units (the household's own counting units: can, jar, pack…) ----------
/** How many records use a unit: items, shopping entries, recipe ingredients, purchase lines, usage. */
export function unitUse(ctx: Pick<Ctx, 'snap'>, unit: string) {
  const s = ctx.snap;
  let n = s.items.items.filter((i) => i.unit === unit || i.lastPrice?.per === unit).length;
  n += s.shopping.items.filter((x) => x.unit === unit).length;
  for (const r of s.recipes.recipes) n += r.ingredients.filter((g) => g.unit === unit).length;
  for (const b of Object.values(s.budgets))
    for (const p of b.purchases) n += p.lines.filter((l) => l.unit === unit).length;
  for (const u of Object.values(s.usage)) n += u.usage.filter((e) => e.unit === unit).length;
  return n;
}

const unitName = z
  .string()
  .trim()
  .min(1, 'needs a name')
  .max(20, 'is too long (20 letters at most)')
  .transform((s) => s.toLowerCase());
const RESERVED = [...UNITS, ...MEASURE_UNITS, 'piece', 'pieces', 'kilo', 'gram', 'litre', 'liter'];

function unitProblem(ctx: Ctx, n: string, except?: string): string | null {
  if (RESERVED.includes(n)) return `${n} is already one of the built-in units.`;
  if (ctx.snap.household.units.some((u) => u !== except && same(u, n)))
    return `${n} is already in your units.`;
  return null;
}

export const addUnit = defineAction({
  name: 'addUnit',
  input: z.object({ name: unitName }),
  plan(ctx, { name }) {
    const problem = unitProblem(ctx, name);
    if (problem) return { title: `New unit: ${name}`, lines: [], ops: [], blocked: problem };
    return {
      title: `New unit: ${name}`,
      lines: ['Counted one at a time, like pcs'],
      ops: [O.household.listAdd('units', name)],
    };
  },
});

export const renameUnit = defineAction({
  name: 'renameUnit',
  input: z.object({ from: z.string(), to: unitName }),
  plan(ctx, { from, to }) {
    if (from === to) return { title: 'Rename unit', lines: [], ops: [], blocked: 'Type a new name.' };
    const n = unitUse(ctx, from);
    if (n)
      return {
        title: 'Rename unit',
        lines: [],
        ops: [],
        blocked: `${from} is used ${plural(n, 'time')} in your items, lists, recipes or history, so it can't be renamed. Add a new unit instead.`,
      };
    const problem = unitProblem(ctx, to, from);
    if (problem) return { title: 'Rename unit', lines: [], ops: [], blocked: problem };
    const i = ctx.snap.household.units.indexOf(from);
    return {
      title: `Rename ${from} to ${to}`,
      lines: [],
      ops: [O.household.listRemove('units', from), O.household.listAdd('units', to, i)],
    };
  },
});

export const deleteUnit = defineAction({
  name: 'deleteUnit',
  input: z.object({ name: z.string() }),
  plan(ctx, { name }) {
    const n = unitUse(ctx, name);
    if (n)
      return {
        title: `Delete ${name}`,
        lines: [],
        ops: [],
        blocked: `${name} is used ${plural(n, 'time')} in your items, lists, recipes or history. Change those to another unit first.`,
      };
    return { title: `Delete ${name}`, lines: [], ops: [O.household.listRemove('units', name)] };
  },
});
