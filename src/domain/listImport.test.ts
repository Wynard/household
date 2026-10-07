import { describe, expect, it } from 'vitest';
import { defaultPlace, looksLikeList, parseList, planImport, sectionName } from './listImport';
import { ACTIONS, applyToSnapshot, planAction } from './actions';
import { makeCtx, seedSnapshot } from '../test/ctx';
import { stockStatus } from './stock';
import type { Snapshot } from './actions';

import FIXTURE from '../test/fixtures/sample-list.md?raw';

/** A new, empty household: no items, no categories, the default places. */
function emptySnap(): Snapshot {
  const s = structuredClone(seedSnapshot());
  s.items.items = [];
  s.shopping.items = [];
  s.household.categories = [];
  s.household.places = ['Fridge', 'Freezer', 'Pantry', 'Cleaning cupboard', 'Bathroom', 'Storage room'];
  return s;
}

describe('list parsing', () => {
  const sections = parseList(FIXTURE);

  it('reads bold and ### headings as sections, ignores the ## title, keeps ticks', () => {
    expect(sections.map((s) => s.category)).toEqual([
      'Bacanie',
      'Lactate & oua',
      'Legume',
      'Congelate',
      'Apa/Bauturi',
      'Curatare casa & textile',
      'Igiena',
      'Farmacie',
      'Ame',
    ]);
    expect(sections[0].items).toEqual([
      { name: 'Faina alba', have: true },
      { name: 'Zahar brun', have: false },
      { name: 'Orez integral', have: true },
    ]);
  });

  it('converts ALL CAPS headings to normal capitalisation', () => {
    expect(sectionName('LACTATE & OUA')).toBe('Lactate & oua');
    expect(sectionName('CURATARE CASA & TEXTILE')).toBe('Curatare casa & textile');
    expect(sectionName('APA/BAUTURI')).toBe('Apa/Bauturi');
  });

  it('picks default places per section', () => {
    expect(sections.map((s) => [s.category, defaultPlace(s.category)])).toEqual([
      ['Bacanie', 'Pantry'],
      ['Lactate & oua', 'Fridge'],
      ['Legume', 'Fridge'],
      ['Congelate', 'Freezer'],
      ['Apa/Bauturi', 'Pantry'],
      ['Curatare casa & textile', 'Cleaning cupboard'],
      ['Igiena', 'Bathroom'],
      ['Farmacie', 'Medicine cabinet'],
      ['Ame', 'Pet corner'],
    ]);
  });

  it('spots a pasted list', () => {
    expect(looksLikeList(FIXTURE)).toBe(true);
    expect(looksLikeList('we need milk and eggs')).toBe(false);
  });
});

describe('import plan and action', () => {
  it('keeps the same name in two sections apart, frozen gets " (congelat)"', () => {
    const p = planImport(parseList(FIXTURE), [], { places: [], categories: [] });
    expect(p.renamed.map((r) => r.name)).toEqual(['Mazare (congelat)']);
    expect(p.rows.filter((r) => r.name === 'Morcovi')).toHaveLength(1); // twice in one section
    expect(p.rows.map((r) => r.name)).toContain('Lapte ovaz');
    expect(p.newPlaces).toEqual(expect.arrayContaining(['Medicine cabinet', 'Pet corner']));
  });

  it('creates simple items, categories without subcategories, new places and list entries', () => {
    const snap = emptySnap();
    const sections = parseList(FIXTURE);
    const plan = planAction(ACTIONS.importList, makeCtx(snap), { sections, addMissingToList: true });
    expect(plan.blocked).toBeUndefined();
    const after = applyToSnapshot(snap, plan.ops).snap;
    expect(after.items.items).toHaveLength(15);
    expect(after.household.categories.map((c) => c.name)).toEqual(sections.map((s) => s.category));
    expect(after.household.categories.every((c) => c.subcategories.length === 0)).toBe(true);
    expect(after.household.places).toEqual(expect.arrayContaining(['Medicine cabinet', 'Pet corner']));
    const peas = after.items.items.find((i) => i.name === 'Mazare (congelat)')!;
    expect(peas).toMatchObject({
      category: 'Congelate',
      subcategory: '',
      place: 'Freezer',
      tracking: 'simple',
      status: 'out',
      addToListWhen: 'out',
      showInStock: true,
    });
    const missing = after.items.items.filter((i) => stockStatus(i) === 'out');
    expect(after.shopping.items.map((s) => s.itemId).sort()).toEqual(missing.map((i) => i.id).sort());
  });

  it('uses the places chosen in the preview, and can leave the shopping list alone', () => {
    const snap = emptySnap();
    const plan = planAction(ACTIONS.importList, makeCtx(snap), {
      sections: parseList(FIXTURE),
      places: { Legume: 'Pantry' },
      addMissingToList: false,
    });
    const after = applyToSnapshot(snap, plan.ops).snap;
    expect(after.items.items.find((i) => i.name === 'Morcovi')!.place).toBe('Pantry');
    expect(after.shopping.items).toHaveLength(0);
  });

  it('importing again only adds new items', () => {
    const snap = emptySnap();
    const sections = parseList(FIXTURE);
    const once = applyToSnapshot(snap, planAction(ACTIONS.importList, makeCtx(snap), { sections }).ops).snap;
    expect(planAction(ACTIONS.importList, makeCtx(once), { sections }).blocked).toMatch(/already/);
    const more = parseList(`${FIXTURE}\n- [ ] Ceai verde\n`);
    const p = planAction(ACTIONS.importList, makeCtx(once), { sections: more });
    expect(p.title).toBe('Import 1 item');
    expect(p.lines).toContain('15 items already there, skipped');
  });
});

// Local only: tries the real list when it is present. Prints counts, never contents.
// (import.meta.glob finds nothing when the git-ignored file is absent, so the test skips itself)
const PRIVATE = Object.values(
  import.meta.glob<string>('../../private/LISTA_CUMPARATURI.md', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
)[0];
describe.skipIf(!PRIVATE)('private list (local only)', () => {
  it('parses and plans without errors', () => {
    const sections = parseList(PRIVATE!);
    expect(sections.length).toBeGreaterThan(0);
    const snap = emptySnap();
    const plan = planAction(ACTIONS.importList, makeCtx(snap), { sections });
    expect(plan.blocked).toBeUndefined();
    const after = applyToSnapshot(snap, plan.ops).snap;
    const names = after.items.items.map((i) => i.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});
