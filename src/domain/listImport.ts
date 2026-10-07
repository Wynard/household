// Starting data: importing our own Markdown list (5.2). Pure functions; the
// importList action turns the plan into ops.
import { normalise } from './categorise';
import type { Item } from './schemas';

export interface ParsedItem {
  name: string;
  /** "- [x]" = we have it at home */
  have: boolean;
}
export interface ParsedSection {
  /** the heading as written */
  heading: string;
  /** the heading in normal capitalisation: the category name */
  category: string;
  items: ParsedItem[];
}

/** "LACTATE & OUA" -> "Lactate & oua", "APA/BAUTURI" -> "Apa/Bauturi". */
export function sectionName(heading: string): string {
  return heading
    .trim()
    .toLocaleLowerCase('ro-RO')
    .replace(/(^|\/\s*)(\p{L})/gu, (_, pre: string, ch: string) => pre + ch.toLocaleUpperCase('ro-RO'));
}

/** First letter capitalised, the rest as written. */
export function itemName(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim();
  return t ? t[0].toLocaleUpperCase('ro-RO') + t.slice(1) : t;
}

const BOLD_LINE = /^\*\*(.+?)\*\*:?$/;
const H3 = /^#{3,6}\s+(.+?)\s*#*$/;
const TITLE = /^#{1,2}\s+/;
const ITEM = /^[-*+]\s+\[( |x|X)\]\s+(.+)$/;

/**
 * Reads a Markdown list: "###" headings or bold-only lines start sections,
 * "- [x]" / "- [ ]" lines are items. The "##" title is ignored. Items before
 * the first section go into "Other".
 */
export function parseList(md: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  for (const raw of md.split(/\r?\n/)) {
    // trailing spaces and Markdown "  " line breaks; a trailing backslash break too
    const line = raw.replace(/\\$/, '').trim();
    if (!line) continue;
    const h = line.match(H3) ?? line.match(BOLD_LINE);
    if (h) {
      const heading = h[1].replace(/\*\*/g, '').trim();
      if (!heading) continue;
      current = { heading, category: sectionName(heading), items: [] };
      sections.push(current);
      continue;
    }
    if (TITLE.test(line)) continue;
    const m = line.match(ITEM);
    if (!m) continue;
    const name = itemName(m[2].replace(/\*\*/g, ''));
    if (!name) continue;
    if (!current) {
      current = { heading: 'Other', category: 'Other', items: [] };
      sections.push(current);
    }
    current.items.push({ name, have: m[1] !== ' ' });
  }
  // the same heading twice: one section
  const merged: ParsedSection[] = [];
  for (const s of sections) {
    const same = merged.find((x) => normalise(x.category) === normalise(s.category));
    if (same) same.items.push(...s.items);
    else merged.push(s);
  }
  return merged.filter((s) => s.items.length);
}

/** Looks like our list: at least three checkbox lines. Used to spot a pasted list in the Assistant. */
export const looksLikeList = (text: string) =>
  text.split(/\r?\n/).filter((l) => ITEM.test(l.trim())).length >= 3;

const words = (s: string) => ` ${normalise(s).replace(/[^a-z0-9]+/g, ' ')} `;
const has = (w: string, list: string[]) => list.some((x) => w.includes(` ${x}`));

export const isFrozenSection = (category: string) => has(words(category), ['congel', 'frozen', 'freezer']);

/** Default storage place for a section, from its name (Romanian or English). */
export function defaultPlace(category: string): string {
  const w = words(category);
  if (isFrozenSection(category)) return 'Freezer';
  if (has(w, ['farma', 'medic', 'pharma', 'sanatate', 'health'])) return 'Medicine cabinet';
  if (w === ' ame ' || has(w, ['animal', 'pet', 'pisic', 'caine'])) return 'Pet corner';
  if (has(w, ['curat', 'textil', 'detergent', 'clean', 'laundry', 'spalat'])) return 'Cleaning cupboard';
  if (
    has(w, ['par ', 'hair', 'piele', 'skin', 'ingrijire', 'igien', 'hygien', 'cosmetic', 'personal', 'baie'])
  )
    return 'Bathroom';
  if (
    has(w, [
      'lact',
      'oua',
      'dairy',
      'egg',
      'peste',
      'fish',
      'gata',
      'ready',
      'tartin',
      'spread',
      'legum',
      'veget',
      'fruct',
      'fruit',
      'produce',
      'carne',
      'meat',
      'mezel',
      'branz',
      'cheese',
    ])
  )
    return 'Fridge';
  return 'Pantry';
}

export interface ImportRow {
  name: string;
  category: string;
  have: boolean;
  /** set when the name was changed to keep two sections' items apart */
  renamedFrom?: string;
}
export interface ImportPlan {
  sections: { category: string; count: number; place: string }[];
  /** items that will be created */
  rows: ImportRow[];
  /** names already in the household (matched by name or receipt spelling): skipped */
  existing: { name: string; category: string; matched: string }[];
  renamed: ImportRow[];
  newCategories: string[];
  newPlaces: string[];
}

/**
 * What an import would do. The same name in two sections becomes two items:
 * the frozen one gets " (congelat)", any other gets the section name. Names
 * already in the household are skipped, so importing again only adds new items.
 */
export function planImport(
  sections: ParsedSection[],
  existingItems: Item[],
  household: { places: string[]; categories: { name: string }[] },
  places: Record<string, string> = {},
): ImportPlan {
  const known = new Map<string, Item>();
  for (const it of existingItems) {
    known.set(normalise(it.name), it);
    for (const a of it.aliases) if (!known.has(normalise(a))) known.set(normalise(a), it);
  }
  // how many sections each name appears in
  const sectionsOf = new Map<string, Set<string>>();
  for (const s of sections)
    for (const i of s.items) {
      const k = normalise(i.name);
      sectionsOf.set(k, (sectionsOf.get(k) ?? new Set()).add(s.category));
    }
  const rows: ImportRow[] = [];
  const existing: ImportPlan['existing'] = [];
  const taken = new Set<string>();
  for (const s of sections) {
    for (const i of s.items) {
      const k = normalise(i.name);
      let name = i.name;
      if ((sectionsOf.get(k)?.size ?? 0) > 1) {
        const first = [...sectionsOf.get(k)!][0];
        if (isFrozenSection(s.category)) name = `${i.name} (congelat)`;
        else if (s.category !== first) name = `${i.name} (${s.category.toLocaleLowerCase('ro-RO')})`;
      }
      const nk = normalise(name);
      if (taken.has(nk)) continue; // listed twice in one section
      taken.add(nk);
      const match = known.get(nk);
      if (match) {
        existing.push({ name, category: s.category, matched: match.name });
        continue;
      }
      rows.push({
        name,
        category: s.category,
        have: i.have,
        ...(name !== i.name ? { renamedFrom: i.name } : {}),
      });
    }
  }
  const catNames = new Set(household.categories.map((c) => normalise(c.name)));
  const placeOf = (c: string) => places[c] ?? defaultPlace(c);
  const usedCats = [...new Set(rows.map((r) => r.category))];
  const placeNames = new Set(household.places.map(normalise));
  return {
    sections: sections.map((s) => ({
      category: s.category,
      count: rows.filter((r) => r.category === s.category).length,
      place: placeOf(s.category),
    })),
    rows,
    existing,
    renamed: rows.filter((r) => r.renamedFrom),
    newCategories: usedCats.filter((c) => !catNames.has(normalise(c))),
    newPlaces: [...new Set(usedCats.map(placeOf))].filter((p) => !placeNames.has(normalise(p))),
  };
}
