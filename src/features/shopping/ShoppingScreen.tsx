import { useMemo, useState } from 'react';
import { useRun, useSnapshot } from '../../app/data';
import { useScreenContext } from '../../app/assistantUi';
import { DecimalInput, DeleteButton, EmptyState, Field, Loading, PageHeader } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { IconCheck, IconPen } from '../../ui/icons';
import { findKnownItem, ruleCategory } from '../../domain/categorise';
import { parseQuickAdd } from '../../domain/quickAdd';
import { num, parseDecimal, plural, qty as fmtQty } from '../../domain/format';
import { UNITS, type Item, type ShoppingItem, type Unit } from '../../domain/schemas';
import type { Snapshot } from '../../domain/actions';

/** Rough store-walk order for sections. */
const WALK = [
  'Produce',
  'Bakery',
  'Meat & fish',
  'Dairy & eggs',
  'Frozen',
  'Pantry',
  'Snacks & sweets',
  'Drinks',
  'Household',
  'Personal care',
];

function sourceLabel(s: ShoppingItem, snap: Snapshot): string {
  switch (s.source) {
    case 'low-stock':
      return 'running low';
    case 'recipe': {
      const r = snap.recipes.recipes.find((x) => x.id === s.sourceRef);
      return r ? `for ${r.title}` : 'for a recipe';
    }
    case 'plan':
      return "for this week's plan";
    default:
      return `added by ${s.addedBy}`;
  }
}

function categoryOf(s: ShoppingItem, items: Map<string, Item>): string {
  const it = s.itemId ? items.get(s.itemId) : undefined;
  return it?.category ?? ruleCategory(s.name)?.category ?? 'Other';
}

