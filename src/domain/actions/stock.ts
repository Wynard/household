import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { avgUnitPrice, isSimple, isWatched, lowStockSync, stockStatus } from '../stock';
import { qty as fmtQty, round3 } from '../format';
import { toBase } from '../units';
import { ensureYearOps } from '../budget';
import { usageFileName } from '../files';
import type { Item, ItemStatus, UsageEntry } from '../schemas';
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

/** A simple item went to Low or Out: logged without quantity or value. */
function statusEvent(
  ctx: Ctx,
  it: Item,
  status: 'low' | 'out',
  reason: UsageEntry['reason'],
  recipeId?: string,
): UsageEntry {
  return {
    id: ctx.newId(),
    date: ctx.today,
    by: ctx.me.email,
    itemId: it.id,
    name: it.name,
    category: it.category,
    subcategory: it.subcategory,
    quantity: 0,
    unit: 'pcs',
    value: 0,
    reason,
    status,
    ...(recipeId ? { recipeId } : {}),
  };
}

export function usageOps(ctx: Ctx, entries: UsageEntry[]): Op[] {
  if (!entries.length) return [];
  const year = yearOfDate(ctx.today);
  const u = O.usage(usageFileName(year));
  return [...ensureYearOps(ctx, year), ...entries.map((e) => u.add(e))];
}

export type StockChange = { itemId: string; delta: number } | { itemId: string; status: ItemStatus };

const STATUS_LABEL: Record<ItemStatus, string> = { have: 'Have', low: 'Low', out: 'Out' };
export const statusLabel = (s: ItemStatus) => STATUS_LABEL[s];
const RANK: Record<ItemStatus, number> = { have: 0, low: 1, out: 2 };

/**
 * Applies stock changes: quantity deltas for amount items, status changes for
 * simple items (a positive delta on a simple item means "bought": it becomes
 * Have). Logs usage (decreases, and simple items dropping to Low/Out) and keeps
 * automatic shopping-list entries in sync.
 */
export function stockChangeOps(
  ctx: Ctx,
  changes: StockChange[],
  usage: { reason: UsageEntry['reason']; recipeId?: string } | null,
): { ops: Op[]; lines: string[] } {
  const ops: Op[] = [];
  const lines: string[] = [];
  const entries: UsageEntry[] = [];
  const after = new Map<string, Item>();
  for (const c of changes) {
    const it = after.get(c.itemId) ?? findItem(ctx, c.itemId);
    if (!it || !isWatched(it)) continue; // inactive items are never changed by the app
    const before = stockStatus(it);
    if (isSimple(it)) {
      const target: ItemStatus | null = 'status' in c ? c.status : c.delta > 0 ? 'have' : null;
      if (!target || target === before) continue;
      ops.push(O.item.patch(it.id, { status: target }));
      lines.push(`${it.name}: ${statusLabel(before)} → ${statusLabel(target)}, ${it.place}`);
      if (usage && target !== 'have' && RANK[target] > RANK[before])
        entries.push(statusEvent(ctx, it, target, usage.reason, usage.recipeId));
      after.set(it.id, { ...it, status: target });
      continue;
    }
    // amount item: a status change only means anything as "Out" (nothing left)
    const delta = 'status' in c ? (c.status === 'out' ? -it.quantity : 0) : c.delta;
    if (delta === 0) continue;
    const next = Math.max(0, round3(it.quantity + delta));
    const actual = round3(next - it.quantity);
    if (actual === 0) continue;
    ops.push(O.item.inc(it.id, actual));
    lines.push(`${it.name}: ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next, it.unit)}, ${it.place}`);
    if (actual < 0 && usage) entries.push(usageEntry(ctx, it, -actual, usage.reason, usage.recipeId));
    after.set(it.id, { ...it, quantity: next });
  }
  ops.push(...usageOps(ctx, entries));
  ops.push(...lowStockSync([...after.values()], after.keys(), ctx.snap.shopping.items, ctx));
  return { ops, lines };
}

/** Quantity deltas only (kept for callers that deal in amounts). */
export const stockDeltaOps = (
  ctx: Ctx,
  deltas: { itemId: string; delta: number }[],
  usage: { reason: UsageEntry['reason']; recipeId?: string } | null,
) => stockChangeOps(ctx, deltas, usage);

const notWatched = (it: Item) => ({
  title: `Change ${it.name}`,
  lines: [],
  ops: [],
  blocked: `${it.name} isn't watched. Turn on "Watch this item" in its settings first.`,
});

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
    if (!isWatched(it)) return notWatched(it);
    if (isSimple(it))
      return {
        title: `Change ${it.name}`,
        lines: [],
        ops: [],
        blocked: `${it.name} is tracked as Have / Low / Out, not as an amount.`,
      };
    const delta = input.set !== undefined ? input.set - it.quantity : (input.delta ?? 0);
    const { ops, lines } = stockChangeOps(ctx, [{ itemId: it.id, delta }], { reason: input.reason });
    const next = Math.max(0, round3(it.quantity + delta));
    return {
      title: `${it.name}: ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next, it.unit)}`,
      lines,
      ops,
      blocked: ops.length ? undefined : 'Nothing to change.',
    };
  },
});

/** Have / Low / Out for a simple item (for an amount item, Out empties it). */
export const setItemStatus = defineAction({
  name: 'setItemStatus',
  input: z.object({ itemId: z.string(), status: z.enum(['have', 'low', 'out']) }),
  plan(ctx, { itemId, status }) {
    const it = findItem(ctx, itemId);
    if (!it)
      return { title: 'Change stock', lines: [], ops: [], blocked: "That item doesn't exist any more." };
    if (!isWatched(it)) return notWatched(it);
    if (!isSimple(it) && status !== 'out')
      return {
        title: `Change ${it.name}`,
        lines: [],
        ops: [],
        blocked: `${it.name} is tracked by amount. Change the amount instead.`,
      };
    const { ops, lines } = stockChangeOps(ctx, [{ itemId, status }], { reason: 'manual-decrease' });
    return {
      title: `${it.name}: ${statusLabel(status)}`,
      lines,
      ops,
      blocked: ops.length ? undefined : `${it.name} is already ${statusLabel(status)}.`,
    };
  },
});
