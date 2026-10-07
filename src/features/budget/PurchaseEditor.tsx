import { useMemo, useState, type ReactNode } from 'react';
import { FullScreen } from '../../ui/Sheet';
import { Choice, DecimalInput, Field } from '../../ui/controls';
import { IconClose } from '../../ui/icons';
import { useMe, useRun, useSnapshot } from '../../app/data';
import { categorise, findKnownItem } from '../../domain/categorise';
import { catLabel, money, num, parseDecimal, qty as fmtQty, round2 } from '../../domain/format';
import { nowHHmm, todayISO } from '../../domain/dates';
import { UNITS, type Item, type Purchase, type Unit } from '../../domain/schemas';
import type { RunResult } from '../../app/data';
import { CategoryPicker } from '../stock/CategoryPicker';

export interface LineDraft {
  id: string;
  rawText?: string;
  itemId?: string;
  name: string;
  quantity: string;
  unit: Unit;
  price: string;
  category?: string;
  subcategory?: string;
  /** category came from a suggestion and hasn't been confirmed */
  auto: boolean;
  note?: string;
  toStock: boolean;
  /** 0..1 from the receipt reader; < 0.7 is highlighted */
  confidence?: number;
  /** the person confirmed or changed the matched item */
  confirmed?: boolean;
  place?: string;
}

export interface PurchaseDraft {
  id?: string;
  store: string;
  date: string;
  time?: string;
  spentBy: string;
  purpose: string;
  lines: LineDraft[];
  /** printed total from a receipt */
  printedTotal?: number;
  source: 'manual' | 'receipt';
}

const uid = () => crypto.randomUUID();
export const LOW_CONFIDENCE = 0.7;

export function draftFromPurchase(p: Purchase): PurchaseDraft {
  return {
    id: p.id,
    store: p.store,
    date: p.date,
    time: p.time,
    spentBy: p.spentBy,
    purpose: p.purpose ?? '',
    source: p.source,
    printedTotal: p.source === 'receipt' ? p.total : undefined,
    lines: p.lines.map((l) => ({
      id: l.id,
      rawText: l.rawText,
      itemId: l.itemId,
      name: l.name,
      quantity: num(l.quantity, 3),
      unit: l.unit,
      price: num(l.price),
      category: l.category,
      subcategory: l.subcategory,
      auto: false,
      note: l.note,
      toStock: false,
    })),
  };
}

export const lineTotal = (lines: LineDraft[]) =>
  round2(lines.reduce((t, l) => t + (parseDecimal(l.price) || 0), 0));

export function purchaseProblem(d: PurchaseDraft): string | null {
  if (!d.store.trim()) return 'Add the store name';
  if (!d.lines.length) return 'Add at least one item';
  const noCat = d.lines.filter((l) => !l.category).length;
  if (noCat) return `Pick a category for ${noCat === 1 ? '1 item' : `${noCat} items`}`;
  const badQty = d.lines.find((l) => !(parseDecimal(l.quantity) > 0));
  if (badQty) return `Enter a quantity for ${badQty.name}`;
  const badPrice = d.lines.find((l) => Number.isNaN(parseDecimal(l.price)));
  if (badPrice) return `Enter a price for ${badPrice.name}`;
  return null;
}

/** Input for the addPurchase / updatePurchase actions. */
export function toActionInput(d: PurchaseDraft) {
  return {
    ...(d.id ? { id: d.id } : {}),
    store: d.store.trim(),
    date: d.date,
    ...(d.time ? { time: d.time } : {}),
    spentBy: d.spentBy,
    ...(d.purpose.trim() ? { purpose: d.purpose.trim() } : {}),
    lines: d.lines.map((l) => ({
      id: l.id,
      ...(l.rawText ? { rawText: l.rawText } : {}),
      ...(l.itemId ? { itemId: l.itemId } : {}),
      name: l.name.trim(),
      quantity: parseDecimal(l.quantity),
      unit: l.unit,
      price: parseDecimal(l.price),
      category: l.category!,
      subcategory: l.subcategory ?? '',
      ...(l.note?.trim() ? { note: l.note.trim() } : {}),
      ...(d.id
        ? {}
        : {
            toStock: l.toStock,
            learnAlias: !!(l.rawText && l.itemId && l.confirmed),
            ...(l.place ? { place: l.place } : {}),
          }),
    })),
  };
}

