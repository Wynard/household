import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRun, useSnapshot } from '../../app/data';
import { useScreenContext } from '../../app/assistantUi';
import { prefs } from '../../app/prefs';
import { Chip, EmptyState, Loading, PageHeader, Seg, Stepper, SearchField } from '../../ui/controls';
import { isSimple, stepFor, stockStatus, type StockStatus } from '../../domain/stock';
import { normalise } from '../../domain/categorise';
import { catLabel, qty } from '../../domain/format';
import type { Item } from '../../domain/schemas';
import { ItemEditor } from './ItemEditor';
import { StatusControl } from '../../ui/StatusControl';
import type { ActionPlan } from '../../domain/actions';

type Filter = 'all' | 'low' | 'out';
type Group = 'place' | 'category';

const BADGE: Record<Exclude<StockStatus, 'have'>, { label: string; cls: string }> = {
  out: { label: 'Out', cls: 'tag tag-red' },
  low: { label: 'Low', cls: 'tag tag-saffron' },
};

/** Toast text after a stock change: only speak up when the shopping list changed. */
function stockToast(plan: ActionPlan): string {
  const added = plan.ops.filter((o) => o.file === 'shopping' && o.t === 'upsert').length;
  const removed = plan.ops.filter((o) => o.file === 'shopping' && o.t === 'remove').length;
  const name = plan.title.split(':')[0];
  if (added) return `${name} is on the shopping list`;
  if (removed) return `${name} is back in stock and off the shopping list`;
  return 'Saved';
}

export function StockScreen() {
  useScreenContext('stock', 'Looking at Stock');
  const { snap, error, refetch } = useSnapshot();
  const { run } = useRun();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [group, setGroupState] = useState<Group>(() => prefs.ui().stockGroup);
  const [collapsed, setCollapsedState] = useState<string[]>(() => prefs.ui().stockCollapsed);
  const [editing, setEditing] = useState<string | null | undefined>(undefined); // undefined = closed, null = new

  const setGroup = (g: Group) => {
    prefs.setUi({ stockGroup: g });
    setGroupState(g);
  };
  const toggleSection = (key: string) => {
    const next = collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key];
    prefs.setUi({ stockCollapsed: next });
    setCollapsedState(next);
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
    if (orphans.length) out.push({ name: group === 'place' ? 'Other' : 'No category', items: orphans });
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
    void run('adjustStock', { itemId: it.id, delta: dir * stepFor(it) }, { toast: stockToast });
  const setStatus = (it: Item, status: StockStatus) => {
    if (stockStatus(it) === status) return;
    void run('setItemStatus', { itemId: it.id, status }, { toast: stockToast });
  };
  // searching or filtering opens every section, so a match is never hidden
  const narrowed = query.trim() !== '' || filter !== 'all';

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
      <SearchField
        aria-label="Search stock"
        placeholder={`Search ${shown.length} items`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="wrap" style={{ marginTop: 12 }}>
        <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </Chip>
        <Chip pressed={filter === 'low'} onClick={() => setFilter('low')}>
          Low {counts.low}
        </Chip>
        <Chip pressed={filter === 'out'} onClick={() => setFilter('out')}>
          Out {counts.out}
        </Chip>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
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

      {groups.map((g) => {
        const key = `${group}:${g.name}`;
        const open = narrowed || !collapsed.includes(key);
        return (
          <section key={key} aria-label={g.name}>
            <h2 className="stock-section">
              <button
                type="button"
                aria-expanded={open}
                disabled={narrowed}
                onClick={() => toggleSection(key)}
              >
                <span className="chev" aria-hidden="true">
                  {open ? '▾' : '▸'}
                </span>
                <span className="grow">{g.name}</span>
              </button>
            </h2>
            {open && (
              <div className="list">
                {g.items.map((it) => (
                  <StockRow
                    key={it.id}
                    item={it}
                    sub={
                      group === 'place'
                        ? catLabel(it.category, it.subcategory)
                        : [it.subcategory, it.place.toLowerCase()].filter(Boolean).join(', ')
                    }
                    onEdit={() => setEditing(it.id)}
                    onDec={() => step(it, -1)}
                    onInc={() => step(it, 1)}
                    onStatus={(s) => setStatus(it, s)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {groups.length === 0 &&
        (shown.length === 0 ? (
          <EmptyState>
            Nothing in stock yet. Start from your own list, or tap Add item.
            <button
              type="button"
              className="btn btn-outline btn-block"
              style={{ marginTop: 14 }}
              onClick={() => nav('/settings/items/import')}
            >
              Import your list
            </button>
          </EmptyState>
        ) : (
          <EmptyState>
            Nothing matches.
            <button
              type="button"
              className="btn btn-outline btn-block"
              style={{ marginTop: 'var(--space-4)' }}
              onClick={() => {
                setQuery('');
                setFilter('all');
              }}
            >
              Clear the search
            </button>
          </EmptyState>
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
  onStatus,
}: {
  item: Item;
  sub: string;
  onEdit: () => void;
  onDec: () => void;
  onInc: () => void;
  onStatus: (s: StockStatus) => void;
}) {
  const st = stockStatus(item);
  const simple = isSimple(item);
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // long-press anywhere on the row opens the editor too
  const longPress = {
    onPointerDown: (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.stepper, .status-seg')) return;
      press.current = setTimeout(onEdit, 550);
    },
    onPointerUp: () => clearTimeout(press.current),
    onPointerLeave: () => clearTimeout(press.current),
    onPointerCancel: () => clearTimeout(press.current),
  };
  return (
    <div
      className={`stock-row${st === 'have' ? '' : ` is-${st}`}${item.active ? '' : ' is-inactive'}`}
      {...longPress}
    >
      <div className="grow">
        <button type="button" className="stock-name" aria-label={`Edit ${item.name}`} onClick={onEdit}>
          {item.name}
        </button>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {!item.active && <span className="tag tag-grey">Not watched</span>}
          {/* simple items show their status in the control; amount items get the badge */}
          {!simple && st !== 'have' && <span className={BADGE[st].cls}>{BADGE[st].label}</span>}
          {sub && <span className="small muted">{sub}</span>}
        </div>
      </div>
      {!item.active ? null : simple ? (
        <StatusControl name={item.name} value={st} onChange={onStatus} />
      ) : (
        <Stepper
          value={qty(item.quantity, item.unit)}
          decLabel={`Remove ${qty(stepFor(item), item.unit)} of ${item.name}`}
          incLabel={`Add ${qty(stepFor(item), item.unit)} of ${item.name}`}
          decDisabled={item.quantity <= 0}
          onDec={onDec}
          onInc={onInc}
        />
      )}
    </div>
  );
}
