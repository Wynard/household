import { describe, expect, it } from 'vitest';
import {
  analyseSheet,
  balanceGap,
  detectColumns,
  netOf,
  parseAmount,
  parseTable,
  resolveDates,
  splitDuplicates,
  suggestPerson,
  toEntries,
  type ImportMapping,
} from './budgetImport';
import {
  ACTIONS,
  applyToSnapshot,
  filesToSnapshot,
  planAction,
  snapshotToFiles,
  type Snapshot,
} from './actions';
import { parseFile, type DataFile } from './files';
import type { FileMap } from './ops';
import { DEFAULT_BUDGET_CATEGORIES } from './defaults';
import { ledger, potBalance } from './budget';
import { makeCtx, seedSnapshot } from '../test/ctx';
import { round2 } from './format';
import { SEED_MEMBERS } from '../storage/seed';

const ANA = SEED_MEMBERS[0].email;
const MIHAI = SEED_MEMBERS[1].email;

/** A household with no budget history yet. */
function emptyPot(): Snapshot {
  const s = structuredClone(seedSnapshot());
  for (const b of Object.values(s.budgets)) {
    b.openingBalance = 0;
    b.contributions = [];
    b.purchases = [];
    b.adjustments = [];
  }
  return s;
}

// fictional sheet in the usual shape: Romanian headers, a running balance,
// text dates mixed with dates a spreadsheet turned into real dates (shown M/D/YYYY)
const SHEET = [
  ['Data', 'Suma', 'Sold', 'Persoana', 'Categorie', 'Descriere'],
  ['18-01-2026', 'RON1,000.00', 'RON1,000.00', 'AA', 'Depozit', 'Depozit'],
  ['20-01-2026', 'RON250.50', 'RON749.50', 'MM', 'Mancare', 'Piata'],
  ['2/2/2026', 'RON500.00', 'RON1,249.50', 'MM', 'Depozit', 'Depozit'],
  ['2/3/2026', 'RON49.50', 'RON1,200.00', 'AA', 'None', ''],
  ['14-03-2026', 'RON200.00', 'RON1,000.00', 'MM', 'Casa', 'Raft'],
  ['3/20/2026', 'RON100.00', 'RON900.00', 'AA', 'Casa', ''],
]
  .map((r) => r.join('\t'))
  .join('\n');

