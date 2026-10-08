// The shared pot (6.5): contributions in, purchases out, adjustments, and a
// soft-delete log so deletions can be undone and the other person sees them.
import { z } from 'zod';
import { defineAction, type Ctx } from './types';
import { O, type Op } from '../ops';
import { ensureYearOps } from '../budget';
import { budgetFileName } from '../files';
import { yearOfDate } from '../dates';
import { catLabel, dayLabel, money, plural, qty as fmtQty, round2, round3 } from '../format';
import { convert } from '../units';
import { lowStockSync } from '../stock';
import { normalise } from '../categorise';
import {
  unitSchema,
  type Contribution,
  type Item,
  type PotAdjustment,
  type Purchase,
  type PurchaseLine,
} from '../schemas';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'needs a date');

export const purchaseLineInput = z.object({
  id: z.string().optional(),
  rawText: z.string().optional(),
  itemId: z.string().optional(),
  name: z.string().trim().min(1, 'every item needs a name'),
  quantity: z.number().positive('quantities must be above zero'),
  unit: unitSchema,
  unitPrice: z.number().optional(),
  price: z.number().finite(),
  category: z.string().min(1, 'every item needs a category'),
  subcategory: z.string().min(1, 'every item needs a category'),
  note: z.string().optional(),
  /** add this line to stock (creates the item when it isn't in the catalog yet) */
  toStock: z.boolean().optional(),
  /** where a newly created item is kept */
  place: z.string().optional(),
  /** the person confirmed or corrected the match: remember the receipt spelling */
  learnAlias: z.boolean().optional(),
});
export type PurchaseLineInput = z.input<typeof purchaseLineInput>;

const purchaseFields = {
  store: z.string().trim().min(1, 'needs the store name'),
  date,
  time: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
  spentBy: z.string().min(1),
  purpose: z.string().trim().optional(),
  lines: z.array(purchaseLineInput).min(1, 'needs at least one item'),
};

export function findPurchase(ctx: Ctx, id: string): { p: Purchase; year: number } | undefined {
  for (const b of Object.values(ctx.snap.budgets)) {
    const p = b.purchases.find((x) => x.id === id);
    if (p) return { p, year: b.year };
  }
  return undefined;
}
function findContribution(ctx: Ctx, id: string): { c: Contribution; year: number } | undefined {
  for (const b of Object.values(ctx.snap.budgets)) {
    const c = b.contributions.find((x) => x.id === id);
    if (c) return { c, year: b.year };
  }
  return undefined;
}
function findAdjustment(ctx: Ctx, id: string): { a: PotAdjustment; year: number } | undefined {
  for (const b of Object.values(ctx.snap.budgets)) {
    const a = b.adjustments.find((x) => x.id === id);
    if (a) return { a, year: b.year };
  }
  return undefined;
}

export const memberName = (ctx: Pick<Ctx, 'snap'>, email: string) =>
  ctx.snap.household.members.find((m) => m.email === email)?.name ?? email.split('@')[0];

function storeOps(ctx: Ctx, store: string): Op[] {
  return ctx.snap.household.stores.some((s) => s.toLowerCase() === store.toLowerCase())
    ? []
    : [O.household.listAdd('stores', store)];
}
function canonicalStore(ctx: Ctx, store: string) {
  return (
    ctx.snap.household.stores.find((s) => s.toLowerCase() === store.trim().toLowerCase()) ?? store.trim()
  );
}

const toLine = (l: z.infer<typeof purchaseLineInput>, id: string, itemId?: string): PurchaseLine => ({
  id,
  ...(l.rawText ? { rawText: l.rawText } : {}),
  ...(itemId ? { itemId } : {}),
  name: l.name.trim(),
  quantity: round3(l.quantity),
  unit: l.unit,
  unitPrice: l.unitPrice ?? round2(l.price / l.quantity),
  price: round2(l.price),
  category: l.category,
  subcategory: l.subcategory,
  ...(l.note?.trim() ? { note: l.note.trim() } : {}),
});