export function ShoppingScreen() {
  useScreenContext('shopping', 'Looking at the shopping list');
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<ShoppingItem | null>(null);
  const [buying, setBuying] = useState(false);

  const itemsById = useMemo(() => new Map((snap?.items.items ?? []).map((i) => [i.id, i])), [snap]);
  const { sections, cart, toBuy } = useMemo(() => {
    const list = snap?.shopping.items ?? [];
    const toBuy = list.filter((s) => !s.checked);
    const cart = list.filter((s) => s.checked);
    const tree = snap?.household.categories.map((c) => c.name) ?? [];
    const order = [
      ...WALK.filter((c) => tree.includes(c)),
      ...tree.filter((c) => !WALK.includes(c)),
      'Other',
    ];
    const groups = new Map<string, ShoppingItem[]>();
    for (const s of toBuy) {
      const c = categoryOf(s, itemsById);
      groups.set(c, [...(groups.get(c) ?? []), s]);
    }
    const sections = order.filter((c) => groups.has(c)).map((c) => ({ name: c, items: groups.get(c)! }));
    for (const [c, items] of groups) if (!order.includes(c)) sections.push({ name: c, items });
    return { sections, cart, toBuy };
  }, [snap, itemsById]);

  if (!snap) return <Loading text="Loading the list…" />;

  const add = async () => {
    const q = parseQuickAdd(text);
    if (!q.name) return;
    const known = findKnownItem(q.name, snap.items.items);
    const ok = await run(
      'addToShoppingList',
      {
        entries: [
          { itemId: known?.id, name: known?.name ?? q.name, amount: q.amount, unit: q.unit ?? known?.unit },
        ],
        source: 'manual',
      },
      { toast: (p) => String(p.result) },
    );
    if (ok) setText('');
  };

  const toggle = (s: ShoppingItem) =>
    void run('checkShoppingItems', { ids: [s.id], checked: !s.checked }, { toast: false });

  const row = (s: ShoppingItem) => {
    const amount = s.amount && s.unit ? fmtQty(s.amount, s.unit) : s.amount ? num(s.amount) : '';
    return (
      <div key={s.id} className="row" style={{ gap: 0 }}>
        <button
          type="button"
          className="list-row grow"
          aria-label={`${s.checked ? 'Uncheck' : 'Check off'} ${s.name}`}
          onClick={() => toggle(s)}
          style={{ gap: 14 }}
        >
          <span
            className={`checkbox${s.checked ? ' on' : ''}`}
            aria-hidden
            style={{ width: 26, height: 26 }}
          />
          <span className="grow stack" style={{ gap: 0 }}>
            <span
              className="title"
              style={
                s.checked
                  ? { color: 'var(--muted)', textDecoration: 'line-through', fontWeight: 400 }
                  : undefined
              }
            >
              {s.name}
            </span>
            {!s.checked && (
              <span className="sub">{[amount, sourceLabel(s, snap)].filter(Boolean).join(', ')}</span>
            )}
          </span>
        </button>
        <button
          type="button"
          className="icon-btn muted"
          aria-label={`Edit ${s.name}`}
          onClick={() => setEditing(s)}
          style={{ marginRight: 4 }}
        >
          <IconPen size={18} />
        </button>
      </div>
    );
  };

  return (
    <>
      <PageHeader title="Shopping" />
      <p className="summary">
        {toBuy.length} to buy{cart.length ? `, ${cart.length} in the cart` : ''}
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input
          className="input grow"
          aria-label="Add an item to the list"
          placeholder="Add an item, e.g. 2 kg potatoes"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary btn-md" disabled={!text.trim()}>
          Add
        </button>
      </form>

      {sections.map((sec) => (
        <section key={sec.name} aria-label={sec.name}>
          <h2 className="group-title">{sec.name}</h2>
          <div className="list">{sec.items.map(row)}</div>
        </section>
      ))}
      {toBuy.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="muted" style={{ margin: 0, padding: '20px 16px' }}>
            The list is empty. Add something above, or it fills up when stock runs low.
          </p>
        </div>
      )}

      {cart.length > 0 && (
        <>
          <div className="row-between" style={{ margin: '24px 0 10px' }}>
            <h2 className="h2" style={{ margin: 0 }}>
              In the cart ({cart.length})
            </h2>
            <button
              type="button"
              className="link-btn"
              onClick={() =>
                void run(
                  'removeShoppingItems',
                  { ids: cart.map((s) => s.id) },
                  { toast: `${plural(cart.length, 'item')} cleared` },
                )
              }
            >
              Clear checked
            </button>
          </div>
          <div className="list">{cart.map(row)}</div>
          <button
            type="button"
            className="btn btn-outline btn-block"
            style={{ marginTop: 12 }}
            onClick={() => setBuying(true)}
          >
            <IconCheck size={18} />I bought these, add to stock
          </button>
          <p className="small muted" style={{ marginTop: 8 }}>
            Or scan the receipt with the Assistant: it checks off the list and updates stock and the budget in
            one go.
          </p>
        </>
      )}
      {toBuy.length === 0 && cart.length === 0 && <EmptyState>Nothing on the list.</EmptyState>}

      {editing && <EditEntrySheet entry={editing} onClose={() => setEditing(null)} />}
      {buying && <BuySheet entries={cart} items={itemsById} onClose={() => setBuying(false)} />}
    </>
  );
}

