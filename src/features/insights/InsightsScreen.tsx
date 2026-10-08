import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useSnapshot } from '../../app/data';
import { useScreenContext } from '../../app/assistantUi';
import { Chip, Loading, MonthSwitcher, PageHeader, Seg } from '../../ui/controls';
import { IconClose, IconFilter } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { currentMonth, shiftMonth } from '../../domain/dates';
import { money, monthLabel, monthName, plural, qty as fmtQty } from '../../domain/format';
import { priceHistory, spendingInsights, usageInsights, type Bar, type Filters } from '../../domain/insights';
import type { Snapshot } from '../../domain/actions';
import { personKey } from '../../ui/person';

type BarTone = '' | 'use' | 'over';

type View = 'spend' | 'use';

/** Insights state lives in the URL so the Assistant can link to a filtered view. */
export function insightsLink(p: { ym?: string; view?: View } & Filters) {
  const q = new URLSearchParams();
  if (p.ym) q.set('m', p.ym);
  if (p.view === 'use') q.set('v', 'use');
  if (p.person) q.set('p', p.person);
  if (p.category) q.set('c', p.category);
  if (p.subcategory) q.set('s', p.subcategory);
  if (p.store) q.set('st', p.store);
  const s = q.toString();
  return `/insights${s ? `?${s}` : ''}`;
}

