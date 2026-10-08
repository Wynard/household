import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { lowStockSync, statusForQuantity, stockStatus } from '../stock';
import { catLabel, plural, qty as fmtQty, round3 } from '../format';
import { convert } from '../units';
import { unitSchema, type Item } from '../schemas';
import { budgetFileName, usageFileName } from '../files';
import { findItem, statusLabel } from './stock';

const itemInput = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'needs a name'),
  category: z.string().min(1, 'needs a category'),
  subcategory: z.string().default(''),
  categorySource: z.enum(['auto', 'manual']).default('manual'),
  place: z.string().min(1),
  showInStock: z.boolean().default(true),
  tracking: z.enum(['simple', 'amount']).default('simple'),
  status: z.enum(['have', 'low', 'out']).default('have'),
  addToListWhen: z.enum(['low', 'out', 'never']).default('out'),
  active: z.boolean().default(true),
  unit: unitSchema.default('pcs'),
  quantity: z.number().finite().min(0).default(0),
  lowThreshold: z.number().finite().min(0).optional(),
  gramsPerPiece: z.number().positive().optional(),
  aliases: z.array(z.string()).optional(),
});
export type ItemInput = z.input<typeof itemInput>;

const FIELD_LABEL: Partial<Record<keyof Item, string>> = {
  name: 'Name',
  place: 'Place',
  tracking: 'Tracking',
  status: 'Status',
  unit: 'Unit',
  quantity: 'In the house',
  lowThreshold: 'Warn below',
  addToListWhen: 'Add to the list when',
  showInStock: 'Show in Stock',
  active: 'Watched',
};

/** Renaming an item also renames its open shopping-list entries. */
function renameShoppingOps(ctx: Ctx, itemId: string, name: string): Op[] {
  return ctx.snap.shopping.items
    .filter((s) => s.itemId === itemId && s.name !== name)
    .map((s) => O.shop.patch(s.id, { name }));
}

export const categoryExists = (ctx: Pick<Ctx, 'snap'>, category: string, subcategory: string) =>
  ctx.snap.household.categories.some(
    (c) => c.name === category && (!subcategory || c.subcategories.includes(subcategory)),
  );

function describeStock(it: Item): string {
  if (!it.active) return 'Not watched';
  if (it.tracking === 'simple') return `${statusLabel(it.status)}, tracked as have / low / out`;
  return `${fmtQty(it.quantity, it.unit)} in the house${it.lowThreshold ? `, warn below ${fmtQty(it.lowThreshold, it.unit)}` : ''}`;
}

export const upsertItem = defineAction({
  name: 'upsertItem',
  input: itemInput,
  plan(ctx, input) {
    const existing = input.id ? findItem(ctx, input.id) : undefined;
    if (input.id && !existing)
      return { title: 'Save item', lines: [], ops: [], blocked: 'This item was deleted by someone else.' };
    if (!ctx.snap.household.places.includes(input.place))
      return {
        title: 'Save item',
        lines: [],
        ops: [],
        blocked: `There's no storage place called ${input.place}.`,
      };
    if (!categoryExists(ctx, input.category, input.subcategory))
      return { title: 'Save item', lines: [], ops: [], blocked: 'Pick a category that exists.' };

    const amount = input.tracking === 'amount';
    const quantity = round3(input.quantity);
    const fields: Omit<Item, 'id' | 'aliases'> = {
      name: input.name.trim(),
      category: input.category,
      subcategory: input.subcategory,
      categorySource: input.categorySource,
      place: input.place,
      showInStock: input.showInStock,
      tracking: input.tracking,
      // amount items keep their status in step with the quantity
      status: amount ? statusForQuantity(input, quantity) : input.status,
      addToListWhen: input.addToListWhen,
      active: input.active,
      unit: input.unit,
      quantity: amount ? quantity : 0,
      ...(amount && input.lowThreshold ? { lowThreshold: input.lowThreshold } : {}),
      ...(input.gramsPerPiece ? { gramsPerPiece: input.gramsPerPiece } : {}),
    };

    if (!existing) {
      const item: Item = { id: ctx.newId(), ...fields, aliases: input.aliases ?? [] };
      const ops: Op[] = [
        O.item.upsert(item),
        ...lowStockSync([item], [item.id], ctx.snap.shopping.items, ctx),
      ];
      return {
        title: `Add ${item.name} to ${item.place}`,
        lines: [
          catLabel(item.category, item.subcategory),
          describeStock(item),
          ...(item.showInStock ? [] : ['Hidden from Stock']),
        ],
        ops,
        result: item.id,
      };
    }

    // edit: patch only what changed, so the other person's edits to other fields survive
    const set: Partial<Item> = {};
    const unset: (keyof Item)[] = [];
    const lines: string[] = [];
    for (const k of Object.keys(fields) as (keyof typeof fields)[]) {
      if (existing[k] !== fields[k]) {
        (set as Record<string, unknown>)[k] = fields[k];
        const label = FIELD_LABEL[k];
        if (label) lines.push(`${label}: ${String(existing[k] ?? '—')} → ${String(fields[k])}`);
      }
    }
    if (existing.category !== fields.category || existing.subcategory !== fields.subcategory)
      lines.push(
        `Category: ${catLabel(existing.category, existing.subcategory)} → ${catLabel(fields.category, fields.subcategory)}`,
      );
    if (existing.lowThreshold && !fields.lowThreshold) unset.push('lowThreshold');
    if (existing.gramsPerPiece && !input.gramsPerPiece) unset.push('gramsPerPiece');
    if (input.aliases && JSON.stringify(input.aliases) !== JSON.stringify(existing.aliases))
      set.aliases = input.aliases;
    const after: Item = { ...existing, ...set };
    for (const k of unset) delete after[k];
    const ops: Op[] = [];
    if (Object.keys(set).length || unset.length) ops.push(O.item.patch(existing.id, set, unset));
    if (set.name) ops.push(...renameShoppingOps(ctx, existing.id, set.name));
    ops.push(...lowStockSync([after], [after.id], ctx.snap.shopping.items, ctx));
    return {
      title: `Save changes to ${after.name}`,
      lines: lines.length ? lines : ['No changes'],
      ops,
      result: existing.id,
    };
  },
});