export const addPurchase = defineAction({
  name: 'addPurchase',
  input: z.object({
    ...purchaseFields,
    source: z.enum(['receipt', 'manual']).default('manual'),
    receiptFileIds: z.array(z.string()).optional(),
    /** total printed on the receipt; defaults to the sum of the lines */
    total: z.number().optional(),
    /** shopping-list entries this purchase checks off */
    checkShoppingIds: z.array(z.string()).optional(),
  }),
  plan(ctx, input) {
    const tree = ctx.snap.household.categories;
    for (const l of input.lines)
      if (!tree.some((c) => c.name === l.category && c.subcategories.includes(l.subcategory)))
        return { title: 'Add a purchase', lines: [], ops: [], blocked: `Pick a category for ${l.name}.` };
    const year = yearOfDate(input.date);
    const ops: Op[] = [...ensureYearOps(ctx, year)];
    const store = canonicalStore(ctx, input.store);
    ops.push(...storeOps(ctx, store));
    const preview: string[] = [
      `${store}, ${dayLabel(input.date)}${input.time ? ` ${input.time}` : ''}, money taken by ${memberName(ctx, input.spentBy)}`,
    ];
    const stockLines: string[] = [];
    const after = new Map<string, Item>();
    const lines: PurchaseLine[] = [];
    const places = ctx.snap.household.places;

    for (const l of input.lines) {
      const lineId = l.id ?? ctx.newId();
      let itemId = l.itemId && ctx.snap.items.items.some((i) => i.id === l.itemId) ? l.itemId : undefined;
      const line = toLine(l, lineId, itemId);
      preview.push(
        `${line.name}, ${fmtQty(line.quantity, line.unit)}, ${money(line.price)}, ${catLabel(line.category, line.subcategory)}`,
      );

      if (l.toStock && !itemId) {
        // a new item, created from this line
        const it: Item = {
          id: ctx.newId(),
          name: line.name,
          category: line.category,
          subcategory: line.subcategory,
          categorySource: 'manual',
          place:
            l.place && places.includes(l.place) ? l.place : places.includes('Pantry') ? 'Pantry' : places[0],
          showInStock: true,
          // new items start simple (Have / Low / Out); switch to amounts in the editor if needed
          tracking: 'simple',
          status: 'out',
          addToListWhen: 'out',
          active: true,
          unit: line.unit,
          quantity: 0,
          aliases: l.rawText && normalise(l.rawText) !== normalise(line.name) ? [l.rawText] : [],
        };
        ops.push(O.item.upsert(it));
        itemId = it.id;
        line.itemId = it.id;
        after.set(it.id, it);
      }
      if (itemId) {
        const it = after.get(itemId) ?? ctx.snap.items.items.find((i) => i.id === itemId)!;
        let next = it;
        if (l.toStock && it.active === false) {
          // not watched: the purchase is recorded, stock stays as it is
        } else if (l.toStock && it.tracking === 'simple') {
          if (it.status !== 'have') {
            ops.push(O.item.patch(it.id, { status: 'have' }));
            stockLines.push(`Stock: ${it.name} → Have, ${it.place}`);
          }
          next = { ...it, status: 'have' };
        } else if (l.toStock) {
          const add = convert(line.quantity, line.unit, it.unit, it.gramsPerPiece);
          if (add === null)
            return {
              title: 'Add a purchase',
              lines: [],
              ops: [],
              blocked: `${line.name} is counted in ${it.unit} in stock, so ${fmtQty(line.quantity, line.unit)} can't be added. Change the unit or turn off "add to stock".`,
            };
          ops.push(O.item.inc(it.id, add));
          next = { ...it, quantity: round3(it.quantity + add) };
          stockLines.push(
            `Stock: ${it.name} ${fmtQty(it.quantity, it.unit)} → ${fmtQty(next.quantity, it.unit)}, ${it.place}`,
          );
        }
        const lastPrice = {
          amount: round2(line.price / line.quantity),
          per: line.unit,
          date: input.date,
          store,
        };
        const patch: Partial<Item> = { lastPrice };
        if (
          l.learnAlias &&
          l.rawText &&
          ![it.name, ...it.aliases].some((a) => normalise(a) === normalise(l.rawText!))
        )
          patch.aliases = [...it.aliases, l.rawText];
        ops.push(O.item.patch(it.id, patch));
        after.set(it.id, { ...next, ...patch });
      }
      lines.push(line);
    }

    const sum = round2(lines.reduce((t, l) => t + l.price, 0));
    const purchase: Purchase = {
      id: ctx.newId(),
      date: input.date,
      ...(input.time ? { time: input.time } : {}),
      store,
      spentBy: input.spentBy,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      lines,
      total: input.total !== undefined ? round2(input.total) : sum,
      source: input.source,
      ...(input.receiptFileIds?.length
        ? { receiptFileId: input.receiptFileIds[0], receiptFileIds: input.receiptFileIds }
        : {}),
      createdBy: ctx.actor,
      createdAt: ctx.now,
    };
    ops.push(O.budget(budgetFileName(year)).upsertPurchase(purchase));

    const checks = (input.checkShoppingIds ?? []).filter((id) =>
      ctx.snap.shopping.items.some((s) => s.id === id && !s.checked),
    );
    ops.push(...checks.map((id) => O.shop.patch(id, { checked: true })));
    const remaining = ctx.snap.shopping.items.map((s) =>
      checks.includes(s.id) ? { ...s, checked: true } : s,
    );
    ops.push(...lowStockSync([...after.values()], after.keys(), remaining, ctx));
    if (checks.length) preview.push(`${plural(checks.length, 'shopping list item')} checked off`);

    return {
      title: `Add a purchase of ${money(purchase.total)}`,
      lines: [...preview, ...stockLines],
      ops,
      result: purchase.id,
    };
  },
});