export function InsightsScreen() {
  useScreenContext('insights', 'Looking at Insights');
  const { snap } = useSnapshot();
  const [params, setParams] = useSearchParams();
  const ym = params.get('m') ?? currentMonth();
  const view: View = params.get('v') === 'use' ? 'use' : 'spend';
  const pP = params.get('p');
  const pC = params.get('c');
  const pS = params.get('s');
  const pSt = params.get('st');
  const f: Filters = useMemo(
    () => ({
      person: pP ?? undefined,
      category: pC ?? undefined,
      subcategory: pS ?? undefined,
      store: view === 'spend' ? (pSt ?? undefined) : undefined,
    }),
    [pP, pC, pS, pSt, view],
  );
  const set = (patch: Partial<{ ym: string; view: View } & Filters>) =>
    setParams(
      new URLSearchParams(
        insightsLink({ ym, view, ...f, store: params.get('st') ?? undefined, ...patch }).split('?')[1] ?? '',
      ),
      { replace: true },
    );
  const [filters, setFilters] = useState(false);
  const [priceOf, setPriceOf] = useState<{ itemId?: string; name: string } | null>(null);

  const budgets = useMemo(() => (snap ? Object.values(snap.budgets) : []), [snap]);
  const usage = useMemo(() => (snap ? Object.values(snap.usage) : []), [snap]);
  const inProgress = ym === currentMonth();
  const sp = useMemo(
    () => spendingInsights(budgets, ym, f, inProgress ? { upToDay: new Date().getDate() } : {}),
    [budgets, ym, f, inProgress],
  );
  const simpleIds = useMemo(
    () => new Set((snap?.items.items ?? []).filter((i) => i.tracking === 'simple').map((i) => i.id)),
    [snap],
  );
  const us = useMemo(
    () => usageInsights(usage, budgets, ym, f, simpleIds),
    [usage, budgets, ym, f, simpleIds],
  );
  if (!snap) return <Loading text="Adding things up…" />;

  const members = snap.household.members;
  const nameOf = (e: string) => members.find((m) => m.email === e)?.name ?? e;
  const toneOf = (e: string): BarTone => (personKey(members, e) === 'b' ? 'use' : '');
  const firstYm = budgets
    .flatMap((b) => [...b.purchases, ...b.contributions])
    .reduce((m, x) => (x.date.slice(0, 7) < m ? x.date.slice(0, 7) : m), currentMonth());
  const active: { label: string; clear: () => void }[] = [];
  if (f.person) active.push({ label: nameOf(f.person), clear: () => set({ person: undefined }) });
  if (f.category)
    active.push({ label: f.category, clear: () => set({ category: undefined, subcategory: undefined }) });
  if (f.subcategory) active.push({ label: f.subcategory, clear: () => set({ subcategory: undefined }) });
  if (f.store) active.push({ label: f.store, clear: () => set({ store: undefined }) });
  const prevName = monthName(shiftMonth(ym, -1));
  const drillTitle = !f.category ? 'By category' : !f.subcategory ? `Inside ${f.category}` : f.subcategory;
  const drillHint = !f.category
    ? 'Tap a category to see its subcategories.'
    : !f.subcategory
      ? 'Tap a subcategory to see its items.'
      : 'Tap an item to see its price over time.';
  const drill = (key: string) => {
    if (!f.category) set({ category: key });
    else if (!f.subcategory) set({ subcategory: key });
    else {
      const it = snap.items.items.find((i) => i.name === key);
      setPriceOf({ itemId: it?.id, name: key });
    }
  };

  return (
    <>
      <PageHeader title="Insights" />
      <div style={{ marginTop: 4 }}>
        <MonthSwitcher
          label={monthLabel(ym)}
          onPrev={() => set({ ym: shiftMonth(ym, -1) })}
          onNext={() => set({ ym: shiftMonth(ym, 1) })}
          prevDisabled={ym <= firstYm}
          nextDisabled={ym >= currentMonth()}
        />
      </div>
      <Seg
        label="Spending or consumption"
        value={view}
        onChange={(v) => set({ view: v })}
        options={[
          ['spend', 'Spending'],
          ['use', 'Consumption'],
        ]}
      />
      <div className="wrap" style={{ marginTop: 12, alignItems: 'center' }}>
        <button
          type="button"
          className="chip"
          style={{ border: '2px solid var(--primary)', color: 'var(--primary)' }}
          onClick={() => setFilters(true)}
        >
          <IconFilter />
          {active.length ? `Filters (${active.length})` : 'Filters'}
        </button>
        {active.map((a) => (
          <button
            key={a.label}
            type="button"
            className="chip chip-remove"
            aria-label={`Remove filter ${a.label}`}
            onClick={a.clear}
          >
            {a.label}
            <IconClose size={16} />
          </button>
        ))}
      </div>

      {view === 'spend' ? (
        <>
          <div className="card card-pad stack" style={{ gap: 4, marginTop: 16 }}>
            <span className="muted" style={{ fontSize: 'var(--fs-secondary)' }}>
              Spent in {monthName(ym)}
              {f.person ? ` by ${nameOf(f.person)}` : ''}
            </span>
            <span className="big-num">{money(sp.total)}</span>
            <span
              className="bold"
              style={{
                fontSize: 'var(--fs-secondary)',
                // no color coding: the words say more or less (red is for missing things only)
                color: 'var(--ink)',
              }}
            >
              {sp.comparison.direction === 'none'
                ? sp.comparison.prevTotal === 0 &&
                  budgets.some((b) => b.purchases.some((p) => p.date.startsWith(shiftMonth(ym, -1))))
                  ? `Nothing like this ${inProgress ? `by this time in ${prevName}` : `in ${prevName}`}`
                  : 'No earlier month to compare with'
                : sp.comparison.direction === 'same'
                  ? `About the same as ${inProgress ? `this time in ${prevName}` : prevName}`
                  : `${sp.comparison.pct}% ${sp.comparison.direction} than ${inProgress ? `this time in ${prevName}` : prevName}`}
            </span>
          </div>
          {sp.total > 0 ? (
            <>
              <h2 className="h2" style={{ marginBottom: 4 }}>
                {drillTitle}
              </h2>
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                {drillHint}
              </p>
              <BarList bars={sp.byDrill} onPick={drill} showPct />
              <h2 className="h2">Week by week</h2>
              <WeekBars weeks={sp.weeks} />
              <h2 className="h2">Who spent it</h2>
              <BarList bars={sp.byPerson} label={nameOf} tone={toneOf} />
              <h2 className="h2">Where</h2>
              <BarList bars={sp.byStore} onPick={(s) => set({ store: s })} />
              <h2 className="h2">Top items</h2>
              <div className="list">
                {sp.topItems.map((t) => (
                  <button
                    key={t.itemId ?? t.name}
                    type="button"
                    className="list-row"
                    onClick={() => setPriceOf({ itemId: t.itemId, name: t.name })}
                  >
                    <span className="grow stack" style={{ gap: 0 }}>
                      <span className="title" style={{ fontSize: 'var(--fs-secondary)' }}>
                        {t.name}
                      </span>
                      <span className="sub">
                        {fmtQty(t.quantity, t.unit)} bought, {t.subcategory}
                      </span>
                    </span>
                    <span className="bold num">{money(t.value)}</span>
                  </button>
                ))}
              </div>
              <div className="callout callout-cobalt stack" style={{ gap: 4, marginTop: 22 }}>
                <span className="bold" style={{ fontSize: 'var(--fs-label)' }}>
                  Money in and out
                </span>
                <span style={{ fontSize: 'var(--fs-secondary)' }}>
                  {f.category || f.store
                    ? `Put in ${money(sp.moneyIn)} this month. Spending above is only for your filters.`
                    : `Put in ${money(sp.moneyIn)}, spent ${money(sp.total)}. ${sp.moneyIn - sp.total >= 0 ? `${money(sp.moneyIn - sp.total)} stayed in the pot.` : `${money(sp.total - sp.moneyIn)} more than was put in.`}`}
                </span>
              </div>
              <h2 className="h2">Last 6 months</h2>
              <TrendLine
                points={sp.trend.map((t) => ({
                  label: format(parseISO(`${t.ym}-01`), 'MMM'),
                  value: t.total,
                }))}
              />
            </>
          ) : (
            <p className="empty">
              {active.length
                ? 'No spending matches these filters. Remove a filter to see more.'
                : `Nothing spent in ${monthName(ym)} yet.`}
            </p>
          )}
        </>
      ) : (
        <UsageView
          snap={snap}
          us={us}
          ym={ym}
          f={f}
          drillTitle={drillTitle}
          drillHint={drillHint}
          onDrill={drill}
          hasFilters={active.length > 0}
        />
      )}

      {filters && <FilterSheet snap={snap} view={view} f={f} onSet={set} onClose={() => setFilters(false)} />}
      {priceOf && <PriceSheet snap={snap} item={priceOf} onClose={() => setPriceOf(null)} />}
    </>
  );
}

