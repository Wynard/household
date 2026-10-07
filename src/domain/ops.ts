// Small, re-playable operations on data files.
//
// Every change in the app is expressed as a list of these. They are:
//   - applied to the cached file to write it,
//   - re-applied on top of a newer version when the other person changed the
//     file in the meantime (4.3),
//   - inverted against the state they were applied to, for undo (4.6).
// Operations are pure data (JSON-serialisable) and applying them is pure.

import type { DataFile } from './files';
import type {
  Contribution,
  CookedEntry,
  DeletedEntry,
  Item,
  PlanEntry,
  PotAdjustment,
  Purchase,
  Recipe,
  ShoppingItem,
  UsageEntry,
} from './schemas';

type Rec = { id: string } & Record<string, unknown>;

export type Op =
  /** Creates a file's content if it doesn't exist yet (year rollover). Never undone. */
  | { t: 'init'; file: DataFile; value: Record<string, unknown> }
  | { t: 'upsert'; file: DataFile; coll: string; value: Rec; index?: number }
  | { t: 'patch'; file: DataFile; coll: string; id: string; set: Record<string, unknown>; unset?: string[] }
  | { t: 'inc'; file: DataFile; coll: string; id: string; field: string; by: number; min?: number }
  | { t: 'remove'; file: DataFile; coll: string; id: string }
  | { t: 'setField'; file: DataFile; field: string; value: unknown }
  | { t: 'listAdd'; file: DataFile; field: string; value: string; index?: number }
  | { t: 'listRemove'; file: DataFile; field: string; value: string }
  | { t: 'listRename'; file: DataFile; field: string; from: string; to: string }
  | { t: 'listMove'; file: DataFile; field: string; value: string; index: number }
  | { t: 'catAdd'; file: 'household'; name: string; subcategories: string[]; index?: number }
  | { t: 'catRename'; file: 'household'; from: string; to: string }
  | { t: 'catRemove'; file: 'household'; name: string }
  | { t: 'subAdd'; file: 'household'; cat: string; name: string; index?: number }
  | { t: 'subRename'; file: 'household'; cat: string; from: string; to: string }
  | { t: 'subRemove'; file: 'household'; cat: string; name: string };

type FileObj = Record<string, unknown>;
const round = (n: number) => Math.round(n * 1e6) / 1e6;

function getColl(data: FileObj, coll: string): Rec[] {
  const v = data[coll];
  return Array.isArray(v) ? (v as Rec[]) : [];
}
function getList(data: FileObj, field: string): string[] {
  const v = data[field];
  return Array.isArray(v) ? (v as string[]) : [];
}
type Cat = { name: string; subcategories: string[] };
const getCats = (data: FileObj) => getList(data, 'categories') as unknown as Cat[];

const clampIndex = (i: number | undefined, len: number) =>
  i === undefined ? len : Math.max(0, Math.min(len, i));

/**
 * Applies one op to a file and returns the new file plus the ops that undo it
 * (evaluated against the state the op was applied to). `applied` is false when
 * the op had nothing to act on (e.g. patching a record the other person deleted).
 */