export function recipesUsingItem(ctx: Ctx, itemId: string) {
  return ctx.snap.recipes.recipes.filter((r) => r.ingredients.some((g) => g.itemId === itemId));
}

export const deleteItem = defineAction({
  name: 'deleteItem',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const it = findItem(ctx, id);
    if (!it) return { title: 'Delete item', lines: [], ops: [], blocked: 'This item is already gone.' };
    const used = recipesUsingItem(ctx, id);
    if (used.length)
      return {
        title: `Delete ${it.name}`,
        lines: [],
        ops: [],
        blocked: `Used in ${plural(used.length, 'recipe')} (${used.map((r) => r.title).join(', ')}). Remove it from ${used.length === 1 ? 'it' : 'them'} first.`,
      };
    const shop = ctx.snap.shopping.items.filter((s) => s.itemId === id && !s.checked);
    return {
      title: `Delete ${it.name}`,
      lines: [
        `${it.name}, ${catLabel(it.category, it.subcategory)}, ${it.place}`,
        ...(shop.length ? [`Also removes it from the shopping list`] : []),
        'Past purchases and usage keep their history',
      ],
      ops: [O.item.remove(id), ...shop.map((s) => O.shop.remove(s.id))],
      danger: true,
    };
  },
});

export const moveItems = defineAction({
  name: 'moveItems',
  input: z.object({ itemIds: z.array(z.string()).min(1), place: z.string() }),
  plan(ctx, { itemIds, place }) {
    if (!ctx.snap.household.places.includes(place))
      return {
        title: `Move items`,
        lines: [],
        ops: [],
        blocked: `There's no storage place called ${place}.`,
      };
    const items = itemIds.map((id) => findItem(ctx, id)).filter((i): i is Item => !!i && i.place !== place);
    if (!items.length)
      return { title: `Move to ${place}`, lines: [], ops: [], blocked: `They're already in ${place}.` };
    return {
      title: `Move ${plural(items.length, 'item')} to ${place}`,
      lines: items.map((i) => `${i.name}: ${i.place} → ${place}`),
      ops: items.map((i) => O.item.patch(i.id, { place })),
    };
  },
});