function UsageView({
  snap,
  us,
  ym,
  drillTitle,
  drillHint,
  onDrill,
  hasFilters,
}: {
  snap: Snapshot;
  us: ReturnType<typeof usageInsights>;
  ym: string;
  f: Filters;
  drillTitle: string;
  drillHint: string;
  onDrill: (k: string) => void;
  hasFilters: boolean;
}) {
  const recipeTitle = (id: string) =>
    snap.recipes.recipes.find((r) => r.id === id)?.title ?? 'A deleted recipe';
  const umax = us.mostUsed[0]?.value || 1;
  return (
    <>
      <div className="card card-pad stack" style={{ gap: 4, marginTop: 16 }}>
        <span className="muted" style={{ fontSize: 'var(--fs-secondary)' }}>
          Groceries used, worth about
        </span>
        <span className="big-num">{money(us.totalValue)}</span>
        <span className="muted" style={{ fontSize: 'var(--fs-secondary)' }}>
          {plural(us.distinctItems, 'different item')} used, {plural(us.meals, 'meal')} cooked in the app
        </span>
      </div>
      {us.mostUsed.length > 0 ? (
        <>
          <h2 className="h2">Most used</h2>
          <div className="list">
            {us.mostUsed.map((x) => (
              <div key={x.itemId} className="stack" style={{ gap: 6, padding: '12px 16px' }}>
                <span className="row-between">
                  <span className="stack" style={{ gap: 0 }}>
                    <span className="bold">{x.name}</span>
                    <span className="small muted">{fmtQty(x.quantity, x.unit)} used</span>
                  </span>
                  <span className="num">{money(x.value)}</span>
                </span>
                <span className="bar-track">
                  <span
                    className="bar-fill use"
                    style={{ width: `${Math.max(2, Math.round((x.value / umax) * 100))}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            {drillTitle}
          </h2>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            {drillHint}
          </p>
          <BarList bars={us.byDrill} tone={() => 'use'} onPick={onDrill} showPct />
        </>
      ) : (
        <p className="empty">
          {hasFilters
            ? 'No usage matches these filters. Remove a filter to see more.'
            : `Nothing used in ${monthName(ym)} yet.`}
        </p>
      )}
      <h2 className="h2">Most cooked</h2>
      <div className="list">
        {us.mostCooked.map((c) => (
          <div key={c.recipeId} className="row-between" style={{ padding: '12px 16px' }}>
            <span className="bold">{recipeTitle(c.recipeId)}</span>
            <span className="muted">{plural(c.times, 'time')}</span>
          </div>
        ))}
        {us.mostCooked.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: 16 }}>
            Nothing cooked in the app this month yet.
          </p>
        )}
      </div>
      {us.ranOutOf.length > 0 && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            Ran out of
          </h2>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            Things marked Out this month. Ones that run out often are worth buying more of.
          </p>
          <div className="list">
            {us.ranOutOf.slice(0, 10).map((x) => (
              <div key={x.itemId} className="row-between" style={{ padding: '12px 16px' }}>
                <span className="stack" style={{ gap: 0 }}>
                  <span className="bold">{x.name}</span>
                  <span className="small muted">Last on {format(parseISO(x.last), 'd MMM')}</span>
                </span>
                <span className="muted">{plural(x.times, 'time')}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {us.boughtVsUsed.length > 0 && (
        <>
          <h2 className="h2" style={{ marginBottom: 4 }}>
            Bought vs used
          </h2>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            Things bought this month that weren't used up come first: possible waste.
          </p>
          <div className="list">
            {us.boughtVsUsed.slice(0, 8).map((x) => {
              const share = x.bought > 0 ? Math.min(1, x.used / x.bought) : 0;
              return (
                <div key={x.itemId} className="stack" style={{ gap: 6, padding: '12px 16px' }}>
                  <span className="row-between">
                    <span className="bold">{x.name}</span>
                    <span className="small muted">
                      {fmtQty(x.used, x.unit)} of {fmtQty(x.bought, x.unit)} used
                    </span>
                  </span>
                  <span className="bar-track" aria-hidden>
                    <span
                      className="bar-fill use"
                      style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>
        Usage comes from finished recipes and from lowering amounts in Stock. Value uses what you paid for
        each item.
      </p>
    </>
  );
}

function BarList({
  bars,
  onPick,
  label = (k) => k,
  tone = () => '',
  showPct,
}: {
  bars: Bar[];
  onPick?: (key: string) => void;
  label?: (k: string) => string;
  /** '' = spending (ink), 'use' = consumption / person B (yellow, outlined) */
  tone?: (k: string) => BarTone;
  showPct?: boolean;
}) {
  return (
    <div className="list">
      {bars.map((b) => {
        const body = (
          <>
            <span className="row-between" style={{ width: '100%' }}>
              <span className="bold">{label(b.key)}</span>
              <span className="num">
                {money(b.value)}{' '}
                {showPct && <span className="small muted">{Math.round(b.share * 100)}%</span>}
              </span>
            </span>
            <span className="bar-track">
              <span
                className={`bar-fill ${tone(b.key)}`}
                style={{ width: `${Math.max(2, Math.round(b.rel * 100))}%` }}
              />
            </span>
          </>
        );
        return onPick ? (
          <button key={b.key} type="button" className="bar-row" onClick={() => onPick(b.key)}>
            {body}
          </button>
        ) : (
          <div key={b.key} className="bar-row">
            {body}
          </div>
        );
      })}
    </div>
  );
}

function WeekBars({ weeks }: { weeks: number[] }) {
  const max = Math.max(...weeks, 1);
  return (
    <div
      className="card week-bars"
      role="img"
      aria-label={`Spending by week: ${weeks.map((w, i) => `week ${i + 1} ${Math.round(w)} lei`).join(', ')}`}
    >
      {weeks.map((w, i) => (
        <div key={i} className="stack" style={{ gap: 6, alignItems: 'center' }}>
          <span className="tiny muted num">{Math.round(w)}</span>
          <span
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              height: 110,
              width: '100%',
              justifyContent: 'center',
            }}
          >
            <span
              style={{
                display: 'block',
                width: 28,
                height: Math.max(4, Math.round((w / max) * 104)),
                background: 'var(--primary)',
                borderRadius: '6px 6px 2px 2px',
              }}
            />
          </span>
          <span className="tiny bold">Wk {i + 1}</span>
        </div>
      ))}
    </div>
  );
}

/** Small hand-built SVG line chart. */
function TrendLine({ points, unit = 'lei' }: { points: { label: string; value: number }[]; unit?: string }) {
  const W = 320;
  const H = 120;
  const pad = 18;
  const max = Math.max(...points.map((p) => p.value), 1);
  const x = (i: number) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <div className="card card-pad">
      <svg
        viewBox={`0 0 ${W} ${H + 16}`}
        width="100%"
        role="img"
        aria-label={points.map((p) => `${p.label} ${Math.round(p.value)} ${unit}`).join(', ')}
      >
        <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--line)" />
        <path
          d={path}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 5 : 3.5} fill="var(--primary)" />
            <text x={x(i)} y={H + 10} textAnchor="middle" fontSize="11" fill="var(--ink-muted)">
              {p.label}
            </text>
            {i === points.length - 1 || p.value === max ? (
              <text
                x={x(i)}
                y={y(p.value) - 9}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="var(--ink)"
              >
                {Math.round(p.value)}
              </text>
            ) : null}
          </g>
        ))}
      </svg>
    </div>
  );
}

function FilterSheet({
  snap,
  view,
  f,
  onSet,
  onClose,
}: {
  snap: Snapshot;
  view: View;
  f: Filters;
  onSet: (p: Partial<Filters>) => void;
  onClose: () => void;
}) {
  const cat = snap.household.categories.find((c) => c.name === f.category);
  const stores = [
    ...new Set(Object.values(snap.budgets).flatMap((b) => b.purchases.map((p) => p.store))),
  ].sort();
  return (
    <Sheet onClose={onClose} labelledBy="fl-title">
      <div className="row-between">
        <h2 className="h-sheet" id="fl-title">
          Filters
        </h2>
        <button
          type="button"
          className="link-btn"
          onClick={() =>
            onSet({ person: undefined, category: undefined, subcategory: undefined, store: undefined })
          }
        >
          Clear all
        </button>
      </div>
      <div className="stack-sm" style={{ gap: 8 }}>
        <span className="bold" style={{ fontSize: 'var(--fs-secondary)' }}>
          Person
        </span>
        <div className="wrap">
          <Chip pressed={!f.person} onClick={() => onSet({ person: undefined })}>
            Both of us
          </Chip>
          {snap.household.members.map((m) => (
            <Chip key={m.email} pressed={f.person === m.email} onClick={() => onSet({ person: m.email })}>
              {m.name}
            </Chip>
          ))}
        </div>
      </div>
      <div className="stack-sm" style={{ gap: 8 }}>
        <span className="bold" style={{ fontSize: 'var(--fs-secondary)' }}>
          Category
        </span>
        <div className="wrap">
          <Chip pressed={!f.category} onClick={() => onSet({ category: undefined, subcategory: undefined })}>
            All
          </Chip>
          {snap.household.categories.map((c) => (
            <Chip
              key={c.name}
              pressed={f.category === c.name}
              onClick={() => onSet({ category: c.name, subcategory: undefined })}
            >
              {c.name}
            </Chip>
          ))}
        </div>
      </div>
      {cat && (
        <div className="stack-sm" style={{ gap: 8 }}>
          <span className="bold" style={{ fontSize: 'var(--fs-secondary)' }}>
            Subcategory in {cat.name}
          </span>
          <div className="wrap">
            <Chip pressed={!f.subcategory} onClick={() => onSet({ subcategory: undefined })}>
              All
            </Chip>
            {cat.subcategories.map((s) => (
              <Chip key={s} pressed={f.subcategory === s} onClick={() => onSet({ subcategory: s })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {view === 'spend' && (
        <div className="stack-sm" style={{ gap: 8 }}>
          <span className="bold" style={{ fontSize: 'var(--fs-secondary)' }}>
            Store
          </span>
          <div className="wrap">
            <Chip pressed={!f.store} onClick={() => onSet({ store: undefined })}>
              All stores
            </Chip>
            {stores.map((s) => (
              <Chip key={s} pressed={f.store === s} onClick={() => onSet({ store: s })}>
                {s}
              </Chip>
            ))}
          </div>
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        Show results
      </button>
    </Sheet>
  );
}

function PriceSheet({
  snap,
  item,
  onClose,
}: {
  snap: Snapshot;
  item: { itemId?: string; name: string };
  onClose: () => void;
}) {
  const hist = priceHistory(Object.values(snap.budgets), item);
  const unit = hist[0]?.unit ?? 'pcs';
  const per = unit === 'pcs' ? 'each' : `per ${unit}`;
  return (
    <Sheet onClose={onClose} title={`${item.name}: price paid`} labelledBy="ph-title">
      {hist.length >= 2 && (
        <TrendLine
          points={hist.map((h) => ({ label: format(parseISO(h.date), 'd MMM'), value: h.perUnit }))}
        />
      )}
      <div className="list">
        {hist
          .slice()
          .reverse()
          .map((h, i) => (
            <div key={i} className="row-between" style={{ padding: '10px 16px' }}>
              <span className="stack" style={{ gap: 0 }}>
                <span className="bold">{h.store}</span>
                <span className="small muted">{format(parseISO(h.date), 'd MMM yyyy')}</span>
              </span>
              <span className="num">
                {money(h.perUnit)} {per}
              </span>
            </div>
          ))}
        {hist.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: 16 }}>
            No purchases of this item yet.
          </p>
        )}
      </div>
    </Sheet>
  );
}
