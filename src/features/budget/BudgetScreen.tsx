import { useEffect, useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useRun, useSnapshot, useStore } from '../../app/data';
import { useSession } from '../../auth/session';
import { useScreenContext } from '../../app/assistantUi';
import {
  Chip,
  DecimalInput,
  DeleteButton,
  Field,
  Loading,
  MonthSwitcher,
  PageHeader,
  Choice,
} from '../../ui/controls';
import { IconReceipt } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { balanceBefore, ledger, monthSummary, potBalance, type LedgerEntry } from '../../domain/budget';
import {
  dayLabel,
  money,
  monthLabel,
  monthName,
  num,
  parseDecimal,
  plural,
  qty as fmtQty,
  unitPriceLabel,
} from '../../domain/format';
import { currentMonth, shiftMonth, todayISO } from '../../domain/dates';
import { normalise } from '../../domain/categorise';
import { bars } from '../../domain/insights';
import { isAssistantActor, type Snapshot } from '../../domain/actions';
import type { Contribution, Member } from '../../domain/schemas';
import { PurchaseEditor, draftFromPurchase } from './PurchaseEditor';
import { PhotoNotSharedError, driveFileLink } from '../../storage/drive';

type Row = LedgerEntry & { balanceAfter: number };
type Filter =
  { kind: 'all' | 'in' | 'out' } | { kind: 'person'; email: string } | { kind: 'category'; name: string };

const memberOf = (snap: Snapshot, email: string): Member =>
  snap.household.members.find((m) => m.email === email) ?? {
    email,
    name: email.split('@')[0],
    color: '#566070',
  };

function shortDate(iso: string) {
  try {
    return format(parseISO(iso), 'd MMM');
  } catch {
    return '';
  }
}

function auditText(r: Row): string {
  const src = r.kind === 'out' ? r.p : r.kind === 'in' ? r.c : null;
  if (!src) return '';
  const created =
    'createdBy' in src && src.createdBy
      ? `Added by ${src.createdBy} on ${shortDate(src.createdAt ?? '')}`
      : '';
  const how = r.kind === 'out' ? (r.p.source === 'receipt' ? ' from a receipt scan' : ' by hand') : '';
  const edited = src.editedBy ? `, edited by ${src.editedBy} on ${shortDate(src.editedAt ?? '')}` : '';
  return `${created}${how}${edited}`;
}

