// Imports a budget history (rows read from a spreadsheet by domain/budgetImport)
// into the pot in one undoable step.
import { z } from 'zod';
import { defineAction } from './types';
import { O, type Op } from '../ops';
import { budgetCategoryUse, ensureYearOps } from '../budget';
import { budgetFileName } from '../files';
import { yearOfDate } from '../dates';
import { dayLabel, money, plural, round2 } from '../format';
import { netOf, splitDuplicates, type ImportEntry } from '../budgetImport';
import type { Contribution, PotAdjustment, Purchase } from '../schemas';

const entry = z.object({
  kind: z.enum(['in', 'out']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  by: z.string().min(1),
  category: z.string().min(1).optional(),
  description: z.string().trim().min(1).optional(),
});

/**
 * What happens to the amount the pot started with in the app (typed in at
 * setup) once older history comes in:
 * - keep: the pot shows what it shows now; a correction on the day the app's
 *   own history starts bridges the sheet's balance to that starting amount;
 * - sheet: the pot starts from the sheet; the starting amount is dropped.
 */
export const POT_MODES = ['keep', 'sheet'] as const;

export const importBudget = defineAction({
  name: 'importBudget',
  input: z.object({
    entries: z.array(entry).min(1, 'nothing to import'),
    potMode: z.enum(POT_MODES).default('sheet'),
    /** budget categories nothing will use after the import (e.g. unused defaults) */
    removeCategories: z.array(z.string()).default([]),
  }),
  plan(ctx, input) {
    const title = 'Import the budget history';
    const blocked = (why: string) => ({ title, lines: [], ops: [], blocked: why });
    const members = ctx.snap.household.members.map((m) => m.email);
    const stranger = input.entries.find((e) => !members.includes(e.by));
    if (stranger) return blocked(`Choose who ${stranger.by} is.`);

    const budgets = Object.values(ctx.snap.budgets);
    const { fresh, duplicates } = splitDuplicates(input.entries as ImportEntry[], budgets);
    if (!fresh.length)
      return blocked(`Everything in this sheet is already in the app (${plural(duplicates, 'row')}).`);

    const ops: Op[] = [];
    const known = ctx.snap.household.budgetCategories;
    // new categories, most used first (the order of the buttons when adding a purchase)
    const uses = new Map<string, number>();
    for (const e of fresh)
      if (e.kind === 'out' && e.category && !known.includes(e.category))
        uses.set(e.category, (uses.get(e.category) ?? 0) + 1);
    const newCats = [...uses].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    ops.push(...newCats.map((c) => O.household.listAdd('budgetCategories', c)));

    // the app's own history before this import, for the starting amount
    const existing = budgets.slice().sort((a, b) => a.year - b.year);
    const earliest = existing[0];
    const startAmount = earliest?.openingBalance ?? 0;
    const appDates = existing.flatMap((b) => [
      ...b.contributions.map((c) => c.date),
      ...b.purchases.map((p) => p.date),
      ...b.adjustments.map((a) => a.date),
    ]);
    const appStart = appDates.length ? appDates.reduce((m, d) => (d < m ? d : m)) : ctx.today;
    const net = netOf(fresh);
    const correction = input.potMode === 'keep' ? round2(startAmount - net) : 0;

    const years = new Set(fresh.map((e) => yearOfDate(e.date)));
    if (correction) years.add(yearOfDate(appStart));
    for (const y of [...years].sort()) ops.push(...ensureYearOps(ctx, y));
    // the starting amount now lives in the history (or is dropped), never in an opening balance
    if (earliest && startAmount !== 0) ops.push(O.budget(budgetFileName(earliest.year)).setOpening(0));

    // createdAt a millisecond apart keeps the sheet's order within a day
    const t0 = Date.parse(ctx.now);
    fresh.forEach((e, i) => {
      const createdAt = new Date(t0 + i).toISOString();
      const f = O.budget(budgetFileName(yearOfDate(e.date)));
      if (e.kind === 'in') {
        const c: Contribution = {
          id: ctx.newId(),
          date: e.date,
          by: e.by,
          amount: round2(e.amount),
          ...(e.description ? { note: e.description } : {}),
          createdBy: ctx.actor,
          createdAt,
        };
        ops.push(f.upsertContribution(c));
      } else {
        const p: Purchase = {
          id: ctx.newId(),
          date: e.date,
          ...(e.category ? { category: e.category } : {}),
          spentBy: e.by,
          ...(e.description ? { purpose: e.description } : {}),
          lines: [],
          total: round2(e.amount),
          source: 'import',
          createdBy: ctx.actor,
          createdAt,
        };
        ops.push(f.upsertPurchase(p));
      }
    });
    if (correction) {
      const a: PotAdjustment = {
        id: ctx.newId(),
        date: appStart,
        by: ctx.me.email,
        amount: correction,
        reason: 'Keeps the pot as it was before importing the old history',
        createdAt: new Date(t0 + fresh.length).toISOString(),
      };
      ops.push(O.budget(budgetFileName(yearOfDate(appStart))).upsertAdjustment(a));
    }

    // categories nobody uses, only if still unused afterwards
    const usedAfter = (c: string) =>
      budgetCategoryUse(budgets, c) + fresh.filter((e) => e.kind === 'out' && e.category === c).length;
    const removed = input.removeCategories.filter((c) => known.includes(c) && usedAfter(c) === 0);
    ops.push(...removed.map((c) => O.household.listRemove('budgetCategories', c)));

    const ins = fresh.filter((e) => e.kind === 'in').length;
    const dates = fresh.map((e) => e.date).sort();
    const lines = [
      `${plural(fresh.length - ins, 'payment')} and ${plural(ins, 'contribution')}, ${dayLabel(dates[0])} to ${dayLabel(dates[dates.length - 1])}`,
      `Adds up to ${money(net, { sign: true })}`,
    ];
    if (duplicates) lines.push(`${plural(duplicates, 'row')} already in the app, skipped`);
    if (newCats.length) lines.push(`New categories: ${newCats.join(', ')}`);
    if (removed.length) lines.push(`Removed unused categories: ${removed.join(', ')}`);
    if (correction) lines.push(`Correction of ${money(correction, { sign: true })} on ${dayLabel(appStart)}`);
    return {
      title: `Import ${plural(fresh.length, 'row')}`,
      lines,
      ops,
      result: { added: fresh.length, duplicates },
    };
  },
});