export function applyOne(data: FileObj, op: Op): { data: FileObj; inverse: Op[]; applied: boolean } {
  switch (op.t) {
    case 'init': {
      if (Object.keys(data).length > 0) return { data, inverse: [], applied: false };
      return { data: { ...op.value }, inverse: [], applied: true };
    }
    case 'upsert': {
      const list = getColl(data, op.coll);
      const i = list.findIndex((r) => r.id === op.value.id);
      if (i >= 0) {
        const next = list.slice();
        const old = next[i];
        next[i] = op.value;
        return {
          data: { ...data, [op.coll]: next },
          inverse: [{ t: 'upsert', file: op.file, coll: op.coll, value: old, index: i }],
          applied: true,
        };
      }
      const next = list.slice();
      next.splice(clampIndex(op.index, next.length), 0, op.value);
      return {
        data: { ...data, [op.coll]: next },
        inverse: [{ t: 'remove', file: op.file, coll: op.coll, id: op.value.id }],
        applied: true,
      };
    }
    case 'patch': {
      const list = getColl(data, op.coll);
      const i = list.findIndex((r) => r.id === op.id);
      if (i < 0) return { data, inverse: [], applied: false };
      const old = list[i];
      const updated: Rec = { ...old, ...op.set };
      for (const k of op.unset ?? []) delete updated[k];
      const invSet: Record<string, unknown> = {};
      const invUnset: string[] = [];
      for (const k of [...Object.keys(op.set), ...(op.unset ?? [])]) {
        if (k in old) invSet[k] = old[k];
        else invUnset.push(k);
      }
      const next = list.slice();
      next[i] = updated;
      return {
        data: { ...data, [op.coll]: next },
        inverse: [{ t: 'patch', file: op.file, coll: op.coll, id: op.id, set: invSet, unset: invUnset }],
        applied: true,
      };
    }
    case 'inc': {
      const list = getColl(data, op.coll);
      const i = list.findIndex((r) => r.id === op.id);
      if (i < 0) return { data, inverse: [], applied: false };
      const old = list[i];
      const before = typeof old[op.field] === 'number' ? (old[op.field] as number) : 0;
      let after = round(before + op.by);
      if (op.min !== undefined && after < op.min) after = op.min;
      const next = list.slice();
      next[i] = { ...old, [op.field]: after };
      const actual = round(after - before);
      return {
        data: { ...data, [op.coll]: next },
        inverse:
          actual === 0
            ? []
            : [{ t: 'inc', file: op.file, coll: op.coll, id: op.id, field: op.field, by: -actual }],
        applied: true,
      };
    }
    case 'remove': {
      const list = getColl(data, op.coll);
      const i = list.findIndex((r) => r.id === op.id);
      if (i < 0) return { data, inverse: [], applied: false };
      const next = list.slice();
      const [old] = next.splice(i, 1);
      return {
        data: { ...data, [op.coll]: next },
        inverse: [{ t: 'upsert', file: op.file, coll: op.coll, value: old, index: i }],
        applied: true,
      };
    }
    case 'setField': {
      const had = op.field in data;
      const old = data[op.field];
      const next = { ...data, [op.field]: op.value };
      return {
        data: next,
        inverse: had ? [{ t: 'setField', file: op.file, field: op.field, value: old }] : [],
        applied: true,
      };
    }
    case 'listAdd': {
      const list = getList(data, op.field);
      if (list.includes(op.value)) return { data, inverse: [], applied: false };
      const next = list.slice();
      next.splice(clampIndex(op.index, next.length), 0, op.value);
      return {
        data: { ...data, [op.field]: next },
        inverse: [{ t: 'listRemove', file: op.file, field: op.field, value: op.value }],
        applied: true,
      };
    }
    case 'listRemove': {
      const list = getList(data, op.field);
      const i = list.indexOf(op.value);
      if (i < 0) return { data, inverse: [], applied: false };
      return {
        data: { ...data, [op.field]: list.filter((x) => x !== op.value) },
        inverse: [{ t: 'listAdd', file: op.file, field: op.field, value: op.value, index: i }],
        applied: true,
      };
    }
    case 'listRename': {
      const list = getList(data, op.field);
      const i = list.indexOf(op.from);
      if (i < 0) return { data, inverse: [], applied: false };
      if (list.includes(op.to)) {
        // merge: the target already exists, so the old name just disappears
        return {
          data: { ...data, [op.field]: list.filter((x) => x !== op.from) },
          inverse: [{ t: 'listAdd', file: op.file, field: op.field, value: op.from, index: i }],
          applied: true,
        };
      }
      const next = list.slice();
      next[i] = op.to;
      return {
        data: { ...data, [op.field]: next },
        inverse: [{ t: 'listRename', file: op.file, field: op.field, from: op.to, to: op.from }],
        applied: true,
      };
    }
    case 'listMove': {
      const list = getList(data, op.field);
      const i = list.indexOf(op.value);
      if (i < 0) return { data, inverse: [], applied: false };
      const next = list.filter((x) => x !== op.value);
      next.splice(clampIndex(op.index, next.length), 0, op.value);
      return {
        data: { ...data, [op.field]: next },
        inverse: [{ t: 'listMove', file: op.file, field: op.field, value: op.value, index: i }],
        applied: true,
      };
    }
    case 'catAdd': {
      const cats = getCats(data);
      if (cats.some((c) => c.name === op.name)) return { data, inverse: [], applied: false };
      const next = cats.slice();
      next.splice(clampIndex(op.index, next.length), 0, {
        name: op.name,
        subcategories: op.subcategories.slice(),
      });
      return {
        data: { ...data, categories: next },
        inverse: [{ t: 'catRemove', file: 'household', name: op.name }],
        applied: true,
      };
    }
    case 'catRename': {
      const cats = getCats(data);
      const i = cats.findIndex((c) => c.name === op.from);
      if (i < 0 || cats.some((c) => c.name === op.to)) return { data, inverse: [], applied: false };
      const next = cats.slice();
      next[i] = { ...next[i], name: op.to };
      return {
        data: { ...data, categories: next },
        inverse: [{ t: 'catRename', file: 'household', from: op.to, to: op.from }],
        applied: true,
      };
    }
    case 'catRemove': {
      const cats = getCats(data);
      const i = cats.findIndex((c) => c.name === op.name);
      if (i < 0) return { data, inverse: [], applied: false };
      const old = cats[i];
      return {
        data: { ...data, categories: cats.filter((c) => c.name !== op.name) },
        inverse: [
          { t: 'catAdd', file: 'household', name: old.name, subcategories: old.subcategories, index: i },
        ],
        applied: true,
      };
    }
    case 'subAdd':
    case 'subRename':
    case 'subRemove': {
      const cats = getCats(data);
      const ci = cats.findIndex((c) => c.name === op.cat);
      if (ci < 0) return { data, inverse: [], applied: false };
      const subs = cats[ci].subcategories;
      let nextSubs: string[];
      let inverse: Op[];
      if (op.t === 'subAdd') {
        if (subs.includes(op.name)) return { data, inverse: [], applied: false };
        nextSubs = subs.slice();
        nextSubs.splice(clampIndex(op.index, nextSubs.length), 0, op.name);
        inverse = [{ t: 'subRemove', file: 'household', cat: op.cat, name: op.name }];
      } else if (op.t === 'subRename') {
        const si = subs.indexOf(op.from);
        if (si < 0 || subs.includes(op.to)) return { data, inverse: [], applied: false };
        nextSubs = subs.slice();
        nextSubs[si] = op.to;
        inverse = [{ t: 'subRename', file: 'household', cat: op.cat, from: op.to, to: op.from }];
      } else {
        const si = subs.indexOf(op.name);
        if (si < 0) return { data, inverse: [], applied: false };
        nextSubs = subs.filter((s) => s !== op.name);
        inverse = [{ t: 'subAdd', file: 'household', cat: op.cat, name: op.name, index: si }];
      }
      const next = cats.slice();
      next[ci] = { ...next[ci], subcategories: nextSubs };
      return { data: { ...data, categories: next }, inverse, applied: true };
    }
  }
}

