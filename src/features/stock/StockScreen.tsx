import { useMemo, useRef, useState } from 'react';
import { useRun, useSnapshot } from '../../app/data';
import { useScreenContext } from '../../app/assistantUi';
import { prefs } from '../../app/prefs';
import { Chip, EmptyState, Loading, PageHeader, Seg, Stepper } from '../../ui/controls';
import { stepFor, stockStatus, type StockStatus } from '../../domain/stock';
import { normalise } from '../../domain/categorise';
import { qty } from '../../domain/format';
import type { Item } from '../../domain/schemas';
import { ItemEditor } from './ItemEditor';
import type { ActionPlan } from '../../domain/actions';

type Filter = 'all' | 'low' | 'out';
type Group = 'place' | 'category';

const BADGE: Record<Exclude<StockStatus, 'ok'>, { label: string; cls: string }> = {
  out: { label: 'Out', cls: 'tag tag-red' },
  low: { label: 'Running low', cls: 'tag tag-saffron' },
};

/** Toast text after a stepper change: only speak up when the shopping list changed. */
function stepToast(plan: ActionPlan): string {
  const added = plan.ops.filter((o) => o.file === 'shopping' && o.t === 'upsert').length;
  const removed = plan.ops.filter((o) => o.file === 'shopping' && o.t === 'remove').length;
  const name = plan.title.split(':')[0];
  if (added) return `${name} is running low, so it's on the shopping list`;
  if (removed) return `${name} is back in stock and off the shopping list`;
  return 'Saved';
}

export function StockScreen() {
  useScreenContext('stock', 'Looking at Stock');
  const { snap, error, refetch } = useSnapshot();
  const { run } = useRun();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroupState] = useState<Group>(() => prefs.ui().stockGroup);
  const [editing, setEditing] = useState<string | null | undefined>(undefined); // undefined = closed, null = new

  const setGroup = (g: Group) => {
    prefs.setUi({ stockGroup: g });
    setGroupState(g);
  };

  const shown = useMemo(
    () => (snap ? snap.items.items.filter((i) => i.showInStock && !i.archived) : []),
    [snap],
  );
  const counts = useMemo(() => {
    let low = 0;
    let out = 0;
    for (const i of shown) {
      const s = stockStatus(i);
      if (s === 'low') low++;
      if (s === 'out') out++;
    }
    return { low, out };
  }, [shown]);

  const groups = useMemo(() => {
    if (!snap) return [];
    const q = normalise(query);
    const visible = shown.filter(
      (i) =>
        (filter === 'all' || stockStatus(i) === filter) &&
        (!q || normalise(`${i.name} ${i.subcategory} ${i.category} ${i.aliases.join(' ')}`).includes(q)),
    );
    const keys = group === 'place' ? snap.household.places : snap.household.categories.map((c) => c.name);
    const keyOf = (i: Item) => (group === 'place' ? i.place : i.category);
    const out = keys.map((k) => ({ name: k, items: visible.filter((i) => keyOf(i) === k) }));
    // items whose place/category isn't in the list any more still show up
    const orphans = visible.filter((i) => !keys.includes(keyOf(i)));
    if (orphans.length) out.push({ name: 'Other', items: orphans });
    return out.filter((g) => g.items.length);
  }, [snap, shown, query, filter, group]);

  if (error)
    return (
      <EmptyState>
        {error.message}{' '}
        <button type="button" className="link-btn" onClick={refetch}>
          Try again
        </button>
      </EmptyState>
    );
  if (!snap) return <Loading text="Loading your stock…" />;

  const step = (it: Item, dir: 1 | -1) =>
    void run('adjustStock', { itemId: it.id, delta: dir * stepFor(it) }, { toast: stepToast });

  return (
    <>
      <PageHeader title="Stock">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          style={{ height: 44 }}
          onClick={() => setEditing(null)}
        >
          Add item
        </button>
      </PageHeader>
      <p className="summary">
        {shown.length} items, {counts.low} running low, {counts.out} out
      </p>
      <input
        type="search"
        className="input search"
        aria-label="Search stock"
        placeholder="Search stock"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="wrap" style={{ marginTop: 12 }}>
        <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        <Chip pressed={filter === 'low'} onClick={() => setFilter('low')}>
          Running low {counts.low}
        </Chip>
        <Chip pressed={filter === 'out'} onClick={() => setFilter('out')}>
          Out {counts.out}
        </Chip>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <span className="small muted">Group by</span>
        <div style={{ width: 210 }}>
          <Seg
            small
            label="Group by"
            value={group}
            onChange={setGroup}
            options={[
              ['place', 'Location'],
              ['category', 'Category'],
            ]}
          />
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.name} aria-label={g.name}>
          <h2 className="group-title">{g.name}</h2>
          <div className="list">
            {g.items.map((it) => (
              <StockRow
                key={it.id}
                item={it}
                sub={
                  group === 'place'
                    ? `${it.category} › ${it.subcategory}`
                    : `${it.subcategory}, ${it.place.toLowerCase()}`
                }
                onEdit={() => setEditing(it.id)}
                onDec={() => step(it, -1)}
                onInc={() => step(it, 1)}
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 &&
        (shown.length === 0 ? (
          <EmptyState>Nothing in stock yet. Tap Add item, or scan a receipt with the Assistant.</EmptyState>
        ) : (
          <EmptyState>Nothing matches. Clear the search or pick another filter.</EmptyState>
        ))}

      {editing !== undefined && <ItemEditor itemId={editing} onClose={() => setEditing(undefined)} />}
    </>
  );
}

function StockRow({
  item,
  sub,
  onEdit,
  onDec,
  onInc,
}: {
  item: Item;
  sub: string;
  onEdit: () => void;
  onDec: () => void;
  onInc: () => void;
}) {
  const st = stockStatus(item);
  const s = stepFor(item);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // long-press anywhere on the row opens the editor too
  const longPress = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.stepper')) return;
      press.current = setTimeout(onEdit, 550);
    },
    onPointerUp: () => clearTimeout(press.current),
    onPointerLeave: () => clearTimeout(press.current),
    onPointerCancel: () => clearTimeout(press.current),
  };
  return (
    <div className="stock-row" {...longPress}>
      <div className="grow">
        <button type="button" className="stock-name" aria-label={`Edit ${item.name}`} onClick={onEdit}>
          {item.name}
        </button>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {st !== 'ok' && <span className={BADGE[st].cls}>{BADGE[st].label}</span>}
          <span className="small muted">{sub}</span>
        </div>
      </div>
      <Stepper
        value={qty(item.quantity, item.unit)}
        decLabel={`Remove ${qty(s, item.unit)} of ${item.name}`}
        incLabel={`Add ${qty(s, item.unit)} of ${item.name}`}
        decDisabled={item.quantity <= 0}
        onDec={onDec}
        onInc={onInc}
      />
    </div>
  );
}
