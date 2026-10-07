import type { z } from 'zod';
import type { DataFile } from '../files';
import type { Op } from '../ops';
import type {
  BudgetFile,
  HouseholdFile,
  ItemsFile,
  Member,
  PlanFile,
  RecipesFile,
  ShoppingFile,
  UsageFile,
} from '../schemas';

/** Everything an action may read, taken from the cache at the moment it runs. */
export interface Snapshot {
  household: HouseholdFile;
  items: ItemsFile;
  recipes: RecipesFile;
  plan: PlanFile;
  shopping: ShoppingFile;
  /** keyed by year; only years that were loaded */
  budgets: Record<number, BudgetFile>;
  usage: Record<number, UsageFile>;
}

export interface Ctx {
  snap: Snapshot;
  me: Member;
  /** "Ana", or "Assistant, approved by Ana" — written into audit fields */
  actor: string;
  today: string; // YYYY-MM-DD
  now: string; // ISO timestamp
  newId: () => string;
}

export interface Preview {
  title: string;
  lines: string[];
  /** Deletions and changes touching more than 10 records need a second tap. */
  danger?: boolean;
}

export interface ActionPlan<R = unknown> extends Preview {
  ops: Op[];
  /** When set, the action can't run and this says why (shown on buttons and cards). */
  blocked?: string;
  /** Data the caller may want afterwards, e.g. the id of a created record. */
  result?: R;
}

export interface ActionDef<I = unknown, R = unknown> {
  name: string;
  /** Output type I; the raw input may differ (defaults, coercion). */
  input: z.ZodType<I, z.ZodTypeDef, unknown>;
  /** Extra files the action needs loaded (e.g. a past year's budget). */
  needs?: (input: I) => DataFile[];
  plan: (ctx: Ctx, input: I) => ActionPlan<R>;
}

export function defineAction<I, R = unknown>(def: ActionDef<I, R>): ActionDef<I, R> {
  return def;
}

export class ActionBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActionBlockedError';
  }
}

/** "Assistant, approved by Ana" */
export const assistantActor = (name: string) => `Assistant, approved by ${name}`;
export const isAssistantActor = (actor: string | undefined) => !!actor && actor.startsWith('Assistant');

/** Counts records an op list touches (for the >10 records rule). */
export function touchedCount(ops: Op[]): number {
  const keys = new Set<string>();
  for (const o of ops) {
    if ('id' in o) keys.add(`${o.file}:${o.id}`);
    else if (o.t === 'upsert') keys.add(`${o.file}:${o.value.id}`);
    else keys.add(`${o.file}:${o.t}`);
  }
  return keys.size;
}
