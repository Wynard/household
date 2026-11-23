import { useMemo, useState } from 'react';
import { useRun, useSnapshot } from '../../app/data';
import { useSession } from '../../auth/session';
import { Chip, Choice, DecimalInput, Field } from '../../ui/controls';
import { IconPlus } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { recentDescriptions } from '../../domain/budget';
import { money, moneyInput, parseDecimal, plural } from '../../domain/format';
import { todayISO } from '../../domain/dates';
import type { Purchase } from '../../domain/schemas';
import { NameEditor } from '../settings/common';

/**
 * Adds or edits a purchase paid from the pot: the amount, a budget category,
 * who paid, the date and an optional description. No items, no store.
 */
export function PurchaseSheet({
  purchase,
  onClose,
  onSaved,
}: {
  /** the purchase to edit; none to add a new one */
  purchase?: Purchase;
  onClose: () => void;
  onSaved?: (date: string) => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const { email: meEmail } = useSession();
  const members = snap?.household.members ?? [];
  const cats = snap?.household.budgetCategories ?? [];
  const budgets = useMemo(() => (snap ? Object.values(snap.budgets) : []), [snap]);

  const start = {
    amount: purchase ? moneyInput(purchase.total) : '',
    category: purchase?.category ?? '',
    by: purchase?.spentBy ?? meEmail,
    date: purchase?.date ?? todayISO(),
    purpose: purchase?.purpose ?? '',
  };
  const [f, setF] = useState(start);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const v = parseDecimal(f.amount);
  const problem = !(v > 0) ? 'Enter an amount' : !f.category ? 'Pick a category' : null;
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const suggestions = f.category
    ? recentDescriptions(budgets, f.category).filter(
        (s) => s.toLowerCase() !== f.purpose.trim().toLowerCase(),
      )
    : [];

  const save = async () => {
    if (problem || busy) return;
    setBusy(true);
    const input = {
      date: f.date,
      spentBy: f.by,
      category: f.category,
      ...(f.purpose.trim() ? { purpose: f.purpose.trim() } : {}),
    };
    const r = purchase
      ? await run('updatePurchase', { id: purchase.id, total: v, ...input }, { toast: 'Purchase updated' })
      : await run('addPurchase', { total: v, ...input }, { toast: `${money(v)} for ${f.category} saved` });
    setBusy(false);
    if (r) {
      onSaved?.(f.date);
      onClose();
    }
  };

  return (
    <Sheet
      onClose={onClose}
      title={purchase ? 'Edit purchase' : 'Add a purchase'}
      labelledBy="purchase-title"
      dirty={dirty}
      footer={
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!!problem || busy}
          onClick={() => void save()}
        >
          {busy ? 'Saving…' : (problem ?? `Save ${money(v)}`)}
        </button>
      }
    >
      <Field label="Amount in lei">
        <DecimalInput
          className="input input-lg"
          placeholder="120"
          value={f.amount}
          autoFocus={!purchase}
          onChange={(e) => set({ amount: e.target.value })}
        />
      </Field>
      <div className="stack-sm">
        <span className="field-label" id="pcat-label">
          Category
        </span>
        <div className="wrap" role="group" aria-labelledby="pcat-label">
          {cats.map((c) => (
            <Chip key={c} pressed={f.category === c} onClick={() => set({ category: c })}>
              {c}
            </Chip>
          ))}
          <Chip className="chip-dashed" onClick={() => setAdding(true)} aria-label="New category">
            <IconPlus size={16} />
            New
          </Chip>
        </div>
      </div>
      <Choice
        label="Who paid"
        value={f.by}
        onChange={(by) => set({ by })}
        options={members.map((m) => [m.email, m.name] as [string, string])}
      />
      <div className="stack-sm">
        <Field label="Description, optional">
          <input
            className="input"
            placeholder="What it was, or where"
            value={f.purpose}
            onChange={(e) => set({ purpose: e.target.value })}
          />
        </Field>
        {suggestions.length > 0 && (
          <div className="hscroll" style={{ gap: 6 }} role="group" aria-label="Used before">
            {suggestions.map((s) => (
              <button key={s} type="button" className="chip chip-sm" onClick={() => set({ purpose: s })}>
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
      <Field label="Date">
        <input
          type="date"
          className="input"
          value={f.date}
          max={todayISO()}
          onChange={(e) => e.target.value && set({ date: e.target.value })}
        />
      </Field>
      {purchase && purchase.lines.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          The {plural(purchase.lines.length, 'item')} from the receipt stay as they are. Stock doesn't change.
        </p>
      )}
      {adding && (
        <NameEditor
          title="New budget category"
          existing={cats}
          onSave={async (name) => {
            const r = await run('addBudgetCategory', { name }, { toast: `${name} added` });
            if (r) set({ category: name });
            return !!r;
          }}
          onClose={() => setAdding(false)}
        />
      )}
    </Sheet>
  );
}