export function BudgetScreen() {
  useScreenContext('budget', 'Looking at Budget');
  const { snap } = useSnapshot();
  const { run } = useRun();
  const toast = useToast();
  const [ym, setYm] = useState(currentMonth());
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [money_, setMoney] = useState<Contribution | 'new' | null>(null);
  const [purchase, setPurchase] = useState<string | 'new' | null>(null);
  const [adjust, setAdjust] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const [catPick, setCatPick] = useState(false);
  const [photo, setPhoto] = useState<string[] | null>(null);

  const budgets = useMemo(() => (snap ? Object.values(snap.budgets) : []), [snap]);
  const rows = useMemo(() => ledger(budgets), [budgets]);
  if (!snap) return <Loading text="Loading the pot…" />;

  const firstYm = rows[0]?.date.slice(0, 7) ?? currentMonth();
  const pot = potBalance(budgets);
  const emails = snap.household.members.map((m) => m.email);
  const sum = monthSummary(budgets, ym, snap.household.monthlyTarget, emails);
  const nq = normalise(q);
  const shown = rows
    .filter((r) => r.date.startsWith(ym))
    .filter((r) => {
      if (filter.kind === 'in') return r.kind === 'in';
      if (filter.kind === 'out') return r.kind === 'out';
      if (filter.kind === 'person') return r.by === filter.email;
      if (filter.kind === 'category')
        return r.kind === 'out' && r.p.lines.some((l) => l.category === filter.name);
      return true;
    })
    .filter((r) => {
      if (!nq) return true;
      if (r.kind === 'out')
        return normalise(
          `${r.p.store} ${r.p.purpose ?? ''} ${r.p.lines.map((l) => l.name).join(' ')}`,
        ).includes(nq);
      if (r.kind === 'in') return normalise(`${r.c.note ?? ''} ${memberOf(snap, r.by).name}`).includes(nq);
      return normalise(r.a.reason).includes(nq);
    })
    .reverse();
  const deleted = budgets
    .flatMap((b) => b.deleted)
    .filter((x) => x.at.slice(0, 10) >= shiftMonth(currentMonth(), -1) + '-01')
    .slice(-5)
    .reverse();
  const pct = Math.min(100, Math.round(sum.progress * 100));
  const barColor =
    sum.tone === 'over' ? 'var(--red)' : sum.tone === 'warn' ? 'var(--saffron)' : 'var(--cobalt)';

  const purchaseRow =
    purchase && purchase !== 'new' ? rows.find((r) => r.kind === 'out' && r.id === purchase) : undefined;

  return (
    <>
      <PageHeader title="Budget" />
      <div className="plate" style={{ marginTop: 16 }}>
        <div className="plate-inner">
          <span style={{ fontSize: 15 }}>In the pot right now</span>
          <span className="plate-num" aria-live="polite">
            {money(pot)}
          </span>
          <div className="grid-2" style={{ marginTop: 14 }}>
            <button type="button" className="btn btn-md plate-btn" onClick={() => setMoney('new')}>
              Add money
            </button>
            <button type="button" className="btn btn-md plate-btn-outline" onClick={() => setPurchase('new')}>
              Add purchase
            </button>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <MonthSwitcher
          label={monthLabel(ym)}
          onPrev={() => setYm(shiftMonth(ym, -1))}
          onNext={() => setYm(shiftMonth(ym, 1))}
          prevDisabled={ym <= firstYm}
          nextDisabled={ym >= currentMonth()}
        />
      </div>
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <div className="muted" style={{ fontSize: 15 }}>
          Started {monthName(ym)} with {money(balanceBefore(budgets, ym))} in the pot
        </div>
        <div style={{ fontSize: 17 }}>
          <strong>{money(sum.spent)}</strong> spent{sum.target ? ` of the ${money(sum.target)} target` : ''}
        </div>
        {sum.target > 0 && (
          <>
            <div
              className="progress"
              role="progressbar"
              aria-label="Spent of the monthly target"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div style={{ width: `${pct}%`, background: barColor }} />
            </div>
            <div
              className="muted"
              style={{ fontSize: 15, color: sum.tone === 'over' ? 'var(--red)' : undefined }}
            >
              {sum.spent <= sum.target
                ? `${money(sum.target - sum.spent)} left before you reach the target`
                : `${money(sum.spent - sum.target)} over the target this month`}
            </div>
          </>
        )}
        <div className="stack" style={{ gap: 4, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
          {snap.household.members.map((m) => (
            <button key={m.email} type="button" className="row person-row" onClick={() => setPerson(m.email)}>
              <span className="dot" style={{ background: m.color }} />
              <span className="bold" style={{ minWidth: 60 }}>
                {m.name}
              </span>
              <span className="grow muted" style={{ fontSize: 15, textAlign: 'left' }}>
                put in {money(sum.byPerson[m.email]?.in ?? 0)}, spent {money(sum.byPerson[m.email]?.out ?? 0)}
              </span>
              <span className="chev" aria-hidden>
                ›
              </span>
            </button>
          ))}
        </div>
      </div>

      <h2 className="h2">History</h2>
      <div className="hscroll bleed">
        <Chip pressed={filter.kind === 'all'} onClick={() => setFilter({ kind: 'all' })}>
          All
        </Chip>
        <Chip pressed={filter.kind === 'in'} onClick={() => setFilter({ kind: 'in' })}>
          Money in
        </Chip>
        <Chip pressed={filter.kind === 'out'} onClick={() => setFilter({ kind: 'out' })}>
          Money out
        </Chip>
        {snap.household.members.map((m) => (
          <Chip
            key={m.email}
            pressed={filter.kind === 'person' && filter.email === m.email}
            onClick={() => setFilter({ kind: 'person', email: m.email })}
          >
            {m.name}
          </Chip>
        ))}
        <Chip pressed={filter.kind === 'category'} onClick={() => setCatPick(true)}>
          {filter.kind === 'category' ? filter.name : 'Category'}
        </Chip>
      </div>
      <input
        type="search"
        className="input search"
        style={{ marginTop: 10 }}
        aria-label="Search history"
        placeholder="Search by item or store"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="list" style={{ marginTop: 12 }}>
        {shown.map((r) => (
          <LedgerRow
            key={r.id}
            r={r}
            snap={snap}
            open={open === r.id}
            onToggle={() => setOpen(open === r.id ? null : r.id)}
            onEdit={() => {
              if (r.kind === 'in') setMoney(r.c);
              else if (r.kind === 'out') setPurchase(r.id);
              else toast.show('Adjustments can only be deleted. Add a new one with the right amount.');
            }}
            onDelete={() => {
              const name =
                r.kind === 'in'
                  ? 'deleteContribution'
                  : r.kind === 'out'
                    ? 'deletePurchase'
                    : 'deleteAdjustment';
              void run(
                name,
                { id: r.id },
                { toast: r.kind === 'out' ? `${r.p.store} purchase deleted` : 'Deleted' },
              );
              setOpen(null);
            }}
            onPhoto={(ids) => setPhoto(ids)}
          />
        ))}
        {shown.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: '20px 16px' }}>
            {rows.some((r) => r.date.startsWith(ym))
              ? 'Nothing here for this filter.'
              : `Nothing in ${monthName(ym)} yet. Add money or a purchase above.`}
          </p>
        )}
      </div>
      {deleted.length > 0 && (
        <>
          <h2 className="group-title">Recently deleted</h2>
          <div className="list">
            {deleted.map((x) => {
              const s = x.snapshot as {
                store?: string;
                total?: number;
                amount?: number;
                by?: string;
                date?: string;
              };
              return (
                <div key={x.id} className="row" style={{ padding: '10px 12px 10px 16px' }}>
                  <span className="grow stack" style={{ gap: 0 }}>
                    <span className="bold">
                      {x.kind === 'purchase'
                        ? `${s.store}, ${money(s.total ?? 0)}`
                        : x.kind === 'contribution'
                          ? `${memberOf(snap, s.by ?? '').name} added ${money(s.amount ?? 0)}`
                          : `Adjustment ${money(s.amount ?? 0, { sign: true })}`}
                    </span>
                    <span className="small muted">
                      Deleted by {x.by} on {shortDate(x.at)}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void run('restoreDeleted', { id: x.id }, { toast: 'Restored' })}
                  >
                    Restore
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="small muted" style={{ marginTop: 16, textAlign: 'center' }}>
        The pot doesn't match the real money?{' '}
        <button type="button" className="link-btn" style={{ minHeight: 32 }} onClick={() => setAdjust(true)}>
          Adjust it
        </button>
      </p>

      {money_ && (
        <MoneySheet
          entry={money_ === 'new' ? undefined : money_}
          onClose={() => setMoney(null)}
          onSaved={(d) => setYm(d.slice(0, 7))}
        />
      )}
      {purchase === 'new' && (
        <PurchaseEditor onClose={() => setPurchase(null)} onSaved={() => setYm(currentMonth())} />
      )}
      {purchaseRow && purchaseRow.kind === 'out' && (
        <PurchaseEditor initial={draftFromPurchase(purchaseRow.p)} onClose={() => setPurchase(null)} />
      )}
      {adjust && <AdjustSheet onClose={() => setAdjust(false)} />}
      {person && <PersonSheet email={person} ym={ym} onClose={() => setPerson(null)} />}
      {catPick && (
        <Sheet onClose={() => setCatPick(false)} title="Show purchases with" labelledBy="bcat-title">
          <div className="grid-2">
            {snap.household.categories.map((c) => (
              <button
                key={c.name}
                type="button"
                className="cat-opt"
                onClick={() => {
                  setFilter({ kind: 'category', name: c.name });
                  setCatPick(false);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {photo && <ReceiptPhotos ids={photo} onClose={() => setPhoto(null)} />}
    </>
  );
}

function LedgerRow({
  r,
  snap,
  open,
  onToggle,
  onEdit,
  onDelete,
  onPhoto,
}: {
  r: Row;
  snap: Snapshot;
  open: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPhoto: (ids: string[]) => void;
}) {
  const m = memberOf(snap, r.by);
  const via =
    (r.kind === 'out' && isAssistantActor(r.p.createdBy)) ||
    (r.kind === 'in' && isAssistantActor(r.c.createdBy));
  const title = r.kind === 'in' ? `${m.name} added money` : r.kind === 'out' ? r.p.store : 'Pot adjustment';
  const sub =
    r.kind === 'in'
      ? r.c.note || 'No note'
      : r.kind === 'out'
        ? `Spent by ${m.name}${r.p.time ? `, ${r.p.time}` : ''}${r.p.purpose ? `, ${r.p.purpose.toLowerCase()}` : ''}`
        : r.a.reason;
  const photos =
    r.kind === 'out' ? (r.p.receiptFileIds ?? (r.p.receiptFileId ? [r.p.receiptFileId] : [])) : [];
  return (
    <div>
      <button type="button" className="ledger-row" aria-expanded={open} onClick={onToggle}>
        <span
          className="dot"
          style={{ background: r.kind === 'adj' ? 'var(--muted)' : m.color, marginTop: 6 }}
        />
        <span className="grow stack" style={{ gap: 0 }}>
          <span className="title">{title}</span>
          <span className="sub">
            {sub}
            {via && ' · via Assistant'}
          </span>
        </span>
        <span className="stack" style={{ gap: 0, alignItems: 'flex-end' }}>
          <span className="bold num" style={{ color: r.kind === 'out' ? 'var(--ink)' : 'var(--cobalt)' }}>
            {r.kind === 'out' ? money(-r.amount) : money(r.amount, { sign: true })}
          </span>
          <span className="tiny muted">{dayLabel(r.date)}</span>
        </span>
      </button>
      {open && (
        <div className="stack" style={{ padding: '0 16px 16px 40px', gap: 10 }}>
          {r.kind === 'out' &&
            r.p.lines.map((l) => (
              <div key={l.id} className="ledger-line">
                <span className="stack" style={{ gap: 0 }}>
                  <span>{l.name}</span>
                  <span className="tiny muted">
                    {l.category} › {l.subcategory}
                    {l.quantity !== 1 || l.unit !== 'pcs'
                      ? `, ${unitPriceLabel(l.price, l.quantity, l.unit)}`
                      : ''}
                  </span>
                  {l.note && (
                    <span className="tiny" style={{ fontStyle: 'italic' }}>
                      {l.note}
                    </span>
                  )}
                </span>
                <span className="muted" style={{ textAlign: 'right' }}>
                  {fmtQty(l.quantity, l.unit)}
                </span>
                <span className="num" style={{ textAlign: 'right' }}>
                  {money(l.price)}
                </span>
              </div>
            ))}
          {r.kind === 'out' && Math.abs(r.p.lines.reduce((t, l) => t + l.price, 0) - r.p.total) > 0.009 && (
            <span className="small muted">
              Receipt total {money(r.p.total)} (lines add up to{' '}
              {money(r.p.lines.reduce((t, l) => t + l.price, 0))})
            </span>
          )}
          {photos.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              style={{
                border: '1px dashed var(--line-strong)',
                background: 'var(--surface-2)',
                color: 'var(--cobalt)',
                alignSelf: 'flex-start',
                height: 44,
              }}
              onClick={() => onPhoto(photos)}
            >
              <IconReceipt />
              View receipt {photos.length > 1 ? `photos (${photos.length})` : 'photo'}
            </button>
          )}
          <div className="small muted">Pot after this: {money(r.balanceAfter)}</div>
          <div className="small muted">
            {r.kind === 'adj' ? `Added by ${memberOf(snap, r.a.by).name}` : auditText(r)}
          </div>
          <div className="grid-2">
            <button type="button" className="btn btn-outline btn-md" onClick={onEdit}>
              Edit
            </button>
            <DeleteButton label="Delete" className="btn btn-danger btn-md" onDelete={onDelete} />
          </div>
        </div>
      )}
    </div>
  );
}

export function MoneySheet({
  entry,
  prefill,
  onClose,
  onSaved,
}: {
  entry?: Contribution;
  /** values for a new contribution (e.g. from the Assistant) */
  prefill?: { amount?: number; by?: string; date?: string; note?: string };
  onClose: () => void;
  onSaved: (date: string) => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const { email: meEmail } = useSession();
  const members = snap?.household.members ?? [];
  const src = entry ?? prefill;
  const [amount, setAmount] = useState(src?.amount ? num(src.amount) : '');
  const [by, setBy] = useState(src?.by ?? meEmail);
  const [date, setDate] = useState(src?.date ?? todayISO());
  const [note, setNote] = useState(src?.note ?? '');
  const v = parseDecimal(amount);
  const ok = v > 0 && !!by;
  return (
    <Sheet
      onClose={onClose}
      title={entry ? 'Edit contribution' : 'Add money to the pot'}
      labelledBy="money-title"
    >
      <Field label="Amount in lei">
        <DecimalInput
          className="input input-lg"
          placeholder="500"
          value={amount}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Choice
        label="Who is putting it in"
        value={by}
        onChange={setBy}
        options={members.map((m) => [m.email, m.name] as [string, string])}
      />
      <div className="grid-2" style={{ gap: 10 }}>
        <Field label="Date">
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </Field>
        <Field label="Note, optional">
          <input
            className="input"
            placeholder="Monthly contribution"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!ok}
        onClick={async () => {
          const input = { date, by, amount: v, note: note.trim() || undefined };
          const name = members.find((m) => m.email === by)?.name ?? '';
          const r = entry
            ? await run('updateContribution', { id: entry.id, ...input }, { toast: 'Contribution updated' })
            : await run('addContribution', input, { toast: `${name} added ${money(v)} to the pot` });
          if (r) {
            onSaved(date);
            onClose();
          }
        }}
      >
        {ok ? (entry ? `Save ${money(v)}` : `Add ${money(v)} to the pot`) : 'Enter an amount'}
      </button>
    </Sheet>
  );
}

function AdjustSheet({ onClose }: { onClose: () => void }) {
  const { run } = useRun();
  const { snap } = useSnapshot();
  const [dir, setDir] = useState<'add' | 'remove'>('remove');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const v = parseDecimal(amount);
  const pot = snap ? potBalance(Object.values(snap.budgets)) : 0;
  const ok = v > 0 && reason.trim().length > 0;
  return (
    <Sheet onClose={onClose} title="Adjust the pot" labelledBy="adj-title">
      <p className="muted" style={{ margin: 0, fontSize: 15 }}>
        For when the app's {money(pot)} doesn't match the real money, for example after counting cash or a
        bank fee. It shows in the history with your reason.
      </p>
      <Choice
        label="The real pot has"
        value={dir}
        onChange={setDir}
        options={[
          ['remove', 'Less money'],
          ['add', 'More money'],
        ]}
      />
      <Field label="By how much, in lei">
        <DecimalInput placeholder="12,50" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="Reason">
        <input
          className="input"
          placeholder="e.g. Counted the cash, bank fee"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!ok}
        onClick={async () => {
          if (
            await run(
              'adjustPot',
              { date: todayISO(), amount: dir === 'add' ? v : -v, reason: reason.trim() },
              { toast: 'Pot adjusted' },
            )
          )
            onClose();
        }}
      >
        {ok
          ? `Adjust the pot by ${money(dir === 'add' ? v : -v, { sign: true })}`
          : reason.trim()
            ? 'Enter an amount'
            : 'Add a reason'}
      </button>
    </Sheet>
  );
}

function PersonSheet({ email, ym, onClose }: { email: string; ym: string; onClose: () => void }) {
  const { snap } = useSnapshot();
  if (!snap) return null;
  const m = memberOf(snap, email);
  const budgets = Object.values(snap.budgets);
  const contributions = budgets
    .flatMap((b) => b.contributions)
    .filter((c) => c.by === email && c.date.startsWith(ym));
  const purchases = budgets
    .flatMap((b) => b.purchases)
    .filter((p) => p.spentBy === email && p.date.startsWith(ym))
    .sort((a, b) => b.date.localeCompare(a.date));
  const lines = purchases.flatMap((p) => p.lines);
  const cats = bars(
    lines,
    (l) => l.category,
    (l) => l.price,
  );
  const putIn = contributions.reduce((t, c) => t + c.amount, 0);
  const spent = purchases.reduce((t, p) => t + p.total, 0);
  return (
    <Sheet onClose={onClose} title={`${m.name} in ${monthName(ym)}`} labelledBy="person-title">
      <div className="grid-2">
        <div className="card card-pad stack" style={{ gap: 0 }}>
          <span className="small muted">Put in</span>
          <span className="display bold num" style={{ fontSize: 22, color: 'var(--cobalt)' }}>
            {money(putIn)}
          </span>
        </div>
        <div className="card card-pad stack" style={{ gap: 0 }}>
          <span className="small muted">Spent</span>
          <span className="display bold num" style={{ fontSize: 22 }}>
            {money(spent)}
          </span>
        </div>
      </div>
      {cats.length > 0 && (
        <>
          <span className="bold">By category</span>
          <div className="stack" style={{ gap: 8 }}>
            {cats.map((c) => (
              <div key={c.key} className="stack" style={{ gap: 4 }}>
                <span className="row-between">
                  <span className="bold">{c.key}</span>
                  <span className="num">{money(c.value)}</span>
                </span>
                <span className="bar-track">
                  <span
                    className="bar-fill"
                    style={{ width: `${Math.max(2, Math.round(c.rel * 100))}%`, background: m.color }}
                  />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <span className="bold">Purchases ({purchases.length})</span>
      <div className="list">
        {purchases.map((p) => (
          <div key={p.id} className="stack" style={{ gap: 2, padding: '10px 14px' }}>
            <span className="row-between">
              <span className="bold">{p.store}</span>
              <span className="num">{money(-p.total)}</span>
            </span>
            <span className="small muted">
              {dayLabel(p.date)}: {p.lines.map((l) => l.name).join(', ')}
            </span>
          </div>
        ))}
        {purchases.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: 14 }}>
            No purchases this month.
          </p>
        )}
      </div>
      {contributions.length > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {plural(contributions.length, 'contribution')}:{' '}
          {contributions.map((c) => `${money(c.amount)} on ${dayLabel(c.date)}`).join(', ')}
        </p>
      )}
    </Sheet>
  );
}

function ReceiptPhotos({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const store = useStore();
  const [urls, setUrls] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notShared, setNotShared] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    Promise.all(ids.map((id) => store.adapter.getImageUrl(id)))
      .then((u) => {
        made.push(...u);
        if (alive) setUrls(u);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof PhotoNotSharedError) setNotShared(ids);
        else setErr(e instanceof Error ? e.message : "Couldn't load the photo.");
      });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [ids, store]);
  return (
    <Sheet onClose={onClose} title="Receipt" labelledBy="rcpt-title">
      {err && <p className="problem">{err}</p>}
      {notShared.length > 0 && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>
            This photo was added from the other phone, so Google only lets you open it in Drive.
          </p>
          {notShared.map((id, i) => (
            <a
              key={id}
              className="btn btn-outline btn-md"
              href={driveFileLink(id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open photo {notShared.length > 1 ? i + 1 : ''} in Google Drive
            </a>
          ))}
        </div>
      )}
      {!err && !notShared.length && !urls.length && <Loading text="Loading the photo…" />}
      {urls.map((u, i) => (
        <img
          key={u}
          src={u}
          alt={`Receipt photo ${i + 1} of ${urls.length}`}
          style={{ width: '100%', borderRadius: 12 }}
        />
      ))}
    </Sheet>
  );
}
