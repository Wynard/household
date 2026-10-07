import type { BudgetFile, Item, ShoppingItem } from './schemas';
import { O, type Op } from './ops';
import { convert, toBase } from './units';
import { STEP_BY_UNIT } from './defaults';

export type StockStatus = 'ok' | 'low' | 'out';

export function stockStatus(it: Pick<Item, 'quantity' | 'lowThreshold'>): StockStatus {
  if (it.quantity <= 0) return 'out';
  if (it.lowThreshold && it.quantity < it.lowThreshold) return 'low';
  return 'ok';
}

/** Below its warning threshold (the rule for auto-adding to the shopping list). */
export const isBelowThreshold = (it: Pick<Item, 'quantity' | 'lowThreshold'>) =>
  !!it.lowThreshold && it.lowThreshold > 0 && it.quantity < it.lowThreshold;

export const stepFor = (it: Pick<Item, 'unit'>) => STEP_BY_UNIT[it.unit];

/**
 * Shopping-list ops that keep low-stock entries in sync for the given items:
 * add an entry when an item drops below its threshold, remove the automatic
 * entry when stock is back up. Only items shown in Stock get alerts.
 */
export function lowStockSync(
  itemsAfter: Item[],
  touchedIds: Iterable<string>,
  shopping: ShoppingItem[],
  opts: { actor: string; now: string; newId: () => string },
): Op[] {
  const ops: Op[] = [];
  const touched = new Set(touchedIds);
  for (const it of itemsAfter) {
    if (!touched.has(it.id)) continue;
    const open = shopping.find((s) => s.itemId === it.id && !s.checked);
    const below = it.showInStock && !it.archived && isBelowThreshold(it);
    if (below && !open) {
      ops.push(
        O.shop.upsert({
          id: opts.newId(),
          itemId: it.id,
          name: it.name,
          unit: it.unit,
          source: 'low-stock',
          checked: false,
          addedBy: opts.actor,
          addedAt: opts.now,
        }),
      );
    } else if (!below && open && open.source === 'low-stock') {
      ops.push(O.shop.remove(open.id));
    }
  }
  return ops;
}

/**
 * Average price paid per base unit (g, ml or pcs) of an item, across the given
 * budget years. Used to estimate the value of what was used.
 */
export function avgUnitPrice(item: Item, budgets: BudgetFile[]): number | null {
  let total = 0;
  let q = 0;
  const base = toBase(1, item.unit).u;
  for (const b of budgets) {
    for (const p of b.purchases) {
      for (const l of p.lines) {
        if (l.itemId !== item.id) continue;
        const inBase = convert(
          l.quantity,
          l.unit,
          base === 'g' ? 'g' : base === 'ml' ? 'ml' : 'pcs',
          item.gramsPerPiece,
        );
        if (inBase === null || inBase <= 0) continue;
        total += l.price;
        q += inBase;
      }
    }
  }
  if (q > 0) return total / q;
  if (item.lastPrice) {
    const per = convert(
      1,
      item.lastPrice.per,
      base === 'g' ? 'g' : base === 'ml' ? 'ml' : 'pcs',
      item.gramsPerPiece,
    );
    if (per) return item.lastPrice.amount / per;
  }
  return null;
}
