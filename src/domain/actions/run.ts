import {
  ActionBlockedError,
  touchedCount,
  type ActionDef,
  type ActionPlan,
  type Ctx,
  type Snapshot,
} from './types';
import type { DataFile } from '../files';
import { applyOpsToFiles, type FileMap, type Op } from '../ops';
import { budgetFileName, usageFileName } from '../files';

/** Validates the input and computes the plan (preview + ops). Never writes. */
export function planAction<I, R>(def: ActionDef<I, R>, ctx: Ctx, rawInput: unknown): ActionPlan<R> {
  const parsed = def.input.safeParse(rawInput);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return {
      title: def.name,
      lines: [],
      ops: [],
      blocked: `Something's missing: ${i.path.join('.') || 'input'} ${i.message.toLowerCase()}`,
    };
  }
  const plan = def.plan(ctx, parsed.data);
  const danger = plan.danger || touchedCount(plan.ops) > 10;
  return { ...plan, danger };
}

/** Same as planAction but throws when the action is blocked. */
export function planOrThrow<I, R>(def: ActionDef<I, R>, ctx: Ctx, rawInput: unknown): ActionPlan<R> {
  const p = planAction(def, ctx, rawInput);
  if (p.blocked) throw new ActionBlockedError(p.blocked);
  return p;
}

/** Snapshot as a FileMap, for applying ops in memory (tests, previews). */
export function snapshotToFiles(s: Snapshot): FileMap {
  const files: FileMap = {
    household: s.household,
    items: s.items,
    recipes: s.recipes,
    plan: s.plan,
    shopping: s.shopping,
  };
  for (const [y, b] of Object.entries(s.budgets)) files[budgetFileName(Number(y))] = b;
  for (const [y, u] of Object.entries(s.usage)) files[usageFileName(Number(y))] = u;
  return files;
}

export function filesToSnapshot(files: FileMap): Snapshot {
  const budgets: Snapshot['budgets'] = {};
  const usage: Snapshot['usage'] = {};
  for (const [k, v] of Object.entries(files) as [DataFile, unknown][]) {
    if (/^budget-\d{4}$/.test(k)) budgets[Number(k.slice(-4))] = v as Snapshot['budgets'][number];
    if (/^usage-\d{4}$/.test(k)) usage[Number(k.slice(-4))] = v as Snapshot['usage'][number];
  }
  return {
    household: files.household as Snapshot['household'],
    items: files.items as Snapshot['items'],
    recipes: files.recipes as Snapshot['recipes'],
    plan: files.plan as Snapshot['plan'],
    shopping: files.shopping as Snapshot['shopping'],
    budgets,
    usage,
  };
}

/** Applies ops to a snapshot in memory; returns the new snapshot and the undo ops. */
export function applyToSnapshot(s: Snapshot, ops: Op[]): { snap: Snapshot; inverse: Op[] } {
  const r = applyOpsToFiles(snapshotToFiles(s), ops);
  return { snap: filesToSnapshot(r.files), inverse: r.inverse };
}