describe('reading a pasted sheet', () => {
  it('splits tabs, CSV with quotes, and semicolons', () => {
    expect(parseTable('a\tb\n1\t2\n\n').rows).toEqual([['1', '2']]);
    expect(parseTable('Date,Amount,Note\n2026-01-02,"1,500.00","Rent, January"').rows[0]).toEqual([
      '2026-01-02',
      '1,500.00',
      'Rent, January',
    ]);
    expect(parseTable('Data;Suma\n02.01.2026;"12,50"').rows[0]).toEqual(['02.01.2026', '12,50']);
    expect(parseTable('a,b\n"say ""hi""",2').rows[0]).toEqual(['say "hi"', '2']);
  });

  it('finds the columns from Romanian or English headers', () => {
    expect(detectColumns(['Data', 'Suma', 'Sold', 'Persoana', 'Categorie', 'Descriere'])).toEqual({
      date: 0,
      amount: 1,
      balance: 2,
      person: 3,
      category: 4,
      description: 5,
    });
    expect(detectColumns(['Date', 'Who', 'Amount (lei)', 'Category', 'Notes', 'Balance'])).toEqual({
      date: 0,
      person: 1,
      amount: 2,
      category: 3,
      description: 4,
      balance: 5,
    });
  });

  it('reads amounts written in either style', () => {
    expect(parseAmount('RON2,000.00')).toBe(2000);
    expect(parseAmount('2.000,50 lei')).toBe(2000.5);
    expect(parseAmount('306.09')).toBe(306.09);
    expect(parseAmount('12,5')).toBe(12.5);
    expect(parseAmount('1.500')).toBe(1500);
    expect(parseAmount('0,500')).toBe(0.5);
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('-RON30.00')).toBe(-30);
    expect(parseAmount('(45)')).toBe(-45);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('n/a')).toBeNull();
  });

  it('reads dates day-first, and settles ambiguous ones by keeping the rows in order', () => {
    expect(resolveDates(['18-01-2026', '03.02.2026', '2026-02-10', '46085'])).toEqual([
      '2026-01-18',
      '2026-02-03',
      '2026-02-10',
      '2026-03-04',
    ]);
    // dates a spreadsheet turned into real dates, shown month-first
    expect(resolveDates(['18-01-2026', '2/7/2026', '15-02-2026', '3/10/2026', '20-03-2026'])).toEqual([
      '2026-01-18',
      '2026-02-07',
      '2026-02-15',
      '2026-03-10',
      '2026-03-20',
    ]);
    // the same swapped dates on a computer that shows dates day-first (dd.mm.yyyy)
    expect(resolveDates(['18-01-2026', '02.07.2026', '15-02-2026', '03.10.2026'])).toEqual([
      '2026-01-18',
      '2026-02-07',
      '2026-02-15',
      '2026-03-10',
    ]);
    expect(resolveDates(['02.07.2026', '30.02.2026', 'soon'])).toEqual(['2026-07-02', null, null]);
  });

  it('tells money in from money out by the balance, and counts people and categories', () => {
    const a = analyseSheet(SHEET);
    expect(a.rows.every((r) => !r.problem)).toBe(true);
    expect(a.rows.map((r) => r.date)).toEqual([
      '2026-01-18',
      '2026-01-20',
      '2026-02-02',
      '2026-02-03',
      '2026-03-14',
      '2026-03-20',
    ]);
    expect(a.people.map((p) => [p.value, p.rows])).toEqual([
      ['AA', 3],
      ['MM', 3],
    ]);
    expect(a.categories.map((c) => [c.value, c.moneyIn, c.total])).toEqual([
      ['Casa', false, 300],
      ['Depozit', true, 1500],
      ['', false, 49.5],
      ['Mancare', false, 250.5],
    ]);
    expect(a.lastBalance).toBe(900);
  });

  it('without a balance column, the category name decides', () => {
    const a = analyseSheet(
      'Date\tAmount\tWho\tCategory\n02.01.2026\t500\tAna\tDeposit\n03.01.2026\t20\tAna\tFood',
    );
    expect(a.categories.find((c) => c.value === 'Deposit')?.moneyIn).toBe(true);
    expect(a.categories.find((c) => c.value === 'Food')?.moneyIn).toBe(false);
  });

  it('flags rows it cannot read instead of guessing', () => {
    const a = analyseSheet('Data\tSuma\tPersoana\n1.1.2026\t\tAA\nmaine\t10\tAA\n02.01.2026\t5\t');
    expect(a.rows.map((r) => r.problem)).toEqual([
      'no amount',
      `can't read the date "maine"`,
      'nobody in the Who column',
    ]);
  });

  it('suggests people by name or initial', () => {
    const members = [
      { email: ANA, name: 'Ana' },
      { email: MIHAI, name: 'Mihai' },
    ];
    expect(suggestPerson('ana', members)).toBe(ANA);
    expect(suggestPerson('MM', members)).toBe(MIHAI);
    expect(suggestPerson('XY', members)).toBeUndefined();
  });
});

