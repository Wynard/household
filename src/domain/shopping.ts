import { normalise } from './categorise';
import { O, type Op } from './ops';
import type { Item, ShoppingItem, Unit } from './schemas';
import { convert } from './units';
import { round3 } from './format';

export interface ShoppingAdd {
  itemId?: string;
  name: string;
  amount?: number;
  unit?: Unit;
}

export interface MergeResult {
  ops: Op[];
  added: string[];
  updated: string[];
  /** entries whose amount changed */
  changed: number;
}

/** Round up pieces; keep weights/volumes to 3 decimals. */
const tidy = (amount: number, unit?: Unit) => (unit === 'pcs' ? Math.ceil(amount - 1e-9) : round3(amount));

/**
 * Merges new entries into the open (unchecked) list:
 * - same item (or same name when unlinked) -> one entry, amounts summed
 *   (converted to the existing entry's unit when possible);
 * - adding again from the same recipe/plan replaces that source's earlier
 *   amount instead of counting it twice.
 */
export function mergeIntoList(
  list: ShoppingItem[],
  adds: ShoppingAdd[],
  opts: {
    source: ShoppingItem['source'];
    sourceRef?: string;
    actor: string;
    now: string;
    newId: () => string;
    items?: Item[];
  },
): MergeResult {
  const ops: Op[] = [];
  const added: string[] = [];
  const updated: string[] = [];
  let changed = 0;
  const work = list.map((s) => ({ ...s }));
  const byId = new Map((opts.items ?? []).map((i) => [i.id, i]));

  for (const a of adds) {
    const n = normalise(a.name);
    const open = work.find(
      (s) => !s.checked && (a.itemId ? s.itemId === a.itemId : !s.itemId && normalise(s.name) === n),
    );
    const unit = a.unit ?? (a.itemId ? byId.get(a.itemId)?.unit : undefined);
    if (!open) {
      const entry: ShoppingItem = {
        id: opts.newId(),
        ...(a.itemId ? { itemId: a.itemId } : {}),
        name: a.name,
        ...(a.amount !== undefined && a.amount > 0
          ? { amount: tidy(a.amount, unit), unit }
          : unit
            ? { unit }
            : {}),
        source: opts.source,
        ...(opts.sourceRef ? { sourceRef: opts.sourceRef } : {}),
        checked: false,
        addedBy: opts.actor,
        addedAt: opts.now,
      };
      work.push(entry);
      ops.push(O.shop.upsert(entry));
      added.push(a.name);
      continue;
    }
    if (a.amount === undefined || a.amount <= 0) {
      updated.push(a.name); // already on the list, nothing to add
      continue;
    }
    const sameSource = open.source === opts.source && opts.sourceRef && open.sourceRef === opts.sourceRef;
    const item = a.itemId ? byId.get(a.itemId) : undefined;
    let amount: number;
    let entryUnit = open.unit ?? unit;
    if (open.amount === undefined || sameSource) {
      amount = a.amount;
      entryUnit = unit ?? entryUnit;
    } else {
      const conv =
        unit && open.unit
          ? convert(a.amount, unit, open.unit, item?.gramsPerPiece)
          : unit === open.unit
            ? a.amount
            : null;
      amount = conv === null ? Math.max(open.amount, a.amount) : open.amount + conv;
    }
    const next = tidy(amount, entryUnit);
    if (next !== open.amount || entryUnit !== open.unit) {
      ops.push(O.shop.patch(open.id, { amount: next, ...(entryUnit ? { unit: entryUnit } : {}) }));
      open.amount = next;
      open.unit = entryUnit;
      changed++;
    }
    updated.push(a.name);
  }
  return { ops, added, updated, changed };
}

export function mergeToast(r: MergeResult): string {
  const a = r.added.length;
  const u = r.updated.length;
  const more = r.changed ? ', amounts updated' : '';
  if (a && u) return `${a} added, ${u} already on the list${more}`;
  if (a)
    return a === 1 ? `${r.added[0]} added to the shopping list` : `${a} items added to the shopping list`;
  if (r.changed)
    return u === 1
      ? `${r.updated[0]}: amount updated on the shopping list`
      : `${u} already on the list, amounts updated`;
  return u === 1 ? `${r.updated[0]} is already on the shopping list` : 'Already on the shopping list';
}
