// Budget history from a spreadsheet: rows copied from Excel / Google Sheets (or
// a CSV file), one money movement per row with a date, an amount, who, a
// category and a description. An optional running-balance column tells money in
// from money out and checks the totals. Pure functions; the importBudget action
// writes the result.
import { normalise } from './categorise';
import { round2 } from './format';
import type { BudgetFile } from './schemas';

export interface Table {
  header: string[];
  rows: string[][];
}

/** Splits pasted cells (tab-separated) or a CSV file (`,` or `;`, quotes allowed). */
export function parseTable(text: string): Table {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const first = lines.find((l) => l.trim()) ?? '';
  const delim = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
  const rows = splitDelimited(lines.join('\n'), delim)
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c));
  return { header: rows[0] ?? [], rows: rows.slice(1) };
}

function splitDelimited(text: string, delim: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && !cell.trim()) {
      quoted = true;
      cell = '';
    } else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  out.push(row);
  return out;
}

export type Field = 'date' | 'amount' | 'person' | 'category' | 'description' | 'balance';
export type Columns = Partial<Record<Field, number>>;
export const FIELD_LABELS: Record<Field, string> = {
  date: 'Date',
  amount: 'Amount',
  person: 'Who',
  category: 'Category',
  description: 'Description',
  balance: 'Balance',
};

// header words in Romanian and English (compared without accents, lower case);
// balance first so "Sold" / "Balance" isn't taken for the amount
const HEADER_WORDS: [Field, RegExp][] = [
  ['balance', /\b(sold|balance|ramas|running)\b/],
  ['category', /categ/],
  [
    'description',
    /\b(descriere|descr|description|detalii|details|notes?|nota|explicatie|comentariu|comments?)\b/,
  ],
  ['person', /\b(persoana|person|cine|who|platit|paid|by|membru|platitor)\b/],
  ['date', /\b(data|date|ziua|zi|day)\b/],
  ['amount', /\b(suma|sum|amount|valoare|value|total|lei|ron|pret|price|cost)\b/],
];

/** Which column holds what, from the header row. */
export function detectColumns(header: string[]): Columns {
  const cols: Columns = {};
  const used = new Set<number>();
  for (const [field, re] of HEADER_WORDS) {
    const i = header.findIndex((h, idx) => !used.has(idx) && re.test(normalise(h)));
    if (i >= 0) {
      cols[field] = i;
      used.add(i);
    }
  }
  return cols;
}

/**
 * "RON2,000.00", "2.000,50 lei", "1 500", "12,5", "-30" → number (sign kept).
 * With both separators the last one is the decimal one; a lone separator
 * followed by exactly three digits is a thousands separator.
 */
export function parseAmount(s: string): number | null {
  const negative = /^\s*\(.*\)\s*$/.test(s) || /[-−]/.test(s);
  let t = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    t = t.split(dec === '.' ? ',' : '.').join('');
    t = t.replace(dec, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = t.split(sep);
    const intPart = parts[0];
    const thousands = parts.length > 2 || (parts[1].length === 3 && intPart !== '' && !/^0+$/.test(intPart));
    t = thousands ? parts.join('') : `${intPart}.${parts[1]}`;
  }
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return round2(negative ? -n : n);
}

interface DateParts {
  a: number;
  b: number;
  y: number;
  /** separator + year length, e.g. "-4" or "/2": cells written the same way are read the same way */
  shape: string;
}
type RawDate = { iso: string } | DateParts | null;

function readDate(s: string): RawDate {
  const t = s.trim();
  const iso = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (iso) return { iso: isoOf(Number(iso[1]), Number(iso[2]), Number(iso[3])) ?? '' };
  const m = /^(\d{1,2})([-./ ])(\d{1,2})\2(\d{2}|\d{4})(?!\d)/.exec(t);
  if (m) {
    const y = m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4]);
    return { a: Number(m[1]), b: Number(m[3]), y, shape: `${m[2]}${m[4].length}` };
  }
  // a date cell pasted as a number: days since 30 Dec 1899 (Excel, Google Sheets)
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86_400_000);
    return { iso: d.toISOString().slice(0, 10) };
  }
  return null;
}

function isoOf(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1) return null;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > days) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Reads a column of dates. Day-first or month-first is decided per way of
 * writing ("18-01-2026" can only be day-first). When a way of writing is
 * ambiguous (all parts ≤ 12, as when a spreadsheet turned some text into real
 * dates), the reading that keeps the rows in date order wins: a budget
 * history is written in order. Ties go to day-first.
 */