export const updatePurchase = defineAction({
  name: 'updatePurchase',
  input: z.object({ id: z.string(), ...purchaseFields }),
  plan(ctx, input) {
    const found = findPurchase(ctx, input.id);
    if (!found) return { title: 'Edit purchase', lines: [], ops: [], blocked: 'This purchase was deleted.' };
    const { p, year } = found;
    const tree = ctx.snap.household.categories;
    for (const l of input.lines)
      if (!tree.some((c) => c.name === l.category && c.subcategories.includes(l.subcategory)))
        return { title: 'Edit purchase', lines: [], ops: [], blocked: `Pick a category for ${l.name}.` };
    const store = canonicalStore(ctx, input.store);
    const lines = input.lines.map((l) => toLine(l, l.id ?? ctx.newId(), l.itemId));
    const sum = round2(lines.reduce((t, l) => t + l.price, 0));
    const linesChanged = JSON.stringify(lines) !== JSON.stringify(p.lines);
    const next: Purchase = {
      ...p,
      date: input.date,
      ...(input.time ? { time: input.time } : {}),
      store,
      spentBy: input.spentBy,
      purpose: input.purpose || undefined,
      lines,
      // a receipt keeps its printed total unless the lines changed
      total: p.source === 'receipt' && !linesChanged ? p.total : sum,
      editedBy: ctx.actor,
      editedAt: ctx.now,
    };
    if (!next.purpose) delete next.purpose;
    if (!input.time) delete next.time;
    const newYear = yearOfDate(input.date);
    const ops: Op[] = [...storeOps(ctx, store)];
    if (newYear !== year) {
      ops.push(
        ...ensureYearOps(ctx, newYear),
        O.budget(budgetFileName(year)).removePurchase(p.id),
        O.budget(budgetFileName(newYear)).upsertPurchase(next),
      );
    } else ops.push(O.budget(budgetFileName(year)).upsertPurchase(next));
    const changes: string[] = [];
    if (p.store !== store) changes.push(`Store: ${p.store} → ${store}`);
    if (p.date !== input.date) changes.push(`Date: ${dayLabel(p.date)} → ${dayLabel(input.date)}`);
    if (p.spentBy !== input.spentBy)
      changes.push(`Spent by: ${memberName(ctx, p.spentBy)} → ${memberName(ctx, input.spentBy)}`);
    if (p.total !== next.total) changes.push(`Total: ${money(p.total)} → ${money(next.total)}`);
    if (linesChanged) changes.push(`${plural(lines.length, 'item')} saved`);
    return {
      title: `Save the ${store} purchase`,
      lines: changes.length ? changes : ['No changes'],
      ops,
      result: p.id,
    };
  },
});

export const deletePurchase = defineAction({
  name: 'deletePurchase',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const found = findPurchase(ctx, id);
    if (!found)
      return { title: 'Delete purchase', lines: [], ops: [], blocked: 'This purchase is already gone.' };
    const { p, year } = found;
    const f = O.budget(budgetFileName(year));
    return {
      title: `Delete the ${p.store} purchase of ${money(p.total)}`,
      lines: [
        `${dayLabel(p.date)}, spent by ${memberName(ctx, p.spentBy)}, ${plural(p.lines.length, 'item')}`,
        'The money goes back into the pot. Stock is not changed.',
      ],
      ops: [
        f.removePurchase(id),
        f.logDeleted({ id: ctx.newId(), kind: 'purchase', by: ctx.actor, at: ctx.now, snapshot: p }),
      ],
      danger: true,
    };
  },
});

const contributionFields = {
  date,
  by: z.string().min(1),
  amount: z.number().positive('the amount must be above zero'),
  note: z.string().trim().optional(),
};

export const addContribution = defineAction({
  name: 'addContribution',
  input: z.object(contributionFields),
  plan(ctx, input) {
    const year = yearOfDate(input.date);
    const c: Contribution = {
      id: ctx.newId(),
      date: input.date,
      by: input.by,
      amount: round2(input.amount),
      ...(input.note ? { note: input.note } : {}),
      createdBy: ctx.actor,
      createdAt: ctx.now,
    };
    return {
      title: `${memberName(ctx, input.by)} adds ${money(c.amount)} to the pot`,
      lines: [`${dayLabel(input.date)}${input.note ? `, ${input.note}` : ''}`],
      ops: [...ensureYearOps(ctx, year), O.budget(budgetFileName(year)).upsertContribution(c)],
      result: c.id,
    };
  },
});