describe('importing the history', () => {
  const map: ImportMapping = {
    people: { AA: ANA, MM: MIHAI },
    categories: {
      Depozit: { kind: 'in' },
      Mancare: { kind: 'out', category: 'Groceries' },
      Casa: { kind: 'out', category: 'Casa' },
      '': { kind: 'out', category: '' },
    },
  };
  const entries = toEntries(analyseSheet(SHEET), map);

  it("finds where a sheet's own balance stops following its rows", () => {
    expect(balanceGap(analyseSheet(SHEET), map)).toBeNull();
    // row 4's balance was typed over: everything after it is 10 lei too high
    const broken = SHEET.replace('RON1,200.00', 'RON1,210.00')
      .replace('RON1,000.00	MM	Casa', 'RON1,010.00	MM	Casa')
      .replace('RON900.00', 'RON910.00');
    const gap = balanceGap(analyseSheet(broken), map);
    expect(gap).toMatchObject({ row: { line: 5 }, offAtEnd: 10 });
  });

  it('turns rows into contributions and purchases', () => {
    expect(entries).toHaveLength(6);
    expect(entries[0]).toEqual({ kind: 'in', date: '2026-01-18', amount: 1000, by: ANA });
    expect(entries[1]).toMatchObject({ kind: 'out', category: 'Groceries', description: 'Piata' });
    expect(entries[3]).toEqual({ kind: 'out', date: '2026-02-03', amount: 49.5, by: ANA });
    expect(netOf(entries)).toBe(900);
  });

  it('into an empty pot: the ledger follows the sheet row by row', () => {
    const snap = emptyPot();
    const plan = planAction(ACTIONS.importBudget, makeCtx(snap), { entries });
    expect(plan.blocked).toBeUndefined();
    expect(plan.lines).toContain('New categories: Casa');
    const after = applyToSnapshot(snap, plan.ops).snap;
    expect(after.household.budgetCategories).toContain('Casa');
    expect(ledger(Object.values(after.budgets)).map((r) => r.balanceAfter)).toEqual([
      1000, 749.5, 1249.5, 1200, 1000, 900,
    ]);
    const p = after.budgets[2026].purchases.find((x) => x.purpose === 'Raft')!;
    expect(p).toMatchObject({ source: 'import', category: 'Casa', total: 200, spentBy: MIHAI, lines: [] });
    // the "Depozit" description says nothing more than the category
    expect(after.budgets[2026].contributions.every((c) => c.note === undefined)).toBe(true);
  });

  it('importing the same sheet again adds nothing', () => {
    const snap = emptyPot();
    const once = applyToSnapshot(snap, planAction(ACTIONS.importBudget, makeCtx(snap), { entries }).ops).snap;
    const again = planAction(ACTIONS.importBudget, makeCtx(once), { entries });
    expect(again.blocked).toMatch(/already in the app \(6 rows\)/);
    expect(splitDuplicates(entries, Object.values(once.budgets))).toEqual({ fresh: [], duplicates: 6 });
  });

  it('pot already in use: "keep" leaves its total as it was, "sheet" starts from the sheet', () => {
    const snap = emptyPot();
    const b = snap.budgets[2026];
    b.openingBalance = 300; // typed in at setup
    b.contributions = [
      {
        id: 'c',
        date: '2026-10-07',
        by: ANA,
        amount: 6000,
        createdBy: 'Ana',
        createdAt: '2026-10-07T09:00:00Z',
      },
    ];
    const before = potBalance(Object.values(snap.budgets));
    expect(before).toBe(6300);

    const keep = planAction(ACTIONS.importBudget, makeCtx(snap), { entries, potMode: 'keep' });
    const k = applyToSnapshot(snap, keep.ops).snap;
    expect(potBalance(Object.values(k.budgets))).toBe(before);
    const fix = k.budgets[2026].adjustments[0];
    expect(fix).toMatchObject({ date: '2026-10-07', amount: 300 - 900 });
    // the sheet's balances stay right up to the day the app started
    const rows = ledger(Object.values(k.budgets));
    expect(rows.find((r) => r.date === '2026-03-20')?.balanceAfter).toBe(900);
    expect(k.budgets[2026].openingBalance).toBe(0);

    const sheet = planAction(ACTIONS.importBudget, makeCtx(snap), { entries, potMode: 'sheet' });
    const s = applyToSnapshot(snap, sheet.ops).snap;
    expect(potBalance(Object.values(s.budgets))).toBe(900 + 6000);
    expect(s.budgets[2026].adjustments).toHaveLength(0);

    // undo puts everything back
    const undone = applyToSnapshot(s, applyToSnapshot(snap, sheet.ops).inverse).snap;
    expect(potBalance(Object.values(undone.budgets))).toBe(before);
    expect(undone.budgets[2026].openingBalance).toBe(300);
  });

  it('removes unused categories only when nothing will use them', () => {
    const snap = emptyPot();
    const plan = planAction(ACTIONS.importBudget, makeCtx(snap), {
      entries,
      removeCategories: ['Pets', 'Groceries'],
    });
    const after = applyToSnapshot(snap, plan.ops).snap.household.budgetCategories;
    expect(after).not.toContain('Pets');
    expect(after).toContain('Groceries');
  });

  it('adds new categories most used first', () => {
    const out = (category: string, date: string) => ({
      kind: 'out' as const,
      date,
      amount: 5,
      by: ANA,
      category,
    });
    const plan = planAction(ACTIONS.importBudget, makeCtx(emptyPot()), {
      entries: [out('Zeta', '2026-01-01'), out('Alfa', '2026-01-02'), out('Alfa', '2026-01-03')],
    });
    expect(plan.lines).toContain('New categories: Alfa, Zeta');
  });

  it('needs every person to be a member', () => {
    const plan = planAction(ACTIONS.importBudget, makeCtx(emptyPot()), {
      entries: [{ ...entries[0], by: 'someone@example.com' }],
    });
    expect(plan.blocked).toMatch(/Choose who/);
  });
});