/** Applies ops to a single file's data. */
export function applyOps<T>(data: T, ops: Op[]): T {
  let cur = data as unknown as FileObj;
  for (const op of ops) cur = applyOne(cur, op).data;
  return cur as unknown as T;
}

export type FileMap = Partial<Record<DataFile, unknown>>;

/**
 * Applies ops across several files. Returns the new files and the inverse ops
 * (already in undo order: applying `inverse` to `files` restores the input).
 */
export function applyOpsToFiles(files: FileMap, ops: Op[]): { files: FileMap; inverse: Op[]; skipped: Op[] } {
  const out: FileMap = { ...files };
  const inverse: Op[] = [];
  const skipped: Op[] = [];
  for (const op of ops) {
    const cur = (out[op.file] ?? {}) as FileObj;
    const r = applyOne(cur, op);
    out[op.file] = r.data;
    inverse.unshift(...r.inverse);
    if (!r.applied) skipped.push(op);
  }
  return { files: out, inverse, skipped };
}

export function groupByFile(ops: Op[]): Map<DataFile, Op[]> {
  const m = new Map<DataFile, Op[]>();
  for (const op of ops) {
    const list = m.get(op.file) ?? [];
    list.push(op);
    m.set(op.file, list);
  }
  return m;
}

// ---------- typed builders ----------
const asRec = (v: { id: string }) => v as unknown as Rec;
type BudgetF = `budget-${number}`;
type UsageF = `usage-${number}`;

