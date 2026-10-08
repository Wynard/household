import type { BudgetFile, Item, ShoppingItem } from './schemas';
import { O, type Op } from './ops';
import { convert, toBase } from './units';
import { STEP_BY_UNIT } from './defaults';

export type StockStatus = 'have' | 'low' | 'out';

type StatusFields = Pick<Item, 'tracking' | 'status' | 'quantity' | 'lowThreshold'> & { active?: boolean };

/** Watched by the app (the default). Inactive items are kept but never watched. */
export const isWatched = (it: { active?: boolean }) => it.active !== false;

/**
 * Simple items: their stored status. Amount items: derived from quantity vs
 * threshold. Inactive items are never Low or Out.
 */
export function stockStatus(it: StatusFields): StockStatus {
  if (!isWatched(it)) return 'have';
  if (it.tracking === 'simple') return it.status;
  if (it.quantity <= 0) return 'out';
  if (it.lowThreshold && it.quantity < it.lowThreshold) return 'low';
  return 'have';
}

/** Status an amount item would have with this quantity. */
export const statusForQuantity = (it: Pick<Item, 'lowThreshold'>, quantity: number): StockStatus =>
  stockStatus({ tracking: 'amount', status: 'have', quantity, lowThreshold: it.lowThreshold });

export const isSimple = (it: Pick<Item, 'tracking'>) => it.tracking === 'simple';

/** Should the item be on the shopping list automatically right now (addToListWhen)? */
export function wantsOnList(it: Item): boolean {
  if (!it.showInStock || it.archived || !isWatched(it)) return false;
  const st = stockStatus(it);
  if (it.addToListWhen === 'low') return st !== 'have';
  if (it.addToListWhen === 'out') return st === 'out';
  return false;
}

export const stepFor = (it: Pick<Item, 'unit'>) => STEP_BY_UNIT[it.unit];

/**
 * Shopping-list ops that keep automatic entries in sync for the given items:
 * add an entry when an item reaches its addToListWhen level (Low or Out),
 * remove the automatic entry when it's back. Only items shown in Stock.
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
    const want = wantsOnList(it);
    if (want && !open) {
      ops.push(
        O.shop.upsert({
          id: opts.newId(),
          itemId: it.id,
          name: it.name,
          ...(isSimple(it) ? {} : { unit: it.unit }),
          source: 'low-stock',
          checked: false,
          addedBy: opts.actor,
          addedAt: opts.now,
        }),
      );
    } else if (!want && open && open.source === 'low-stock') {
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