// Local only: the real old budget sheet, rendered as a paste from Excel in two
// regional date styles and as a Google Sheets CSV export (git-ignored private/budget-history-*). Checks
// against the sheet's own balance column; prints counts, never contents.
const PRIVATE = import.meta.glob<string>('../../private/budget-history-*.{tsv,csv}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
describe.skipIf(!Object.keys(PRIVATE).length)('private budget sheet (local only)', () => {
  for (const [path, text] of Object.entries(PRIVATE)) {
    it(`reads ${path.split('/').pop()} in date order and matches the sheet's balance`, () => {
      const a = analyseSheet(text);
      expect(Object.keys(a.columns).sort()).toEqual(
        ['amount', 'balance', 'category', 'date', 'description', 'person'].sort(),
      );
      expect(a.rows.filter((r) => r.problem)).toEqual([]);
      const dates = a.rows.map((r) => r.date!);
      expect(dates.filter((d, i) => i > 0 && d < dates[i - 1])).toEqual([]);
      expect(a.people).toHaveLength(2);
      expect(a.categories.filter((c) => c.moneyIn)).toHaveLength(1);

      const map: ImportMapping = {
        people: Object.fromEntries(a.people.map((p, i) => [p.value, SEED_MEMBERS[i].email])),
        categories: Object.fromEntries(
          a.categories.map((c) => [c.value, c.moneyIn ? { kind: 'in' } : { kind: 'out', category: c.value }]),
        ),
      };
      const entries = toEntries(a, map);
      expect(entries).toHaveLength(a.rows.length);
      const net = netOf(entries);
      // the app adds up the rows; when the sheet's balance says otherwise, the gap says where
      const gap = balanceGap(a, map);
      expect(gap?.offAtEnd ?? 0).toBe(round2(a.lastBalance! - net));

      const snap = emptyPot();
      const plan = planAction(ACTIONS.importBudget, makeCtx(snap), { entries });
      expect(plan.blocked).toBeUndefined();
      const after = applyToSnapshot(snap, plan.ops).snap;
      expect(potBalance(Object.values(after.budgets))).toBe(net);
      // row by row: the app's balance is the sheet's (less the gap, after it)
      const rows = ledger(Object.values(after.budgets));
      const off = gap?.offAtEnd ?? 0;
      const lined = a.rows.filter((r, i) =>
        [r.balance, round2(r.balance! - off)].includes(rows[i].balanceAfter),
      ).length;
      expect(lined).toBeGreaterThan(a.rows.length - 3);
      console.log(
        `${path.split('/').pop()}: ${a.rows.length} rows, ${lined} balances line up${gap ? `, the sheet's balance breaks at row ${gap.row.line}` : ''}`,
      );
    });
  }
});

// Local only: the real household backup (git-ignored private/household-backup-*.json) gets the
// v5 migration and the real sheet imported, both ways, in memory. Prints counts, never contents.
const BACKUP = Object.values(
  import.meta.glob<string>('../../private/household-backup-*.json', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
).at(-1);
const SHEET_CSV = Object.entries(PRIVATE).find(([p]) => p.endsWith('.csv'))?.[1];
describe.skipIf(!BACKUP || !SHEET_CSV)('private household backup (local only)', () => {
  it('migrates every file and imports the sheet with either pot choice', () => {
    const raw = JSON.parse(BACKUP!) as { files: Record<string, unknown> };
    const files: FileMap = {};
    for (const [name, data] of Object.entries(raw.files))
      files[name as DataFile] = parseFile(name as DataFile, data);
    const snap = filesToSnapshot(files);
    expect(snap.household.budgetCategories).toEqual(DEFAULT_BUDGET_CATEGORIES);
    const a = analyseSheet(SHEET_CSV!);
    const members = snap.household.members;
    const map: ImportMapping = {
      people: Object.fromEntries(a.people.map((p, i) => [p.value, members[i].email])),
      categories: Object.fromEntries(
        a.categories.map((c) => [c.value, c.moneyIn ? { kind: 'in' } : { kind: 'out', category: c.value }]),
      ),
    };
    const entries = toEntries(a, map);
    const ctx = { ...makeCtx(snap), me: members[0], actor: members[0].name };
    const before = potBalance(Object.values(snap.budgets));
    const unused = snap.household.budgetCategories.filter((c) => c !== 'Groceries');
    for (const potMode of ['keep', 'sheet'] as const) {
      const plan = planAction(ACTIONS.importBudget, ctx, { entries, potMode, removeCategories: unused });
      expect(plan.blocked).toBeUndefined();
      const after = applyToSnapshot(snap, plan.ops).snap;
      const pot = potBalance(Object.values(after.budgets));
      expect(pot).toBe(potMode === 'keep' ? before : round2(before + netOf(entries)));
      expect(after.household.budgetCategories[0]).toBe('Groceries');
      // the files still validate after the import
      for (const [name, data] of Object.entries(snapshotToFiles(after)))
        expect(() => parseFile(name as DataFile, data)).not.toThrow();
      console.log(`backup + sheet (${potMode}): ${entries.length} rows imported, files valid`);
    }
  });
});