export function resolveDates(cells: string[]): (string | null)[] {
  const raw = cells.map(readDate);
  const shapes = new Map<string, 'day' | 'month' | 'either'>();
  for (const r of raw) {
    if (!r || 'iso' in r) continue;
    const cur = shapes.get(r.shape) ?? 'either';
    if (r.a > 12) shapes.set(r.shape, 'day');
    else if (r.b > 12 && cur !== 'day') shapes.set(r.shape, 'month');
    else shapes.set(r.shape, cur);
  }
  const open = [...shapes].filter(([, v]) => v === 'either').map(([k]) => k);
  const read = (dayFirst: Set<string>) =>
    raw.map((r) => {
      if (!r) return null;
      if ('iso' in r) return r.iso || null;
      const df = shapes.get(r.shape) === 'day' || (shapes.get(r.shape) === 'either' && dayFirst.has(r.shape));
      return df ? isoOf(r.y, r.b, r.a) : isoOf(r.y, r.a, r.b);
    });
  const descents = (ds: (string | null)[]) => {
    let n = 0;
    let prev = '';
    for (const d of ds) {
      if (!d) continue;
      if (prev && d < prev) n++;
      prev = d;
    }
    return n;
  };
  // try every day/month choice for the ambiguous ways of writing (there are only a few)
  let best = read(new Set(open));
  if (open.length && open.length <= 4) {
    let bestScore = descents(best);
    for (let mask = 1; mask < 1 << open.length; mask++) {
      const dayFirst = new Set(open.filter((_, i) => !(mask & (1 << i))));
      const ds = read(dayFirst);
      const score = descents(ds);
      if (score < bestScore) {
        best = ds;
        bestScore = score;
      }
    }
  }
  return best;
}

export interface SheetRow {
  /** row number as the spreadsheet shows it (the header is row 1) */
  line: number;
  date: string | null;
  /** always positive; whether it's money in or out comes from the category */
  amount: number | null;
  person: string;
  /** '' when the cell is empty or says None */
  category: string;
  description: string;
  balance: number | null;
  problem?: string;
}

export interface SheetValue {
  value: string;
  rows: number;
  total: number;
}

export interface SheetAnalysis {
  table: Table;
  columns: Columns;
  rows: SheetRow[];
  people: SheetValue[];
  categories: (SheetValue & { moneyIn: boolean })[];
  /** the balance on the last row, when there is a balance column */
  lastBalance: number | null;
}

const BLANK = /^(|none|null|n\/a|-|—|–)$/i;
// words for money put into a shared pot, used when there is no balance column
const MONEY_IN = /\b(depozit|depuneri?|deposit|contributie|contribution|alimentare|venit|income|money in)\b/;

export function analyseSheet(text: string, override?: Columns): SheetAnalysis {
  const table = parseTable(text);
  const columns = override ?? detectColumns(table.header);
  const cell = (r: string[], f: Field) => (columns[f] === undefined ? '' : (r[columns[f]!] ?? '').trim());
  const dates = resolveDates(table.rows.map((r) => cell(r, 'date')));
  const rows: SheetRow[] = table.rows.map((r, i) => {
    const amountRaw = parseAmount(cell(r, 'amount'));
    const cat = cell(r, 'category');
    const row: SheetRow = {
      line: i + 2,
      date: dates[i],
      amount: amountRaw === null ? null : Math.abs(amountRaw),
      person: cell(r, 'person'),
      category: BLANK.test(cat) ? '' : cat,
      description: BLANK.test(cell(r, 'description')) ? '' : cell(r, 'description'),
      balance: columns.balance === undefined ? null : parseAmount(cell(r, 'balance')),
    };
    if (!row.date) row.problem = cell(r, 'date') ? `can't read the date "${cell(r, 'date')}"` : 'no date';
    else if (!row.amount) row.problem = 'no amount';
    else if (!row.person) row.problem = 'nobody in the Who column';
    return row;
  });

  // money in or out, per category: the balance going up or down by the amount
  const votes = new Map<string, { in: number; out: number }>();
  let prev: number | null = 0;
  for (const r of rows) {
    if (r.amount && r.balance !== null && prev !== null) {
      const v = votes.get(r.category) ?? { in: 0, out: 0 };
      if (Math.abs(r.balance - prev - r.amount) < 0.011) v.in++;
      else if (Math.abs(r.balance - prev + r.amount) < 0.011) v.out++;
      votes.set(r.category, v);
    }
    prev = r.balance;
  }

  const tally = (key: (r: SheetRow) => string) => {
    const m = new Map<string, SheetValue>();
    for (const r of rows) {
      if (r.problem) continue;
      const k = key(r);
      const x = m.get(k) ?? { value: k, rows: 0, total: 0 };
      x.rows++;
      x.total = round2(x.total + (r.amount ?? 0));
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value));
  };
  const categories = tally((r) => r.category).map((c) => {
    const v = votes.get(c.value);
    const moneyIn = v && v.in + v.out > 0 ? v.in > v.out : MONEY_IN.test(normalise(c.value));
    return { ...c, moneyIn };
  });
  const withBalance = rows.filter((r) => r.balance !== null);
  return {
    table,
    columns,
    rows,
    people: tally((r) => r.person),
    categories,
    lastBalance: withBalance.length ? withBalance[withBalance.length - 1].balance : null,
  };
}