export const O = {
  item: {
    upsert: (v: Item): Op => ({ t: 'upsert', file: 'items', coll: 'items', value: asRec(v) }),
    patch: (id: string, set: Partial<Item>, unset?: (keyof Item)[]): Op => ({
      t: 'patch',
      file: 'items',
      coll: 'items',
      id,
      set,
      unset: unset as string[] | undefined,
    }),
    inc: (id: string, by: number): Op => ({
      t: 'inc',
      file: 'items',
      coll: 'items',
      id,
      field: 'quantity',
      by,
      min: 0,
    }),
    remove: (id: string): Op => ({ t: 'remove', file: 'items', coll: 'items', id }),
  },
  recipe: {
    upsert: (v: Recipe): Op => ({ t: 'upsert', file: 'recipes', coll: 'recipes', value: asRec(v) }),
    patch: (id: string, set: Partial<Recipe>): Op => ({
      t: 'patch',
      file: 'recipes',
      coll: 'recipes',
      id,
      set,
    }),
    remove: (id: string): Op => ({ t: 'remove', file: 'recipes', coll: 'recipes', id }),
  },
  plan: {
    upsert: (v: PlanEntry): Op => ({ t: 'upsert', file: 'plan', coll: 'entries', value: asRec(v) }),
    patch: (id: string, set: Partial<PlanEntry>): Op => ({
      t: 'patch',
      file: 'plan',
      coll: 'entries',
      id,
      set,
    }),
    remove: (id: string): Op => ({ t: 'remove', file: 'plan', coll: 'entries', id }),
  },
  shop: {
    upsert: (v: ShoppingItem): Op => ({ t: 'upsert', file: 'shopping', coll: 'items', value: asRec(v) }),
    patch: (id: string, set: Partial<ShoppingItem>, unset?: (keyof ShoppingItem)[]): Op => ({
      t: 'patch',
      file: 'shopping',
      coll: 'items',
      id,
      set,
      unset: unset as string[] | undefined,
    }),
    remove: (id: string): Op => ({ t: 'remove', file: 'shopping', coll: 'items', id }),
  },
  budget: (file: BudgetF) => ({
    upsertContribution: (v: Contribution): Op => ({
      t: 'upsert',
      file,
      coll: 'contributions',
      value: asRec(v),
    }),
    removeContribution: (id: string): Op => ({ t: 'remove', file, coll: 'contributions', id }),
    upsertPurchase: (v: Purchase): Op => ({ t: 'upsert', file, coll: 'purchases', value: asRec(v) }),
    patchPurchase: (id: string, set: Partial<Purchase>): Op => ({
      t: 'patch',
      file,
      coll: 'purchases',
      id,
      set,
    }),
    removePurchase: (id: string): Op => ({ t: 'remove', file, coll: 'purchases', id }),
    upsertAdjustment: (v: PotAdjustment): Op => ({ t: 'upsert', file, coll: 'adjustments', value: asRec(v) }),
    removeAdjustment: (id: string): Op => ({ t: 'remove', file, coll: 'adjustments', id }),
    logDeleted: (v: DeletedEntry): Op => ({ t: 'upsert', file, coll: 'deleted', value: asRec(v) }),
    setOpening: (value: number): Op => ({ t: 'setField', file, field: 'openingBalance', value }),
  }),
  usage: (file: UsageF) => ({
    add: (v: UsageEntry): Op => ({ t: 'upsert', file, coll: 'usage', value: asRec(v) }),
    patch: (id: string, set: Partial<UsageEntry>): Op => ({ t: 'patch', file, coll: 'usage', id, set }),
    addCooked: (v: CookedEntry): Op => ({ t: 'upsert', file, coll: 'cooked', value: asRec(v) }),
  }),
  household: {
    set: (field: string, value: unknown): Op => ({ t: 'setField', file: 'household', field, value }),
    listAdd: (field: 'places' | 'stores' | 'recipeCategories', value: string, index?: number): Op => ({
      t: 'listAdd',
      file: 'household',
      field,
      value,
      index,
    }),
    listRemove: (field: 'places' | 'stores' | 'recipeCategories', value: string): Op => ({
      t: 'listRemove',
      file: 'household',
      field,
      value,
    }),
    listRename: (field: 'places' | 'stores' | 'recipeCategories', from: string, to: string): Op => ({
      t: 'listRename',
      file: 'household',
      field,
      from,
      to,
    }),
    listMove: (field: 'places' | 'stores' | 'recipeCategories', value: string, index: number): Op => ({
      t: 'listMove',
      file: 'household',
      field,
      value,
      index,
    }),
    addYear: (year: number): Op => ({
      t: 'listAdd',
      file: 'household',
      field: 'years',
      value: year as unknown as string,
    }),
    catAdd: (name: string, subcategories: string[]): Op => ({
      t: 'catAdd',
      file: 'household',
      name,
      subcategories,
    }),
    catRename: (from: string, to: string): Op => ({ t: 'catRename', file: 'household', from, to }),
    catRemove: (name: string): Op => ({ t: 'catRemove', file: 'household', name }),
    subAdd: (cat: string, name: string): Op => ({ t: 'subAdd', file: 'household', cat, name }),
    subRename: (cat: string, from: string, to: string): Op => ({
      t: 'subRename',
      file: 'household',
      cat,
      from,
      to,
    }),
    subRemove: (cat: string, name: string): Op => ({ t: 'subRemove', file: 'household', cat, name }),
  },
};