function EditEntrySheet({ entry, onClose }: { entry: ShoppingItem; onClose: () => void }) {
  const { run } = useRun();
  const [name, setName] = useState(entry.name);
  const [amount, setAmount] = useState(entry.amount ? num(entry.amount, 3) : '');
  const [unit, setUnit] = useState<Unit | undefined>(entry.unit);
  const a = amount.trim() ? parseDecimal(amount) : undefined;
  const bad = !name.trim() || (a !== undefined && !(a > 0));
  return (
    <Sheet onClose={onClose} title="Change entry" labelledBy="ee-title">
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid-2" style={{ gap: 10, gridTemplateColumns: '110px minmax(0,1fr)' }}>
        <Field label="Amount">
          <DecimalInput placeholder="Any" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <div className="stack-sm">
          <span className="bold" style={{ fontSize: 15 }}>
            Unit
          </span>
          <div className="unit-grid" role="group" aria-label="Unit">
            {UNITS.map((u) => (
              <button
                key={u}
                type="button"
                aria-pressed={unit === u}
                onClick={() => setUnit(unit === u ? undefined : u)}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={bad}
        onClick={async () => {
          if (
            await run(
              'updateShoppingItem',
              { id: entry.id, name: name.trim(), amount: a, unit: a ? (unit ?? 'pcs') : undefined },
              { toast: 'Saved' },
            )
          )
            onClose();
        }}
      >
        Save
      </button>
      <DeleteButton
        label="Remove from the list"
        onDelete={async () => {
          if (await run('removeShoppingItems', { ids: [entry.id] }, { toast: `${entry.name} removed` }))
            onClose();
        }}
      />
    </Sheet>
  );
}

function BuySheet({
  entries,
  items,
  onClose,
}: {
  entries: ShoppingItem[];
  items: Map<string, Item>;
  onClose: () => void;
}) {
  const { run } = useRun();
  const linked = entries.filter((s) => s.itemId && items.has(s.itemId));
  const unlinked = entries.filter((s) => !(s.itemId && items.has(s.itemId)));
  const [rows, setRows] = useState(
    () =>
      Object.fromEntries(
        linked.map((s) => {
          const it = items.get(s.itemId!)!;
          return [
            s.id,
            {
              on: true,
              amount: s.amount ? num(s.amount, 3) : it.unit === 'pcs' ? '1' : '',
              unit: s.amount && s.unit ? s.unit : it.unit,
            },
          ];
        }),
      ) as Record<string, { on: boolean; amount: string; unit: Unit }>,
  );
  const chosen = linked.filter((s) => rows[s.id].on);
  const bad = chosen.some((s) => !(parseDecimal(rows[s.id].amount) > 0));
  return (
    <Sheet onClose={onClose} title="Add what you bought to stock" labelledBy="buy-title">
      {linked.length > 0 ? (
        <div className="list">
          {linked.map((s) => {
            const it = items.get(s.itemId!)!;
            const r = rows[s.id];
            return (
              <div key={s.id} className="row" style={{ padding: '10px 12px', gap: 10 }}>
                <button
                  type="button"
                  className={`checkbox${r.on ? ' on' : ''}`}
                  aria-pressed={r.on}
                  aria-label={`Add ${it.name} to stock`}
                  onClick={() => setRows((x) => ({ ...x, [s.id]: { ...r, on: !r.on } }))}
                  style={{ width: 26, height: 26, padding: 0 }}
                />
                <span className="grow stack" style={{ gap: 0 }}>
                  <span className="bold">{it.name}</span>
                  <span className="small muted">
                    {fmtQty(it.quantity, it.unit)} now, {it.place.toLowerCase()}
                  </span>
                </span>
                <label className="row" style={{ gap: 6 }}>
                  <span className="sr-only">How much {it.name}</span>
                  <DecimalInput
                    className="input input-sm"
                    style={{ width: 76, textAlign: 'right' }}
                    disabled={!r.on}
                    value={r.amount}
                    onChange={(e) => setRows((x) => ({ ...x, [s.id]: { ...r, amount: e.target.value } }))}
                  />
                  <span className="small muted" style={{ width: 28 }}>
                    {r.unit}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          None of these are items you track in stock.
        </p>
      )}
      {unlinked.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          Not tracked in stock, just cleared: {unlinked.map((s) => s.name).join(', ')}.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={bad}
        onClick={async () => {
          const res = await run(
            'stockFromShopping',
            {
              lines: chosen.map((s) => ({
                shoppingId: s.id,
                itemId: s.itemId!,
                amount: parseDecimal(rows[s.id].amount),
                unit: rows[s.id].unit,
              })),
              alsoClear: [
                ...unlinked.map((s) => s.id),
                ...linked.filter((s) => !rows[s.id].on).map((s) => s.id),
              ],
            },
            { toast: `${plural(chosen.length, 'item')} added to stock` },
          );
          if (res) onClose();
        }}
      >
        {chosen.length ? `Add ${plural(chosen.length, 'item')} to stock` : 'Clear the cart'}
      </button>
    </Sheet>
  );
}
