import type { z } from 'zod';
import {
  SCHEMA_VERSION,
  budgetFile,
  householdFile,
  itemsFile,
  planFile,
  recipesFile,
  shoppingFile,
  usageFile,
  type BudgetFile,
  type HouseholdFile,
  type ItemsFile,
  type PlanFile,
  type RecipesFile,
  type ShoppingFile,
  type UsageFile,
} from './schemas';
import { DEFAULT_PLACES, DEFAULT_RECIPE_CATEGORIES } from './defaults';
import { migrateV1toV2 } from '../storage/migrations';

export type StaticFile = 'household' | 'items' | 'recipes' | 'plan' | 'shopping';
export type BudgetFileName = `budget-${number}`;
export type UsageFileName = `usage-${number}`;
export type DataFile = StaticFile | BudgetFileName | UsageFileName;

export interface FileTypes {
  household: HouseholdFile;
  items: ItemsFile;
  recipes: RecipesFile;
  plan: PlanFile;
  shopping: ShoppingFile;
}
export type FileData<F extends DataFile> = F extends keyof FileTypes
  ? FileTypes[F]
  : F extends BudgetFileName
    ? BudgetFile
    : UsageFile;

export const budgetFileName = (year: number): BudgetFileName => `budget-${year}`;
export const usageFileName = (year: number): UsageFileName => `usage-${year}`;
export const isBudgetFile = (f: string): f is BudgetFileName => /^budget-\d{4}$/.test(f);
export const isUsageFile = (f: string): f is UsageFileName => /^usage-\d{4}$/.test(f);
export const yearOf = (f: BudgetFileName | UsageFileName) => Number(f.slice(-4));
export const fileNameOnDisk = (f: DataFile) => `${f}.json`;

export const STATIC_FILES: StaticFile[] = ['household', 'items', 'recipes', 'plan', 'shopping'];

export function schemaFor(f: DataFile): z.ZodType<unknown> {
  if (isBudgetFile(f)) return budgetFile;
  if (isUsageFile(f)) return usageFile;
  switch (f) {
    case 'household':
      return householdFile;
    case 'items':
      return itemsFile;
    case 'recipes':
      return recipesFile;
    case 'plan':
      return planFile;
    case 'shopping':
      return shoppingFile;
  }
  throw new Error(`Unknown data file ${f as string}`);
}

const stamp = (by: string) => ({
  schemaVersion: SCHEMA_VERSION,
  updatedAt: new Date().toISOString(),
  updatedBy: by,
});

/** The content of a freshly created file. */
export function emptyFile(f: DataFile, by: string, opts: { openingBalance?: number } = {}): unknown {
  if (isBudgetFile(f))
    return {
      ...stamp(by),
      year: yearOf(f),
      openingBalance: opts.openingBalance ?? 0,
      contributions: [],
      purchases: [],
      adjustments: [],
      deleted: [],
    } satisfies BudgetFile;
  if (isUsageFile(f)) return { ...stamp(by), year: yearOf(f), usage: [], cooked: [] } satisfies UsageFile;
  switch (f) {
    case 'household':
      return {
        ...stamp(by),
        members: [],
        monthlyTarget: 0,
        // a real household starts empty and offers "Import your list" (5.2)
        categories: [],
        places: DEFAULT_PLACES,
        stores: [],
        recipeCategories: DEFAULT_RECIPE_CATEGORIES,
        years: [],
      } satisfies HouseholdFile;
    case 'items':
      return { ...stamp(by), items: [] } satisfies ItemsFile;
    case 'recipes':
      return { ...stamp(by), recipes: [] } satisfies RecipesFile;
    case 'plan':
      return { ...stamp(by), entries: [] } satisfies PlanFile;
    case 'shopping':
      return { ...stamp(by), items: [] } satisfies ShoppingFile;
  }
  throw new Error(`Unknown data file ${f as string}`);
}

/**
 * Migrations keyed on schemaVersion: each upgrades a file from version N to N+1.
 * They are pure and idempotent; see storage/migrations.ts.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>, f: DataFile) => Record<string, unknown>> = {
  1: migrateV1toV2,
};

export class DataValidationError extends Error {
  constructor(
    public file: DataFile,
    public issues: string,
  ) {
    super(`${fileNameOnDisk(file)} doesn't look right: ${issues}`);
    this.name = 'DataValidationError';
  }
}

/**
 * The file was saved by a newer version of the app. This version must not
 * write to it (it would drop fields it doesn't know); the person reloads.
 */
export class NewerVersionError extends Error {
  constructor(
    public file: DataFile,
    public version: number,
  ) {
    super('This app was updated on another phone. Reload to continue.');
    this.name = 'NewerVersionError';
  }
}

/** Validate (and migrate) a file read from storage. */
export function parseFile<F extends DataFile>(f: F, raw: unknown): FileData<F> {
  let obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let v = typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1;
  if (v > SCHEMA_VERSION) throw new NewerVersionError(f, v);
  while (v < SCHEMA_VERSION && MIGRATIONS[v]) {
    obj = MIGRATIONS[v](obj, f);
    v = obj.schemaVersion as number;
  }
  const res = schemaFor(f).safeParse(obj);
  if (!res.success) {
    const issues = res.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new DataValidationError(f, issues);
  }
  return res.data as FileData<F>;
}