export const updateContribution = defineAction({
  name: 'updateContribution',
  input: z.object({ id: z.string(), ...contributionFields }),
  plan(ctx, input) {
    const found = findContribution(ctx, input.id);
    if (!found)
      return { title: 'Edit contribution', lines: [], ops: [], blocked: 'This contribution was deleted.' };
    const { c, year } = found;
    const next: Contribution = {
      ...c,
      date: input.date,
      by: input.by,
      amount: round2(input.amount),
      note: input.note || undefined,
      editedBy: ctx.actor,
      editedAt: ctx.now,
    };
    if (!next.note) delete next.note;
    const ny = yearOfDate(input.date);
    const ops: Op[] =
      ny === year
        ? [O.budget(budgetFileName(year)).upsertContribution(next)]
        : [
            ...ensureYearOps(ctx, ny),
            O.budget(budgetFileName(year)).removeContribution(c.id),
            O.budget(budgetFileName(ny)).upsertContribution(next),
          ];
    return { title: `Save ${memberName(ctx, input.by)}'s ${money(next.amount)}`, lines: [], ops };
  },
});

export const deleteContribution = defineAction({
  name: 'deleteContribution',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const found = findContribution(ctx, id);
    if (!found)
      return {
        title: 'Delete contribution',
        lines: [],
        ops: [],
        blocked: 'This contribution is already gone.',
      };
    const { c, year } = found;
    const f = O.budget(budgetFileName(year));
    return {
      title: `Delete ${memberName(ctx, c.by)}'s ${money(c.amount)}`,
      lines: [dayLabel(c.date)],
      ops: [
        f.removeContribution(id),
        f.logDeleted({ id: ctx.newId(), kind: 'contribution', by: ctx.actor, at: ctx.now, snapshot: c }),
      ],
      danger: true,
    };
  },
});

export const adjustPot = defineAction({
  name: 'adjustPot',
  input: z.object({
    date,
    amount: z
      .number()
      .finite()
      .refine((v) => v !== 0, 'the amount can’t be zero'),
    reason: z.string().trim().min(1, 'needs a reason'),
  }),
  plan(ctx, input) {
    const year = yearOfDate(input.date);
    const a: PotAdjustment = {
      id: ctx.newId(),
      date: input.date,
      by: ctx.me.email,
      amount: round2(input.amount),
      reason: input.reason,
      createdAt: ctx.now,
    };
    return {
      title: `Adjust the pot by ${money(a.amount, { sign: true })}`,
      lines: [`Reason: ${input.reason}`],
      ops: [...ensureYearOps(ctx, year), O.budget(budgetFileName(year)).upsertAdjustment(a)],
    };
  },
});

export const deleteAdjustment = defineAction({
  name: 'deleteAdjustment',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const found = findAdjustment(ctx, id);
    if (!found)
      return { title: 'Delete adjustment', lines: [], ops: [], blocked: 'This adjustment is already gone.' };
    const f = O.budget(budgetFileName(found.year));
    return {
      title: `Delete the ${money(found.a.amount, { sign: true })} adjustment`,
      lines: [found.a.reason],
      ops: [
        f.removeAdjustment(id),
        f.logDeleted({ id: ctx.newId(), kind: 'adjustment', by: ctx.actor, at: ctx.now, snapshot: found.a }),
      ],
      danger: true,
    };
  },
});

/** Puts a soft-deleted entry back. */
export const restoreDeleted = defineAction({
  name: 'restoreDeleted',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    for (const b of Object.values(ctx.snap.budgets)) {
      const d = b.deleted.find((x) => x.id === id);
      if (!d) continue;
      const f = O.budget(budgetFileName(b.year));
      const ops: Op[] = [{ t: 'remove', file: budgetFileName(b.year), coll: 'deleted', id }];
      if (d.kind === 'purchase') ops.push(f.upsertPurchase(d.snapshot as Purchase));
      if (d.kind === 'contribution') ops.push(f.upsertContribution(d.snapshot as Contribution));
      if (d.kind === 'adjustment') ops.push(f.upsertAdjustment(d.snapshot as PotAdjustment));
      return { title: 'Restore the deleted entry', lines: [], ops };
    }
    return { title: 'Restore', lines: [], ops: [], blocked: 'Nothing to restore.' };
  },
});
