import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe, useRun, useSnapshot, useStore } from '../../app/data';
import { Choice, Loading, Switch } from '../../ui/controls';
import { ACTIONS, applyToSnapshot, planAction, type Ctx, type Snapshot } from '../../domain/actions';
import { budgetCategoryUse, potBalance } from '../../domain/budget';
import {
  FIELD_LABELS,
  analyseSheet,
  balanceGap,
  netOf,
  suggestPerson,
  toEntries,
  type CategoryTarget,
  type Columns,
  type Field,
  type ImportEntry,
  type ImportMapping,
} from '../../domain/budgetImport';
import { normalise } from '../../domain/categorise';
import { dayLabel, money, plural } from '../../domain/format';
import { nowISO, todayISO } from '../../domain/dates';
import type { Member } from '../../domain/schemas';
import { SettingsPage } from './common';
import { DriveAdapter } from '../../storage/drive';
import { pickSpreadsheet } from '../../storage/picker';

const FIELDS: Field[] = ['date', 'amount', 'person', 'category', 'description', 'balance'];
const REQUIRED: Field[] = ['date', 'amount', 'person'];
type PotMode = 'keep' | 'sheet';

/** Reads a CSV file as UTF-8, or as Windows Central European when it isn't (Excel's plain CSV). */
async function readText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1250').decode(buf);
  }
}

function previewCtx(snap: Snapshot, me: Member): Ctx {
  let n = 0;
  return {
    snap,
    me,
    actor: me.name,
    today: todayISO(),
    now: nowISO(),
    newId: () => `preview-${++n}`,
  };
}