// ---------- from the sheet to entries ----------

export interface ImportEntry {
  kind: 'in' | 'out';
  date: string;
  amount: number;
  /** member email */
  by: string;
  /** budget category for money out; none when the sheet had none */
  category?: string;
  description?: string;
}

/** What a sheet category becomes: money put in, or a budget category ('' = none). */
export type CategoryTarget = { kind: 'in' } | { kind: 'out'; category: string };

export interface ImportMapping {
  /** sheet value in the Who column → member email */
  people: Record<string, string>;
  categories: Record<string, CategoryTarget>;
}

export function toEntries(a: SheetAnalysis, map: ImportMapping): ImportEntry[] {
  const out: ImportEntry[] = [];
  for (const r of a.rows) {
    if (r.problem || !r.date || !r.amount) continue;
    const by = map.people[r.person];
    const target = map.categories[r.category];
    if (!by || !target) continue;
    if (target.kind === 'in')
      out.push({
        kind: 'in',
        date: r.date,
        amount: r.amount,
        by,
        // "Depozit / Depozit" says nothing more than the category
        ...(r.description && normalise(r.description) !== normalise(r.category)
          ? { description: r.description }
          : {}),
      });
    else
      out.push({
        kind: 'out',
        date: r.date,
        amount: r.amount,
        by,
        ...(target.category ? { category: target.category } : {}),
        ...(r.description ? { description: r.description } : {}),
      });
  }
  return out;
}

/** Money in − money out. */
export const netOf = (entries: ImportEntry[]) =>
  round2(entries.reduce((t, e) => t + (e.kind === 'in' ? e.amount : -e.amount), 0));

const keyOf = (e: { kind: 'in' | 'out'; date: string; amount: number; by: string; category?: string }) =>
  `${e.kind}|${e.date}|${round2(e.amount)}|${e.by}|${e.kind === 'out' ? (e.category ?? '') : ''}`;

/**
 * Splits entries into new ones and ones already in the app (same day, amount,
 * person and category), so importing the same sheet twice adds nothing.
 */
export function splitDuplicates(entries: ImportEntry[], budgets: BudgetFile[]) {
  const have = new Map<string, number>();
  const bump = (k: string) => have.set(k, (have.get(k) ?? 0) + 1);
  for (const b of budgets) {
    for (const c of b.contributions) bump(keyOf({ kind: 'in', ...c }));
    for (const p of b.purchases)
      bump(keyOf({ kind: 'out', date: p.date, amount: p.total, by: p.spentBy, category: p.category }));
  }
  const fresh: ImportEntry[] = [];
  let duplicates = 0;
  for (const e of entries) {
    const k = keyOf(e);
    const n = have.get(k) ?? 0;
    if (n > 0) {
      have.set(k, n - 1);
      duplicates++;
    } else fresh.push(e);
  }
  return { fresh, duplicates };
}

/**
 * Suggested people: same name, else the same first letter (initials such as
 * "TT"), else nothing (the person picks).
 */
export function suggestPerson(value: string, members: { email: string; name: string }[]): string | undefined {
  const v = normalise(value);
  const exact = members.find((m) => normalise(m.name) === v || normalise(m.email.split('@')[0]) === v);
  if (exact) return exact.email;
  const initial = members.filter((m) => normalise(m.name)[0] === v[0]);
  return initial.length === 1 ? initial[0].email : undefined;
}

/**
 * Where the sheet's own running balance first stops following its rows (a
 * broken formula, a typed-over cell), and how far its last balance is from
 * what the rows add up to. The app always adds up the rows.
 */
export function balanceGap(a: SheetAnalysis, map: ImportMapping): { row: SheetRow; offAtEnd: number } | null {
  if (a.lastBalance === null) return null;
  let run = 0;
  let first: SheetRow | null = null;
  for (const r of a.rows) {
    const t = map.categories[r.category];
    if (r.problem || !r.amount || !t) continue;
    run = round2(run + (t.kind === 'in' ? r.amount : -r.amount));
    if (!first && r.balance !== null && Math.abs(r.balance - run) > 0.005) first = r;
  }
  const offAtEnd = round2(a.lastBalance - run);
  return first && Math.abs(offAtEnd) > 0.005 ? { row: first, offAtEnd } : null;
}
