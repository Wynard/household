import { z } from 'zod';
import { defineAction } from './types';
import { O, type Op } from '../ops';
import { dayLabel, plural } from '../format';
import { format, parseISO } from 'date-fns';

const WEEKDAY = (date: string) => format(parseISO(date), 'EEEE');

export const setPlanEntries = defineAction({
  name: 'setPlanEntries',
  input: z.object({
    entries: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          slot: z.enum(['lunch', 'dinner']),
          recipeId: z.string(),
          servings: z.number().int().positive(),
        }),
      )
      .min(1),
  }),
  plan(ctx, { entries }) {
    const ops: Op[] = [];
    const lines: string[] = [];
    for (const e of entries) {
      const r = ctx.snap.recipes.recipes.find((x) => x.id === e.recipeId);
      if (!r)
        return {
          title: 'Plan meals',
          lines: [],
          ops: [],
          blocked: "One of those recipes doesn't exist any more.",
        };
      const cur = ctx.snap.plan.entries.find((x) => x.date === e.date && x.slot === e.slot);
      const curR = cur ? ctx.snap.recipes.recipes.find((x) => x.id === cur.recipeId) : undefined;
      if (cur && cur.recipeId === e.recipeId && cur.servings === e.servings && !cur.cooked) continue;
      if (cur) ops.push(O.plan.remove(cur.id));
      ops.push(O.plan.upsert({ id: ctx.newId(), ...e }));
      lines.push(
        `${WEEKDAY(e.date)} ${e.slot}, ${dayLabel(e.date)}: ${r.title}, serves ${e.servings}${curR && curR.id !== r.id ? ` (replaces ${curR.title})` : ''}`,
      );
    }
    return {
      title: entries.length === 1 ? 'Add to the plan' : `Plan ${plural(entries.length, 'meal')}`,
      lines,
      ops,
      blocked: ops.length ? undefined : "That's already the plan.",
    };
  },
});

export const removePlanEntry = defineAction({
  name: 'removePlanEntry',
  input: z.object({ id: z.string() }),
  plan(ctx, { id }) {
    const e = ctx.snap.plan.entries.find((x) => x.id === id);
    if (!e)
      return {
        title: 'Remove from the plan',
        lines: [],
        ops: [],
        blocked: 'That meal is no longer on the plan.',
      };
    const r = ctx.snap.recipes.recipes.find((x) => x.id === e.recipeId);
    return {
      title: `Remove ${r?.title ?? 'meal'} from the plan`,
      lines: [`${WEEKDAY(e.date)} ${e.slot}, ${dayLabel(e.date)}`],
      ops: [O.plan.remove(id)],
    };
  },
});