export const mergeItems = defineAction({
  name: 'mergeItems',
  input: z.object({ keepId: z.string(), mergeIds: z.array(z.string()).min(1) }),
  plan(ctx, { keepId, mergeIds }) {
    const keep = findItem(ctx, keepId);
    const others = mergeIds
      .filter((id) => id !== keepId)
      .map((id) => findItem(ctx, id))
      .filter((i): i is Item => !!i);
    if (!keep || !others.length)
      return { title: 'Merge items', lines: [], ops: [], blocked: 'Pick at least two items.' };
    let quantity = keep.quantity;
    const lines: string[] = [];
    const simple = keep.tracking === 'simple';
    // simple items have no amounts to add up: the merged item keeps the best status
    const rank = { have: 0, low: 1, out: 2 } as const;
    const best = [keep, ...others].map((i) => stockStatus(i)).sort((a, b) => rank[a] - rank[b])[0];
    for (const o of others) {
      if (simple || o.tracking === 'simple') {
        lines.push(`${o.name} merges into ${keep.name}`);
        continue;
      }
      const q = convert(o.quantity, o.unit, keep.unit, o.gramsPerPiece ?? keep.gramsPerPiece);
      if (q === null)
        return {
          title: `Merge into ${keep.name}`,
          lines: [],
          ops: [],
          blocked: `Can't add ${fmtQty(o.quantity, o.unit)} of ${o.name} to ${keep.unit}. Set the weight per piece first.`,
        };
      quantity = round3(quantity + q);
      lines.push(`${o.name} (${fmtQty(o.quantity, o.unit)}) merges into ${keep.name}`);
    }
    const aliases = Array.from(
      new Set([...keep.aliases, ...others.flatMap((o) => [o.name, ...o.aliases])]),
    ).filter((a) => a !== keep.name);
    const ids = new Set(others.map((o) => o.id));
    const ops: Op[] = [
      O.item.patch(keep.id, simple ? { status: best, aliases } : { quantity, aliases }),
      ...others.map((o) => O.item.remove(o.id)),
    ];
    // re-point everything that referenced the merged items
    for (const r of ctx.snap.recipes.recipes) {
      if (r.ingredients.some((g) => g.itemId && ids.has(g.itemId)))
        ops.push(
          O.recipe.patch(r.id, {
            ingredients: r.ingredients.map((g) =>
              g.itemId && ids.has(g.itemId) ? { ...g, itemId: keep.id } : g,
            ),
          }),
        );
    }
    for (const s of ctx.snap.shopping.items)
      if (s.itemId && ids.has(s.itemId)) ops.push(O.shop.patch(s.id, { itemId: keep.id, name: keep.name }));
    for (const b of Object.values(ctx.snap.budgets)) {
      const f = O.budget(budgetFileName(b.year));
      for (const p of b.purchases)
        if (p.lines.some((l) => l.itemId && ids.has(l.itemId)))
          ops.push(
            f.patchPurchase(p.id, {
              lines: p.lines.map((l) => (l.itemId && ids.has(l.itemId) ? { ...l, itemId: keep.id } : l)),
            }),
          );
    }
    for (const u of Object.values(ctx.snap.usage)) {
      const f = O.usage(usageFileName(u.year));
      for (const e of u.usage) if (ids.has(e.itemId)) ops.push(f.patch(e.id, { itemId: keep.id }));
    }
    if (!simple)
      lines.push(`${keep.name}: ${fmtQty(keep.quantity, keep.unit)} → ${fmtQty(quantity, keep.unit)}`);
    return {
      title: `Merge ${plural(others.length + 1, 'item')} into ${keep.name}`,
      lines,
      ops,
      danger: true,
    };
  },
});

export const addCategory = defineAction({
  name: 'addCategory',
  input: z.object({
    name: z.string().trim().min(1),
    subcategories: z.array(z.string().trim().min(1)).default(['General']),
  }),
  plan(ctx, { name, subcategories }) {
    if (ctx.snap.household.categories.some((c) => c.name.toLowerCase() === name.toLowerCase()))
      return { title: `New category ${name}`, lines: [], ops: [], blocked: 'That category already exists.' };
    return {
      title: `New category: ${name}`,
      lines: subcategories.length ? [`Subcategories: ${subcategories.join(', ')}`] : [],
      ops: [O.household.catAdd(name, subcategories)],
    };
  },
});

export const addSubcategory = defineAction({
  name: 'addSubcategory',
  input: z.object({ category: z.string(), name: z.string().trim().min(1) }),
  plan(ctx, { category, name }) {
    const c = ctx.snap.household.categories.find((x) => x.name === category);
    if (!c)
      return {
        title: 'New subcategory',
        lines: [],
        ops: [],
        blocked: `There's no category called ${category}.`,
      };
    if (c.subcategories.some((s) => s.toLowerCase() === name.toLowerCase()))
      return { title: 'New subcategory', lines: [], ops: [], blocked: 'That subcategory already exists.' };
    return {
      title: `New subcategory: ${category} › ${name}`,
      lines: [],
      ops: [O.household.subAdd(category, name)],
    };
  },
});
