import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { DataStore, fileKey, type Loaded } from '../storage/store';
import { STATIC_FILES, budgetFileName, usageFileName, type DataFile, type FileData } from '../domain/files';
import {
  ACTIONS,
  planAction,
  type ActionName,
  type ActionPlan,
  type Ctx,
  type Snapshot,
} from '../domain/actions';
import { assistantActor } from '../domain/actions/types';
import type { Op } from '../domain/ops';
import type { HouseholdFile, Member } from '../domain/schemas';
import { nowISO, todayISO, yearOfDate } from '../domain/dates';
import { useToast } from '../ui/Toast';
import { useSession } from '../auth/session';

const StoreCtx = createContext<DataStore | null>(null);

export function DataProvider({ store, children }: { store: DataStore; children: ReactNode }) {
  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

export function useStore(): DataStore {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore outside DataProvider');
  return s;
}

export function useFile<F extends DataFile>(f: F) {
  const store = useStore();
  return useQuery<Loaded<FileData<F>>>({ queryKey: fileKey(f), queryFn: () => store.load(f) });
}

/** Years whose budget/usage files belong in the snapshot. */
function yearsFor(h: HouseholdFile | undefined): number[] {
  const ys = new Set(h?.years ?? []);
  ys.add(yearOfDate(todayISO()));
  return [...ys].sort();
}

/**
 * Everything the screens and actions read, combined. `snap` is undefined until
 * every file has loaded.
 */
export function useSnapshot(): {
  snap?: Snapshot;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const store = useStore();
  const household = useFile('household');
  const years = yearsFor(household.data?.data);
  const files: DataFile[] = [
    ...STATIC_FILES,
    ...years.flatMap((y) => [budgetFileName(y), usageFileName(y)] as DataFile[]),
  ];
  const results = useQueries({
    queries: files.map((f) => ({ queryKey: fileKey(f), queryFn: () => store.load(f) })),
  });
  const loading = results.some((r) => r.isPending);
  const error = (results.find((r) => r.error)?.error as Error | undefined) ?? null;
  const dataStamp = results.map((r) => r.dataUpdatedAt).join(',');
  const snap = useMemo(() => {
    // every file must have loaded; a failed one (e.g. newer version) leaves the snapshot empty
    if (loading || results.some((r) => !r.data)) return undefined;
    const by = new Map(files.map((f, i) => [f, results[i].data as Loaded<unknown> | undefined]));
    const get = <T,>(f: DataFile) => by.get(f)?.data as T;
    const budgets: Snapshot['budgets'] = {};
    const usage: Snapshot['usage'] = {};
    for (const y of years) {
      const b = by.get(budgetFileName(y));
      const u = by.get(usageFileName(y));
      // a year file that doesn't exist yet stays out, so the year rollover runs
      if (b && b.version !== null) budgets[y] = b.data as Snapshot['budgets'][number];
      if (u && u.version !== null) usage[y] = u.data as Snapshot['usage'][number];
    }
    return {
      household: get('household'),
      items: get('items'),
      recipes: get('recipes'),
      plan: get('plan'),
      shopping: get('shopping'),
      budgets,
      usage,
    } satisfies Snapshot;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, dataStamp]);
  const refetch = useCallback(() => void store.refreshAll(), [store]);
  return { snap, loading, error, refetch };
}

/** Builds a fresh Ctx from the cache (not React state), so it is never stale. */
export async function buildCtx(
  store: DataStore,
  me: Member,
  opts: { viaAssistant?: boolean } = {},
): Promise<Ctx> {
  const h = (await store.ensure('household')).data;
  const years = yearsFor(h);
  const [items, recipes, plan, shopping] = await Promise.all([
    store.ensure('items'),
    store.ensure('recipes'),
    store.ensure('plan'),
    store.ensure('shopping'),
  ]);
  const budgets: Snapshot['budgets'] = {};
  const usage: Snapshot['usage'] = {};
  await Promise.all(
    years.map(async (y) => {
      const [b, u] = await Promise.all([store.ensure(budgetFileName(y)), store.ensure(usageFileName(y))]);
      if (b.version !== null) budgets[y] = b.data;
      if (u.version !== null) usage[y] = u.data;
    }),
  );
  let n = 0;
  return {
    snap: {
      household: h,
      items: items.data,
      recipes: recipes.data,
      plan: plan.data,
      shopping: shopping.data,
      budgets,
      usage,
    },
    me,
    actor: opts.viaAssistant ? assistantActor(me.name) : me.name,
    today: todayISO(),
    now: nowISO(),
    newId: () =>
      typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${++n}`,
  };
}

export interface RunOpts {
  /** Toast text on success; false for none. Default "Saved". */
  toast?: string | false | ((plan: ActionPlan) => string);
  /** Offer Undo in the toast (default true). */
  undo?: boolean;
  viaAssistant?: boolean;
}

export interface RunResult<R = unknown> {
  plan: ActionPlan<R>;
  inverse: Op[];
}

export function useMe(): Member | undefined {
  const { email } = useSession();
  const h = useFile('household').data?.data;
  return (
    h?.members.find((m) => m.email === email) ??
    (email ? { email, name: email.split('@')[0], color: '' } : undefined)
  );
}

/**
 * Runs an action through the actions layer. UI buttons use this directly
 * (no preview step). Shows "Saved" with Undo, or an error with Try again.
 */
export function useRun() {
  const store = useStore();
  const toast = useToast();
  const me = useMe();

  const undo = useCallback(
    async (inverse: Op[]) => {
      try {
        await store.commit(inverse);
        toast.show('Undone');
      } catch (e) {
        toast.error(errorText(e), () => void undo(inverse));
      }
    },
    [store, toast],
  );

  const run = useCallback(
    async <N extends ActionName>(name: N, input: unknown, opts: RunOpts = {}): Promise<RunResult | null> => {
      if (!me) return null;
      try {
        const ctx = await buildCtx(store, me, { viaAssistant: opts.viaAssistant });
        const plan = planAction(ACTIONS[name] as never, ctx, input) as ActionPlan;
        if (plan.blocked) {
          toast.show(plan.blocked);
          return null;
        }
        const { inverse } = await store.commit(plan.ops);
        const text = typeof opts.toast === 'function' ? opts.toast(plan) : (opts.toast ?? 'Saved');
        if (text !== false) toast.show(text, opts.undo === false ? {} : { undo: () => void undo(inverse) });
        return { plan, inverse };
      } catch (e) {
        toast.error(errorText(e), () => void run(name, input, opts));
        return null;
      }
    },
    [store, me, toast, undo],
  );

  return { run, undo };
}

export function errorText(e: unknown): string {
  if (e instanceof Error) {
    if (/fetch|network/i.test(e.message)) return "Couldn't reach Google Drive. Check your connection.";
    return e.message;
  }
  return 'Something went wrong.';
}