/** New line from a typed name: links a known item and suggests a category (5.1). */
export function newLine(
  name: string,
  items: Item[],
  tree: Parameters<typeof categorise>[2],
  extra: Partial<LineDraft> = {},
): LineDraft {
  const known = findKnownItem(name, items);
  const guess = categorise(name, items, tree);
  return {
    id: uid(),
    name: known?.name ?? name.trim(),
    itemId: known?.id,
    quantity: '1',
    unit: known?.unit ?? 'pcs',
    price: '',
    category: guess?.category,
    subcategory: guess?.subcategory,
    auto: !!guess && guess.via === 'rule',
    toStock: false,
    ...extra,
  };
}

/**
 * Full-screen purchase form: "Add a purchase" (manual), "Edit purchase", and the
 * receipt review screen (mode="receipt", with extra header content).
 */
export function PurchaseEditor({
  initial,
  title,
  onClose,
  onSaved,
  submit,
  header,
  saveLabel,
}: {
  initial?: PurchaseDraft;
  title?: string;
  onClose: () => void;
  onSaved?: (r: RunResult) => void;
  /** custom submit (receipt confirm); defaults to addPurchase / updatePurchase */
  submit?: (d: PurchaseDraft) => Promise<RunResult | null>;
  header?: ReactNode;
  saveLabel?: (total: string) => string;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const me = useMe();
  const editing = !!initial?.id;
  const receipt = initial?.source === 'receipt' && !editing;
  const [d, setD] = useState<PurchaseDraft>(
    () =>
      initial ?? {
        store: '',
        date: todayISO(),
        time: nowHHmm(),
        spentBy: me?.email ?? '',
        purpose: '',
        lines: [],
        source: 'manual',
      },
  );
  const [ln, setLn] = useState({ name: '', quantity: '1', unit: 'pcs' as Unit, price: '' });
  const [picking, setPicking] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const upd = (p: Partial<PurchaseDraft>) => setD((x) => ({ ...x, ...p }));
  const updLine = (id: string, p: Partial<LineDraft>) =>
    setD((x) => ({ ...x, lines: x.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) }));

  const items = useMemo(() => snap?.items.items ?? [], [snap]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const tree = useMemo(() => snap?.household.categories ?? [], [snap]);
  const members = snap?.household.members ?? [];
  const stores = snap?.household.stores ?? [];
  const guess = ln.name.trim() ? categorise(ln.name, items, tree) : null;

  const total = lineTotal(d.lines);
  const problem = purchaseProblem(d);
  const diff = d.printedTotal !== undefined ? round2(d.printedTotal - total) : 0;

  const addLine = () => {
    const name = ln.name.trim();
    if (!name) return;
    const price = parseDecimal(ln.price);
    const q = parseDecimal(ln.quantity);
    const line = newLine(name, items, tree, {
      quantity: q > 0 ? ln.quantity : '1',
      unit: ln.unit,
      price: Number.isNaN(price) ? '' : ln.price,
    });
    setD((x) => ({ ...x, lines: [...x.lines, line] }));
    setLn({ name: '', quantity: '1', unit: ln.unit, price: '' });
    if (!line.category) setPicking(line.id); // nothing matched: open the picker right away
  };

  const save = async () => {
    setTried(true);
    if (problem || busy) return;
    setBusy(true);
    const res = submit
      ? await submit(d)
      : editing
        ? await run('updatePurchase', toActionInput(d), { toast: 'Purchase updated' })
        : await run('addPurchase', toActionInput(d), { toast: `${money(total)} at ${d.store.trim()} saved` });
    setBusy(false);
    if (res) {
      onSaved?.(res);
      onClose();
    }
  };

  const label = problem
    ? 'Save purchase'
    : (saveLabel?.(money(d.printedTotal ?? total)) ?? `Save ${money(total)} from the pot`);

  return (
    <FullScreen z={40} label={title ?? 'Purchase'}>
      <div className="full-head">
        <h1 className="h1-sm">{title ?? (editing ? 'Edit purchase' : 'Add a purchase')}</h1>
        <button type="button" className="icon-btn" aria-label="Close without saving" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="full-body">
        {header}
        <div className="card card-pad stack-lg" style={{ gap: 12 }}>
          <Field label="Store">
            <input
              className="input"
              placeholder="Where did you buy it?"
              value={d.store}
              onChange={(e) => upd({ store: e.target.value })}
            />
          </Field>
          <div className="hscroll" style={{ marginTop: -4, gap: 6 }}>
            {stores.map((s) => (
              <button
                key={s}
                type="button"
                className="chip chip-sm"
                aria-pressed={d.store === s}
                onClick={() => upd({ store: s })}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid-2" style={{ gap: 10, gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr)' }}>
            <Field label="Date">
              <input
                type="date"
                className="input"
                value={d.date}
                max={todayISO()}
                onChange={(e) => e.target.value && upd({ date: e.target.value })}
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                className="input"
                value={d.time ?? ''}
                onChange={(e) => upd({ time: e.target.value || undefined })}
              />
            </Field>
          </div>
          <Choice
            label="Who took the money from the pot"
            value={d.spentBy}
            onChange={(v) => upd({ spentBy: v })}
            options={members.map((m) => [m.email, m.name] as [string, string])}
          />
          <Field label="What was it for? Optional">
            <input
              className="input"
              placeholder="e.g. Sunday lunch with parents"
              value={d.purpose}
              onChange={(e) => upd({ purpose: e.target.value })}
            />
          </Field>
        </div>

        <h2 className="h2" style={{ margin: '6px 0 0' }}>
          {d.lines.length ? `Items (${d.lines.length})` : 'Items'}
        </h2>
        {d.lines.map((l) => {
          const it = l.itemId ? itemById.get(l.itemId) : undefined;
          const low = l.confidence !== undefined && l.confidence < LOW_CONFIDENCE && !l.confirmed;
          const noCat = !l.category;
          return (
            <div
              key={l.id}
              className="card stack"
              style={{
                padding: '12px 8px 12px 14px',
                gap: 8,
                borderColor: noCat ? 'var(--red)' : low ? 'var(--saffron)' : undefined,
                background: low ? 'var(--saffron-soft)' : undefined,
              }}
            >
              {l.rawText && <div className="mono">{l.rawText}</div>}
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <input
                  className="input grow"
                  aria-label="Item name"
                  value={l.name}
                  onChange={(e) => updLine(l.id, { name: e.target.value })}
                  style={{ fontWeight: 700, height: 44 }}
                />
                <button
                  type="button"
                  className="icon-btn muted"
                  aria-label={`Remove ${l.name}`}
                  onClick={() => upd({ lines: d.lines.filter((x) => x.id !== l.id) })}
                >
                  <IconClose size={18} />
                </button>
              </div>
              <div className="row" style={{ gap: 6, paddingRight: 6 }}>
                <DecimalInput
                  className="input input-sm"
                  aria-label="Quantity"
                  style={{ width: 70 }}
                  value={l.quantity}
                  onChange={(e) => updLine(l.id, { quantity: e.target.value })}
                />
                <select
                  className="input input-sm"
                  aria-label="Unit"
                  style={{ width: 70 }}
                  value={l.unit}
                  onChange={(e) => updLine(l.id, { unit: e.target.value as Unit })}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
                <DecimalInput
                  className="input input-sm grow"
                  aria-label="Price in lei"
                  placeholder="Price"
                  style={{ textAlign: 'right' }}
                  value={l.price}
                  onChange={(e) => updLine(l.id, { price: e.target.value })}
                />
                <span className="small muted">lei</span>
              </div>
              <div className="row-between" style={{ paddingRight: 6 }}>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="small bold" style={{ color: noCat ? 'var(--red)' : 'var(--muted)' }}>
                    {l.category ? catLabel(l.category, l.subcategory) : 'Needs a category'}
                  </span>
                  {l.auto && l.category && (
                    <span className="tag tag-cobalt" style={{ fontSize: 12 }}>
                      Suggested
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ height: 36, borderWidth: 1, fontSize: 14 }}
                  onClick={() => setPicking(l.id)}
                >
                  {l.category ? 'Change' : 'Pick category'}
                </button>
              </div>
              {!editing && (
                <div
                  className="row-between"
                  style={{ paddingRight: 6, borderTop: '1px solid var(--track)', paddingTop: 8 }}
                >
                  <span
                    className="small"
                    style={{ color: it ? 'var(--cobalt)' : 'var(--muted)', fontWeight: 700 }}
                  >
                    {it
                      ? `Matches ${it.name} in your items`
                      : l.toStock
                        ? 'New item, added to your items'
                        : 'Not one of your items'}
                    {low && ' (please check)'}
                  </span>
                  <button
                    type="button"
                    className="row small"
                    role="switch"
                    aria-checked={l.toStock}
                    aria-label={`Add ${l.name} to stock`}
                    style={{
                      border: 0,
                      background: 'transparent',
                      gap: 8,
                      minHeight: 44,
                      color: 'var(--ink)',
                    }}
                    onClick={() => updLine(l.id, { toStock: !l.toStock })}
                  >
                    {fmtQty(parseDecimal(l.quantity) || 0, l.unit)} to stock
                    <span className="switch" data-on={l.toStock} />
                  </button>
                </div>
              )}
              {low && it && (
                <div className="grid-2">
                  <button
                    type="button"
                    className="btn btn-ink btn-md"
                    style={{ fontSize: 15 }}
                    onClick={() => updLine(l.id, { confirmed: true })}
                  >
                    Yes, it's {it.name}
                  </button>
                  <button
                    type="button"
                    className="btn btn-md"
                    style={{ border: '2px solid var(--ink)', background: 'transparent', fontSize: 15 }}
                    onClick={() => updLine(l.id, { itemId: undefined, confirmed: true })}
                  >
                    It's something else
                  </button>
                </div>
              )}
              {openNote === l.id || l.note ? (
                <input
                  className="input input-sm"
                  aria-label={`Note for ${l.name}`}
                  placeholder="Note, e.g. for the party"
                  value={l.note ?? ''}
                  onChange={(e) => updLine(l.id, { note: e.target.value })}
                />
              ) : (
                <button
                  type="button"
                  className="link-btn small"
                  style={{ alignSelf: 'flex-start', minHeight: 32 }}
                  onClick={() => setOpenNote(l.id)}
                >
                  Add a note
                </button>
              )}
            </div>
          );
        })}

        {!receipt && (
          <form
            className="dashed stack"
            style={{ gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              addLine();
            }}
          >
            <span className="bold">Add an item</span>
            <input
              className="input"
              aria-label="Item name"
              placeholder="Item name, e.g. Cașcaval"
              value={ln.name}
              onChange={(e) => setLn({ ...ln, name: e.target.value })}
            />
            <span
              className="small bold"
              style={{
                color: !ln.name.trim() ? 'var(--muted)' : guess ? 'var(--cobalt)' : 'var(--saffron-ink)',
              }}
            >
              {!ln.name.trim()
                ? 'A category is suggested as you type'
                : guess
                  ? `Category: ${catLabel(guess.category, guess.subcategory)}`
                  : "No category found. You'll pick one after adding."}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <DecimalInput
                className="input"
                aria-label="Quantity"
                style={{ width: 80, height: 44 }}
                value={ln.quantity}
                onChange={(e) => setLn({ ...ln, quantity: e.target.value })}
              />
              <div className="unit-grid grow" role="group" aria-label="Unit" style={{ gap: 4 }}>
                {UNITS.map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={ln.unit === u}
                    onClick={() => setLn({ ...ln, unit: u })}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            <div className="row">
              <DecimalInput
                className="input grow"
                aria-label="Price in lei"
                placeholder="Price in lei"
                value={ln.price}
                onChange={(e) => setLn({ ...ln, price: e.target.value })}
              />
              <button type="submit" className="btn btn-ink btn-md" disabled={!ln.name.trim()}>
                Add item
              </button>
            </div>
          </form>
        )}
        {d.printedTotal !== undefined && (
          <div
            className={`callout ${Math.abs(diff) < 0.01 ? 'callout-cobalt' : 'callout-saffron'} bold`}
            style={{ fontSize: 15 }}
          >
            {Math.abs(diff) < 0.01
              ? `Lines add up to ${money(total)}, same as the receipt total`
              : `Lines add up to ${money(total)}, the receipt says ${money(d.printedTotal)}: ${money(Math.abs(diff))} ${diff > 0 ? 'missing' : 'too much'}. Fix a line, or save with the receipt total.`}
          </div>
        )}
        {editing && (
          <p className="small muted">Editing a purchase doesn't change stock. Use Stock for that.</p>
        )}
      </div>
      <div className="full-foot">
        {problem && (tried || d.lines.length > 0) && <span className="problem">{problem}</span>}
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!!problem && tried}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : label}
        </button>
      </div>
      {picking && (
        <CategoryPicker
          onClose={() => setPicking(null)}
          onPick={(c, s) => {
            updLine(picking, { category: c, subcategory: s, auto: false });
            setPicking(null);
          }}
        />
      )}
    </FullScreen>
  );
}
