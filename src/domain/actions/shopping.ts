import { z } from 'zod';
import { defineAction } from './types';
import { unitSchema } from '../schemas';
import { mergeIntoList, mergeToast } from '../shopping';
import { qty as fmtQty } from '../format';

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
