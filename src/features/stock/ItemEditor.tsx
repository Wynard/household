import { useMemo, useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { DecimalInput, DeleteButton, Field, Seg, Switch } from '../../ui/controls';
import { useRun, useSnapshot } from '../../app/data';
import { useToast } from '../../ui/Toast';
import { categorise, normalise } from '../../domain/categorise';
import { catLabel, num, parseDecimal } from '../../domain/format';
import { UNITS, type Item, type ItemStatus, type Unit } from '../../domain/schemas';
import { CategoryPicker } from './CategoryPicker';

type Draft = {
  name: string;
  category: string | null;
  subcategory: string | null;
  /** true once a person picked or changed the category */
  manual: boolean;
  place: string;
  tracking: Item['tracking'];
  status: ItemStatus;
  addToListWhen: Item['addToListWhen'];
  active: boolean;
  unit: Unit;
  quantity: string;
  low: string;
  gramsPerPiece: string;
  showInStock: boolean;
};

function toDraft(it: Item | undefined, place: string, preset?: Partial<Draft>): Draft {
  if (!it)
    return {
      name: '',
      category: null,
      subcategory: null,
      manual: false,
      place,
      tracking: 'simple',
      status: 'have',
      addToListWhen: 'out',
      active: true,
      unit: 'pcs',
      quantity: '',
      low: '',
      gramsPerPiece: '',
      showInStock: true,
      ...preset,
    };
  return {
    name: it.name,
    category: it.category,
    subcategory: it.subcategory,
    manual: true,
    place: it.place,
    tracking: it.tracking,
    status: it.status,
    addToListWhen: it.addToListWhen,
    active: it.active,
    unit: it.unit,
    quantity: it.tracking === 'amount' ? num(it.quantity, 3) : '',
    low: it.lowThreshold ? num(it.lowThreshold, 3) : '',
    gramsPerPiece: it.gramsPerPiece ? num(it.gramsPerPiece) : '',
    showInStock: it.showInStock,
  };
}

/** Bottom sheet for adding or editing an item (6.1). Used by Stock and Settings › Items. */
export function ItemEditor({
  itemId,
  onClose,
  onSaved,
  preset,
}: {
  itemId?: string | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
  preset?: Partial<Draft>;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const toast = useToast();
  const [editingId, setEditingId] = useState<string | null>(itemId ?? null);
  const existing = snap?.items.items.find((i) => i.id === editingId);
  const [d, setD] = useState<Draft>(() => toDraft(existing, snap?.household.places[0] ?? 'Pantry', preset));
  const [picking, setPicking] = useState(false);
  const [merging, setMerging] = useState(false);
  const upd = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const items = useMemo(() => snap?.items.items ?? [], [snap]);
  const tree = useMemo(() => snap?.household.categories ?? [], [snap]);
  const places = snap?.household.places ?? [];

  // live suggestion while the person hasn't chosen a category themselves
  const others = useMemo(() => items.filter((i) => i.id !== editingId), [items, editingId]);
  const guess = useMemo(
    () => (d.manual ? null : categorise(d.name, others, tree)),
    [d.manual, d.name, others, tree],
  );
  const category = d.manual ? d.category : (guess?.category ?? null);
  const subcategory = d.manual ? d.subcategory : (guess?.subcategory ?? null);

  // existing items with a similar name, to avoid duplicates
  const similar = useMemo(() => {
    const n = normalise(d.name);
    if (n.length < 3) return [];
    return others.filter((i) => normalise(i.name).includes(n) || n.includes(normalise(i.name))).slice(0, 3);
  }, [d.name, others]);

  const amount = d.active && d.tracking === 'amount';
  const qty = amount ? parseDecimal(d.quantity) : 0;
  const low = amount && d.low.trim() ? parseDecimal(d.low) : 0;
  const gpp = d.gramsPerPiece.trim() ? parseDecimal(d.gramsPerPiece) : 0;
  const problem = !d.name.trim()
    ? 'Add a name'
    : !category
      ? 'Pick a category'
      : Number.isNaN(qty) || qty < 0 || (amount && !d.quantity.trim())
        ? 'Enter how much is in the house'
        : Number.isNaN(low) || low < 0
          ? 'Enter a number for the warning'
          : Number.isNaN(gpp) || gpp < 0
            ? 'Enter the weight per piece in grams'
            : null;

  const usedIn = existing
    ? (snap?.recipes.recipes.filter((r) => r.ingredients.some((g) => g.itemId === existing.id)) ?? [])
    : [];

  const save = async () => {
    if (problem || !category) return;
    const res = await run(
      'upsertItem',
      {
        id: existing?.id,
        name: d.name.trim(),
        category,
        subcategory: subcategory ?? '',
        categorySource: d.manual
          ? existing && existing.category === category && existing.subcategory === subcategory
            ? existing.categorySource
            : 'manual'
          : 'auto',
        place: d.place,
        showInStock: d.showInStock,
        tracking: d.tracking,
        status: d.status,
        addToListWhen: d.addToListWhen,
        active: d.active,
        unit: d.unit,
        quantity: qty,
        lowThreshold: low > 0 ? low : undefined,
        gramsPerPiece: gpp > 0 ? gpp : undefined,
        aliases: existing?.aliases,
      },
      { toast: existing ? `${d.name.trim()} saved` : `${d.name.trim()} added to ${d.place}` },
    );
    if (res) {
      onSaved?.(res.plan.result as string);
      onClose();
    }
  };

  const catBg = category ? 'var(--cobalt-soft)' : d.name.trim() ? 'var(--saffron-soft)' : 'var(--surface-2)';

  return (
    <>
      <Sheet onClose={onClose} z={38} labelledBy="ie-title" title={existing ? 'Edit item' : 'New item'}>
        <Field label="Name">
          <input
            className="input"
            placeholder="e.g. Greek yogurt, dish sponges"
            value={d.name}
            onChange={(e) => upd({ name: e.target.value })}
            autoFocus={!existing}
          />
        </Field>
        {!existing && similar.length > 0 && (
          <div className="stack-sm">
            <span className="small muted">Already in your items:</span>
            <div className="wrap">
              {similar.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="chip chip-sm chip-soft"
                  onClick={() => {
                    setEditingId(s.id);
                    setD(toDraft(s, s.place));
                  }}
                >
                  {s.name}, {s.place.toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="row-between" style={{ padding: '10px 12px', borderRadius: 12, background: catBg }}>
          <span className="stack" style={{ gap: 0 }}>
            <span className="tiny muted">
              {category && !d.manual ? (
                <>
                  Category <span className="tag tag-cobalt">Suggested</span>
                </>
              ) : (
                'Category'
              )}
            </span>
            <span className="bold" style={{ color: category ? 'var(--cobalt-ink)' : 'var(--ink)' }}>
              {category
                ? catLabel(category, subcategory ?? undefined)
                : d.name.trim()
                  ? 'Needs a category. No match found, pick one.'
                  : 'Type a name to get a suggestion'}
            </span>
          </span>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPicking(true)}>
            {category ? 'Change' : 'Pick'}
          </button>
        </div>

        <div className="stack-sm">
          <span className="bold" style={{ fontSize: 15 }}>
            Where it's kept
          </span>
          <div className="wrap" role="group" aria-label="Where it's kept">
            {places.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={d.place === p}
                onClick={() => upd({ place: p })}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <Switch
          on={d.active}
          onToggle={() => upd({ active: !d.active })}
          title="Watch this item"
          sub={
            d.active
              ? 'Shows when it is low or out and goes on the shopping list.'
              : 'Kept in your items, but the app never tracks it: no low or out, no shopping list, recipes skip it.'
          }
        />

        {d.active && (
          <>
            <div className="stack-sm">
              <span className="bold" style={{ fontSize: 15 }}>
                Tracking
              </span>
              <Seg
                label="Tracking"
                value={d.tracking}
                onChange={(t) =>
                  // switching to amounts asks for the current quantity (the field starts empty)
                  upd(t === 'amount' ? { tracking: t, quantity: '' } : { tracking: t })
                }
                options={[
                  ['simple', 'Have / low / out'],
                  ['amount', 'Exact amount'],
                ]}
              />
            </div>

            {!amount && (
              <div className="stack-sm">
                <span className="bold" style={{ fontSize: 15 }}>
                  In the house now
                </span>
                <Seg
                  label="In the house now"
                  value={d.status}
                  onChange={(st) => upd({ status: st })}
                  options={[
                    ['out', 'Out'],
                    ['low', 'Low'],
                    ['have', 'Have'],
                  ]}
                />
              </div>
            )}

            {amount && (
              <>
                <div className="stack-sm">
                  <span className="bold" style={{ fontSize: 15 }}>
                    Unit
                  </span>
                  <div className="unit-grid" role="group" aria-label="Unit">
                    {UNITS.map((u) => (
                      <button
                        key={u}
                        type="button"
                        aria-pressed={d.unit === u}
                        onClick={() => upd({ unit: u })}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid-2" style={{ gap: 10 }}>
                  <Field label="In the house now">
                    <DecimalInput
                      value={d.quantity}
                      placeholder={`How much, in ${d.unit}`}
                      autoFocus={!!existing && existing.tracking === 'simple'}
                      onChange={(e) => upd({ quantity: e.target.value })}
                    />
                  </Field>
                  <Field label="Warn me below">
                    <DecimalInput
                      value={d.low}
                      placeholder="No warning"
                      onChange={(e) => upd({ low: e.target.value })}
                    />
                  </Field>
                </div>
                {d.unit === 'pcs' && (
                  <Field
                    label="Weight per piece, in grams (optional)"
                    hint="Lets recipes in grams use pieces, e.g. one egg is about 60 g."
                  >
                    <DecimalInput
                      value={d.gramsPerPiece}
                      placeholder="e.g. 60"
                      onChange={(e) => upd({ gramsPerPiece: e.target.value })}
                    />
                  </Field>
                )}
              </>
            )}
          </>
        )}

        <Switch
          on={d.showInStock}
          onToggle={() => upd({ showInStock: !d.showInStock })}
          title="Show in Stock"
          sub={
            d.showInStock
              ? 'Appears on the Stock tab and gets low-stock alerts.'
              : 'Hidden from Stock. Still used for budget categories, recipes and receipts.'
          }
        />
        {d.showInStock && d.active && (
          <div className="stack-sm">
            <span className="bold" style={{ fontSize: 15 }}>
              Add to the shopping list when
            </span>
            <Seg
              small
              label="Add to the shopping list when"
              value={d.addToListWhen}
              onChange={(w) => upd({ addToListWhen: w })}
              options={[
                ['low', amount ? 'Below warning' : 'Low'],
                ['out', 'Out'],
                ['never', 'Never'],
              ]}
            />
          </div>
        )}

        {problem && d.name.trim() && <span className="problem">{problem}</span>}
        <button
          type="button"
          className="btn btn-primary btn-block"
          disabled={!!problem}
          onClick={() => void save()}
        >
          {problem && !d.name.trim() ? 'Add a name to save' : existing ? 'Save changes' : 'Add item'}
        </button>

        {existing && (
          <>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => setMerging(true)}>
              Merge with a duplicate
            </button>
            <DeleteButton
              label="Delete item"
              blockedReason={
                usedIn.length
                  ? `Used in ${usedIn.map((r) => r.title).join(', ')}. Remove it from ${usedIn.length === 1 ? 'that recipe' : 'those recipes'} first.`
                  : null
              }
              onBlocked={(r) => toast.show(r)}
              onDelete={async () => {
                if (await run('deleteItem', { id: existing.id }, { toast: `${existing.name} deleted` }))
                  onClose();
              }}
            />
          </>
        )}
      </Sheet>

      {picking && (
        <CategoryPicker
          onClose={() => setPicking(false)}
          onPick={(c, s) => {
            upd({ category: c, subcategory: s, manual: true });
            setPicking(false);
          }}
        />
      )}
      {merging && existing && (
        <MergeSheet
          keep={existing}
          candidates={others}
          onClose={() => setMerging(false)}
          onMerged={() => {
            setMerging(false);
            onClose();
          }}
        />
      )}
    </>
  );
}

function MergeSheet({
  keep,
  candidates,
  onClose,
  onMerged,
}: {
  keep: Item;
  candidates: Item[];
  onClose: () => void;
  onMerged: () => void;
}) {
  const { run } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const sorted = useMemo(() => {
    const score = (i: Item) =>
      i.subcategory === keep.subcategory ? 0 : i.category === keep.category ? 1 : 2;
    return candidates.slice().sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
  }, [candidates, keep]);
  return (
    <Sheet onClose={onClose} z={45} title={`Merge into ${keep.name}`} labelledBy="merge-title">
      <p className="muted" style={{ margin: 0, fontSize: 15 }}>
        Pick the duplicates. Their amounts are added to {keep.name}, their names become spellings it
        recognises on receipts, and recipes and history point to {keep.name}.
      </p>
      <div className="list" style={{ maxHeight: 360, overflowY: 'auto' }}>
        {sorted.map((i) => {
          const on = picked.includes(i.id);
          return (
            <button
              key={i.id}
              type="button"
              className="list-row"
              aria-pressed={on}
              onClick={() => setPicked((p) => (on ? p.filter((x) => x !== i.id) : [...p, i.id]))}
            >
              <span className={`checkbox${on ? ' on' : ''}`} aria-hidden />
              <span className="grow stack" style={{ gap: 0 }}>
                <span className="title">{i.name}</span>
                <span className="sub">
                  {catLabel(i.category, i.subcategory)}, {i.place}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!picked.length}
        onClick={async () => {
          if (
            await run(
              'mergeItems',
              { keepId: keep.id, mergeIds: picked },
              { toast: `Merged into ${keep.name}` },
            )
          )
            onMerged();
        }}
      >
        {picked.length ? `Merge ${picked.length} into ${keep.name}` : 'Pick the duplicates'}
      </button>
    </Sheet>
  );
}