/** Settings › Import budget history: an old budget spreadsheet into the pot. */
export function BudgetImport() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const me = useMe();
  const nav = useNavigate();
  const [text, setText] = useState('');
  const [columns, setColumns] = useState<Columns | null>(null);
  const [people, setPeople] = useState<Record<string, string>>({});
  const [cats, setCats] = useState<Record<string, CategoryTarget>>({});
  const [potMode, setPotMode] = useState<PotMode>('keep');
  const [tidy, setTidy] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // signed in with Google: the sheet can come straight from Drive
  const store = useStore();
  const drive = store.adapter instanceof DriveAdapter ? store.adapter : null;
  const [source, setSource] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  const fromDrive = async () => {
    if (!drive || reading) return;
    setReadError(null);
    try {
      const picked = await pickSpreadsheet(await drive.token());
      if (!picked?.length) return;
      setReading(true);
      const csv = await drive.readSheetAsCsv(picked[0]);
      setText(csv);
      setColumns(null);
      setSource(picked[0].name);
    } catch (e) {
      setReadError(e instanceof Error ? e.message : "Couldn't read that spreadsheet.");
    } finally {
      setReading(false);
    }
  };

  const analysis = useMemo(
    () => (text.trim() ? analyseSheet(text, columns ?? undefined) : null),
    [text, columns],
  );
  const members = useMemo(() => snap?.household.members ?? [], [snap]);
  const known = useMemo(() => snap?.household.budgetCategories ?? [], [snap]);

  // suggestions, overridden by what the person picked
  const mapping: ImportMapping | null = useMemo(() => {
    if (!analysis) return null;
    const p: Record<string, string> = {};
    for (const x of analysis.people) {
      const s = people[x.value] ?? suggestPerson(x.value, members);
      if (s) p[x.value] = s;
    }
    const c: Record<string, CategoryTarget> = {};
    for (const x of analysis.categories)
      c[x.value] =
        cats[x.value] ??
        (x.moneyIn
          ? { kind: 'in' }
          : {
              kind: 'out',
              category: known.find((k) => normalise(k) === normalise(x.value)) ?? x.value,
            });
    return { people: p, categories: c };
  }, [analysis, people, cats, members, known]);

  const entries: ImportEntry[] = useMemo(
    () => (analysis && mapping ? toEntries(analysis, mapping) : []),
    [analysis, mapping],
  );
  const newCats = useMemo(
    () => [
      ...new Set(
        entries.flatMap((e) =>
          e.kind === 'out' && e.category && !known.includes(e.category) ? [e.category] : [],
        ),
      ),
    ],
    [entries, known],
  );
  const unused = useMemo(() => {
    if (!snap) return [];
    const budgets = Object.values(snap.budgets);
    const targeted = new Set(entries.map((e) => e.category));
    return known.filter((k) => !targeted.has(k) && budgetCategoryUse(budgets, k) === 0);
  }, [snap, known, entries]);
  const removeUnused = tidy ?? newCats.length > 0;

  const budgets = useMemo(() => (snap ? Object.values(snap.budgets) : []), [snap]);
  const earliest = budgets.slice().sort((a, b) => a.year - b.year)[0];
  const startAmount = earliest?.openingBalance ?? 0;
  const hasPot =
    !!earliest &&
    (startAmount !== 0 ||
      budgets.some((b) => b.contributions.length + b.purchases.length + b.adjustments.length));

  const plans = useMemo(() => {
    if (!snap || !me || !entries.length) return null;
    const one = (mode: PotMode) => {
      const plan = planAction(ACTIONS.importBudget, previewCtx(snap, me), {
        entries,
        potMode: mode,
        removeCategories: removeUnused ? unused : [],
      });
      const after = plan.blocked
        ? null
        : potBalance(Object.values(applyToSnapshot(snap, plan.ops).snap.budgets));
      return { plan, after };
    };
    return { keep: one('keep'), sheet: one('sheet') };
  }, [snap, me, entries, removeUnused, unused]);

  if (!snap || !me) return <Loading />;

  const missing = analysis ? REQUIRED.filter((f) => analysis.columns[f] === undefined) : [];
  const problems = analysis?.rows.filter((r) => r.problem) ?? [];
  const unmappedPeople = analysis?.people.filter((x) => !mapping?.people[x.value]) ?? [];
  const mode: PotMode = hasPot ? potMode : 'sheet';
  const chosen = plans?.[mode];
  const potNow = potBalance(budgets);
  const net = netOf(entries);
  const sheetMatches =
    analysis?.lastBalance !== null &&
    analysis?.lastBalance !== undefined &&
    Math.abs(analysis.lastBalance - net) < 0.01;
  const gap = analysis && mapping && !sheetMatches ? balanceGap(analysis, mapping) : null;

  const importNow = async () => {
    if (!chosen || chosen.plan.blocked || busy) return;
    setBusy(true);
    const r = await run(
      'importBudget',
      { entries, potMode: mode, removeCategories: removeUnused ? unused : [] },
      { toast: (p) => p.title.replace('Import', 'Imported') },
    );
    setBusy(false);
    if (r) nav('/budget');
  };

  const catValue = (t: CategoryTarget | undefined) =>
    !t ? '' : t.kind === 'in' ? 'in' : t.category ? `c:${t.category}` : 'none';

  return (
    <SettingsPage
      title="Import budget history"
      hint="Bring an old budget spreadsheet into the pot: one row per payment or contribution. Nothing is saved until you tap Import, and you can undo right after."
    >
      {drive && (
        <div className="stack" style={{ gap: 8, marginBottom: 12 }}>
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={reading}
            onClick={() => void fromDrive()}
          >
            {reading ? 'Reading the sheet…' : 'Choose the sheet in Google Drive'}
          </button>
          {source && !reading && (
            <span className="small" role="status">
              Read “{source}” from Google Drive.
            </span>
          )}
          {readError && <p className="problem">{readError}</p>}
        </div>
      )}
      <div className="card card-pad stack" style={{ gap: 10 }}>
        <span className="small muted">
          {drive ? 'Or copy' : 'Copy'} the whole table in Excel or Google Sheets, header row included, and
          paste it here. It reads a date, an amount, who, a category and a description. A running balance
          column is used to tell money put in from money spent, and to check the totals.
        </span>
        <textarea
          className="input"
          aria-label="Your budget rows"
          rows={6}
          style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-secondary)' }}
          placeholder={'Date\tAmount\tWho\tCategory\tDescription'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setColumns(null);
            setSource(null);
          }}
        />
        <label className="btn btn-outline btn-md" style={{ cursor: 'pointer' }}>
          Or choose a CSV file
          <input
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setText(await readText(file));
              setColumns(null);
              setSource(null);
            }}
          />
        </label>
      </div>

      {analysis && (
        <>
          <h2 className="h2">Columns</h2>
          {missing.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>
              {plural(analysis.rows.length, 'row')}.{' '}
              {FIELDS.filter((f) => analysis.columns[f] !== undefined)
                .map((f) => `${FIELD_LABELS[f]}: ${analysis.table.header[analysis.columns[f]!]}`)
                .join(' · ')}
              .{' '}
              <button type="button" className="link-btn" onClick={() => setColumns({ ...analysis.columns })}>
                Change
              </button>
            </p>
          ) : (
            <p className="notice-text small" style={{ margin: 0 }}>
              Couldn't tell which column is the {missing.map((f) => FIELD_LABELS[f].toLowerCase()).join(', ')}
              . Pick them below.
            </p>
          )}
          {(columns || missing.length > 0) && (
            <div className="grid-2" style={{ gap: 10, marginTop: 10 }}>
              {FIELDS.map((f) => (
                <label key={f} className="mini-field">
                  <span>{FIELD_LABELS[f]}</span>
                  <select
                    className="input input-sm"
                    value={analysis.columns[f] ?? ''}
                    onChange={(e) =>
                      setColumns({
                        ...analysis.columns,
                        [f]: e.target.value === '' ? undefined : Number(e.target.value),
                      })
                    }
                  >
                    <option value="">None</option>
                    {analysis.table.header.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}

          {missing.length === 0 && (
            <>
              {problems.length > 0 && (
                <div className="notice" style={{ marginTop: 12 }}>
                  <span className="bold">{plural(problems.length, 'row')} left out</span>
                  <span className="small">
                    {problems
                      .slice(0, 5)
                      .map((r) => `Row ${r.line}: ${r.problem}`)
                      .join('. ')}
                    {problems.length > 5 ? '…' : '.'}
                  </span>
                </div>
              )}

              <h2 className="h2">Who is who</h2>
              <div className="stack-lg">
                {analysis.people.map((x) => (
                  <Choice
                    key={x.value}
                    label={`${x.value} (${plural(x.rows, 'row')})`}
                    value={mapping?.people[x.value] ?? ''}
                    onChange={(email) => setPeople({ ...people, [x.value]: email })}
                    options={members.map((m) => [m.email, m.name] as [string, string])}
                  />
                ))}
              </div>

              <h2 className="h2" style={{ marginBottom: 4 }}>
                Categories
              </h2>
              <p className="small muted" style={{ margin: '0 0 10px' }}>
                Each one from the sheet becomes money put into the pot, or a budget category for what was
                spent.
              </p>
              <div className="list">
                {analysis.categories.map((x) => {
                  const t = mapping?.categories[x.value];
                  const isNew = t?.kind === 'out' && t.category && !known.includes(t.category);
                  return (
                    <label key={x.value} className="stack" style={{ gap: 6, padding: '10px 14px' }}>
                      <span className="row-between" style={{ gap: 8 }}>
                        <span className="bold">{x.value || 'No category in the sheet'}</span>
                        <span className="small muted num">
                          {plural(x.rows, 'row')}, {money(x.total)}
                        </span>
                      </span>
                      <select
                        className="input input-sm"
                        value={catValue(t)}
                        onChange={(e) => {
                          const v = e.target.value;
                          setCats({
                            ...cats,
                            [x.value]:
                              v === 'in'
                                ? { kind: 'in' }
                                : { kind: 'out', category: v === 'none' ? '' : v.slice(2) },
                          });
                        }}
                      >
                        <option value="in">Money put into the pot</option>
                        {known.map((k) => (
                          <option key={k} value={`c:${k}`}>
                            Spent on {k}
                          </option>
                        ))}
                        {x.value && !known.includes(x.value) && (
                          <option value={`c:${x.value}`}>New category: {x.value}</option>
                        )}
                        <option value="none">Spent, no category</option>
                      </select>
                      {isNew && <span className="tiny muted">A new budget category</span>}
                    </label>
                  );
                })}
              </div>

              {entries.length > 0 && unmappedPeople.length === 0 && (
                <>
                  {analysis.lastBalance !== null && (
                    <div
                      className={`callout ${sheetMatches ? 'callout-cobalt' : 'callout-saffron'}`}
                      style={{ marginTop: 16, fontSize: 'var(--fs-secondary)' }}
                    >
                      {sheetMatches
                        ? `The rows add up to ${money(net)}, the same as the sheet's last balance.`
                        : gap
                          ? `The rows add up to ${money(net)}, but the sheet's last balance says ${money(analysis.lastBalance)}. The sheet's own balance first stops following its rows at row ${gap.row.line} (${gap.row.date ? dayLabel(gap.row.date) : ''}, ${gap.row.description || gap.row.category || 'no description'}, ${money(gap.row.amount ?? 0)}). The app adds up the rows, so check that row in the sheet, and which categories are money put in.`
                          : `The rows add up to ${money(net)}, but the sheet's last balance is ${money(analysis.lastBalance)}. Check which categories are money put in, and the rows left out.`}
                    </div>
                  )}

                  {hasPot && plans && (
                    <>
                      <h2 className="h2" style={{ marginBottom: 4 }}>
                        The pot
                      </h2>
                      <p className="small muted" style={{ margin: '0 0 10px' }}>
                        It shows {money(potNow)} now. The old rows go into the history and Insights either
                        way.
                      </p>
                      <div
                        className="stack"
                        style={{ gap: 8 }}
                        role="radiogroup"
                        aria-label="The pot after importing"
                      >
                        {(
                          [
                            [
                              'keep',
                              `Keep ${money(plans.keep.after ?? potNow)}`,
                              'A correction on the day you started using the app keeps today’s total.',
                            ],
                            [
                              'sheet',
                              `Start from the sheet: ${money(plans.sheet.after ?? potNow)}`,
                              startAmount
                                ? `The sheet’s balance plus what was added in the app since. The ${money(startAmount)} typed in at setup is dropped.`
                                : 'The sheet’s balance plus what was added in the app since.',
                            ],
                          ] as [PotMode, string, string][]
                        ).map(([v, t, s]) => (
                          <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={potMode === v}
                            className="choice"
                            style={{ textAlign: 'left', padding: '10px 14px', height: 'auto' }}
                            onClick={() => setPotMode(v)}
                          >
                            <span className="stack" style={{ gap: 2 }}>
                              <span>{t}</span>
                              <span className="small" style={{ fontWeight: 'normal' }}>
                                {s}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {unused.length > 0 && (
                    <div style={{ marginTop: 16 }}>
                      <Switch
                        on={removeUnused}
                        onToggle={() => setTidy(!removeUnused)}
                        title="Remove budget categories nothing uses"
                        sub={unused.join(', ')}
                      />
                    </div>
                  )}

                  {chosen && (
                    <div className="card card-pad stack" style={{ gap: 4, marginTop: 16 }}>
                      <span className="bold">
                        {chosen.plan.blocked ? 'Nothing to import' : chosen.plan.title}
                      </span>
                      {(chosen.plan.blocked ? [chosen.plan.blocked] : chosen.plan.lines).map((l) => (
                        <span key={l} className="small muted">
                          {l}
                        </span>
                      ))}
                      {!chosen.plan.blocked && chosen.after !== null && (
                        <span className="small">
                          Pot after: <span className="money">{money(chosen.after)}</span>
                        </span>
                      )}
                    </div>
                  )}
                </>
              )}

              {unmappedPeople.length > 0 && (
                <p className="problem">
                  Choose who {unmappedPeople.map((x) => x.value).join(' and ')}{' '}
                  {unmappedPeople.length === 1 ? 'is' : 'are'}.
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                style={{ marginTop: 16 }}
                disabled={!chosen || !!chosen.plan.blocked || unmappedPeople.length > 0 || busy}
                onClick={() => void importNow()}
              >
                {busy
                  ? 'Importing…'
                  : chosen && !chosen.plan.blocked && !unmappedPeople.length
                    ? `Import ${plural(entries.length - ((chosen.plan.result as { duplicates?: number })?.duplicates ?? 0), 'row')}`
                    : 'Import'}
              </button>
              {entries.length > 0 && !unmappedPeople.length && (
                <p className="small muted" style={{ textAlign: 'center' }}>
                  {dayLabel(entries.map((e) => e.date).sort()[0])} to{' '}
                  {dayLabel(entries.map((e) => e.date).sort()[entries.length - 1])}
                </p>
              )}
            </>
          )}
        </>
      )}
    </SettingsPage>
  );
}
