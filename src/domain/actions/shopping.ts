import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { unitSchema, type Item } from '../schemas';
import { mergeIntoList, mergeToast } from '../shopping';
import { plural, qty as fmtQty, round3 } from '../format';
import { convert } from '../units';
import { isSimple, lowStockSync } from '../stock';
import { statusLabel } from './stock';

export const addToShoppingList = defineAction({
  name: 'addToShoppingList',
  input: z.object({
    entries: z
      .array(
        z.object({
          itemId: z.string().optional(),
          name: z.string().trim().min(1),
          amount: z.number().positive().optional(),
          unit: unitSchema.optional(),
        }),
      )
      .min(1, 'add at least one thing'),
    source: z.enum(['manual', 'low-stock', 'recipe', 'plan']).default('manual'),
    sourceRef: z.string().optional(),
  }),
  plan(ctx, input) {
    const r = mergeIntoList(ctx.snap.shopping.items, input.entries, {
      source: input.source,
      sourceRef: input.sourceRef,
      actor: ctx.actor,
      now: ctx.now,
      newId: ctx.newId,
      items: ctx.snap.items.items,
    });
    return {
      title:
        input.entries.length === 1
          ? `Add ${input.entries[0].name} to the shopping list`
          : `Add ${input.entries.length} items to the shopping list`,
      lines: input.entries.map((e) =>
        e.amount && e.unit ? `${e.name}, ${fmtQty(e.amount, e.unit)}` : e.name,
      ),
      ops: r.ops,
      blocked: r.ops.length ? undefined : mergeToast(r),
      result: mergeToast(r),
    };
  },
});

const findEntry = (ctx: Ctx, id: string) => ctx.snap.shopping.items.find((s) => s.id === id);

export const checkShoppingItems = defineAction({
  name: 'checkShoppingItems',
  input: z.object({ ids: z.array(z.string()).min(1), checked: z.boolean() }),
  plan(ctx, { ids, checked }) {
    const entries = ids.map((id) => findEntry(ctx, id)).filter((s) => !!s && s.checked !== checked);
    return {
      title: `${checked ? 'Check off' : 'Uncheck'} ${entries.length === 1 ? entries[0]!.name : plural(entries.length, 'item')}`,
      lines: entries.map((s) => s!.name),
      ops: entries.map((s) => O.shop.patch(s!.id, { checked })),
      blocked: entries.length ? undefined : 'Nothing to change.',
    };
  },
});

export const updateShoppingItem = defineAction({
  name: 'updateShoppingItem',
  input: z.object({
    id: z.string(),
    name: z.string().trim().min(1),
    amount: z.number().positive().optional(),
    unit: unitSchema.optional(),
  }),
  plan(ctx, input) {
    const s = findEntry(ctx, input.id);
    if (!s)
      return { title: 'Change entry', lines: [], ops: [], blocked: 'That entry is no longer on the list.' };
    const unset: ('amount' | 'unit')[] = [];
    if (input.amount === undefined && s.amount !== undefined) unset.push('amount');
    if (input.unit === undefined && s.unit !== undefined) unset.push('unit');
    return {
      title: `Change ${input.name} on the shopping list`,
      lines: [input.amount && input.unit ? `${input.name}, ${fmtQty(input.amount, input.unit)}` : input.name],
      ops: [
        O.shop.patch(
          s.id,
          {
            name: input.name,
            ...(input.amount !== undefined ? { amount: input.amount } : {}),
            ...(input.unit ? { unit: input.unit } : {}),
          },
          unset,
        ),
      ],
    };
  },
});

export const removeShoppingItems = defineAction({
  name: 'removeShoppingItems',
  input: z.object({ ids: z.array(z.string()).min(1) }),
  plan(ctx, { ids }) {
    const entries = ids.map((id) => findEntry(ctx, id)).filter((s) => !!s);
    return {
      title:
        entries.length === 1
          ? `Remove ${entries[0]!.name} from the list`
          : `Clear ${plural(entries.length, 'item')} from the list`,
      lines: entries.map((s) => s!.name),
      ops: entries.map((s) => O.shop.remove(s!.id)),
      blocked: entries.length ? undefined : 'Nothing to remove.',
    };
  },
});

/**
 * "I bought these": adds checked entries to stock with the given quantities
 * and removes them from the list. A manual alternative to scanning a receipt.
 */
export const stockFromShopping = defineAction({
  name: 'stockFromShopping',
  input: z.object({
    lines: z
      .array(
        z.object({ shoppingId: z.string(), itemId: z.string(), amount: z.number().min(0), unit: unitSchema }),
      )
      .default([]),
    /** remove these entries from the list afterwards (default) */
    clear: z.boolean().default(true),
    /** other checked entries to clear without adding to stock */
    alsoClear: z.array(z.string()).default([]),
  }),
  plan(ctx, input) {
    const ops: Op[] = [];
    const lines: string[] = [];
    const after = new Map<string, Item>();
    for (const l of input.lines) {
      const it = after.get(l.itemId) ?? ctx.snap.items.items.find((i) => i.id === l.itemId);
      if (!it) continue;
      if (isSimple(it)) {
        // simple items: bought means "Have", whatever the amount
        if (it.status !== 'have') {
          ops.push(O.item.patch(it.id, { status: 'have' }));
          lines.push(`${it.name}: ${statusLabel(it.status)} → Have, ${it.place}`);
        }
        after.set(it.id, { ...it, status: 'have' });
        continue;
      }
      if (l.amount <= 0) continue;
      const add = convert(l.amount, l.unit, it.unit, it.gramsPerPiece);
      if (add === null)
        return {
          title: 'Add to stock',
          lines: [],
          ops: [],
          blocked: `Can't add ${fmtQty(l.amount, l.unit)} to ${it.name}, which is counted in ${it.unit}.`,
        };
      const next = round3(it.quantity + add);
      ops.push(O.item.inc(it.id, add));
      lines.push(`${it.name}: ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next, it.unit)}, ${it.place}`);
      after.set(it.id, { ...it, quantity: next });
    }
    const clearIds = new Set([
      ...(input.clear ? input.lines.map((l) => l.shoppingId) : []),
      ...input.alsoClear,
    ]);
    for (const id of clearIds) if (findEntry(ctx, id)) ops.push(O.shop.remove(id));
    // restored stock removes other automatic low-stock entries for the same items
    const remaining = ctx.snap.shopping.items.filter((s) => !clearIds.has(s.id));
    ops.push(...lowStockSync([...after.values()], after.keys(), remaining, ctx));
    return {
      title: `Add ${plural(after.size, 'item')} to stock`,
      lines: [...lines, ...(clearIds.size ? [`${plural(clearIds.size, 'item')} cleared from the list`] : [])],
      ops,
      blocked: ops.length ? undefined : 'Nothing to add.',
    };
  },
});
