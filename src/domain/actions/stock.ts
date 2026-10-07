import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { avgUnitPrice, lowStockSync } from '../stock';
import { qty as fmtQty, round3 } from '../format';
import { toBase } from '../units';
import { ensureYearOps } from '../budget';
import { usageFileName } from '../files';
import type { Item, UsageEntry } from '../schemas';
import { yearOfDate } from '../dates';

export const findItem = (ctx: Ctx, id: string) => ctx.snap.items.items.find((i) => i.id === id);

/** Usage entry for `amount` (in the item's unit) leaving stock. */
export function usageEntry(
  ctx: Ctx,
  it: Item,
  amount: number,
  reason: UsageEntry['reason'],
  recipeId?: string,
): UsageEntry {
  const b = toBase(amount, it.unit);
  const per = avgUnitPrice(it, Object.values(ctx.snap.budgets));
  return {
    id: ctx.newId(),
    date: ctx.today,
    by: ctx.me.email,
    itemId: it.id,
    name: it.name,
    category: it.category,
    subcategory: it.subcategory,
    quantity: round3(b.q),
    unit: b.u,
    value: per === null ? 0 : Math.round(per * b.q * 100) / 100,
    reason,
    ...(recipeId ? { recipeId } : {}),
  };
}

export function usageOps(ctx: Ctx, entries: UsageEntry[]): Op[] {
  if (!entries.length) return [];
  const year = yearOfDate(ctx.today);
  const u = O.usage(usageFileName(year));
  return [...ensureYearOps(ctx, year), ...entries.map((e) => u.add(e))];
}

/** Applies quantity deltas, logs usage for decreases and syncs low-stock entries. */
export function stockDeltaOps(
  ctx: Ctx,
  deltas: { itemId: string; delta: number }[],
  usage: { reason: UsageEntry['reason']; recipeId?: string } | null,
): { ops: Op[]; lines: string[] } {
  const ops: Op[] = [];
  const lines: string[] = [];
  const entries: UsageEntry[] = [];
  const after = new Map<string, Item>();
  for (const { itemId, delta } of deltas) {
    const it = after.get(itemId) ?? findItem(ctx, itemId);
    if (!it || delta === 0) continue;
    const next = Math.max(0, round3(it.quantity + delta));
    const actual = round3(next - it.quantity);
    if (actual === 0) continue;
    ops.push(O.item.inc(itemId, actual));
    lines.push(`${it.name}: ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next, it.unit)}, ${it.place}`);
    if (actual < 0 && usage) entries.push(usageEntry(ctx, it, -actual, usage.reason, usage.recipeId));
    after.set(itemId, { ...it, quantity: next });
  }
  ops.push(...usageOps(ctx, entries));
  ops.push(
    ...lowStockSync([...after.values()], after.keys(), ctx.snap.shopping.items, {
      actor: ctx.actor,
      now: ctx.now,
      newId: ctx.newId,
    }),
  );
  return { ops, lines };
}

export const adjustStock = defineAction({
  name: 'adjustStock',
  input: z.object({
    itemId: z.string(),
    /** change in the item's unit, e.g. -0.5 */
    delta: z.number().finite().optional(),
    /** or an absolute new quantity */
    set: z.number().finite().min(0).optional(),
    reason: z.enum(['manual-decrease', 'expired', 'other']).default('manual-decrease'),
  }),
  plan(ctx, input) {
    const it = findItem(ctx, input.itemId);
    if (!it)
      return { title: 'Change stock', lines: [], ops: [], blocked: "That item doesn't exist any more." };
    const delta = input.set !== undefined ? input.set - it.quantity : (input.delta ?? 0);
    const { ops, lines } = stockDeltaOps(ctx, [{ itemId: it.id, delta }], { reason: input.reason });
    const next = Math.max(0, round3(it.quantity + delta));
    return {
      title: `${it.name}: ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next, it.unit)}`,
      lines,
      ops,
      blocked: ops.length ? undefined : 'Nothing to change.',
    };
  },
});
