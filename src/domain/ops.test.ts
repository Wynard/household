import { describe, expect, it } from 'vitest';
import { O, applyOps, applyOpsToFiles, type Op } from './ops';

const items = () => ({
  items: [
    { id: 'a', name: 'Milk', quantity: 1, unit: 'l' },
    { id: 'b', name: 'Eggs', quantity: 4, unit: 'pcs' },
  ],
});
const household = () => ({
  places: ['Fridge', 'Pantry'],
  categories: [{ name: 'Produce', subcategories: ['Fruit', 'Herbs'] }],
});

function roundTrip(file: 'items' | 'household', data: unknown, ops: Op[]) {
  const { files, inverse } = applyOpsToFiles({ [file]: data }, ops);
  const back = applyOpsToFiles(files, inverse).files[file];
  return { after: files[file], back };
}

describe('ops', () => {
  it('upserts new and existing records', () => {
    const d = applyOps(items(), [O.item.upsert({ id: 'c', name: 'Rice' } as never)]);
    expect(d.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    const d2 = applyOps(d, [O.item.upsert({ id: 'a', name: 'Milk 1.5%' } as never)]);
    expect(d2.items[0].name).toBe('Milk 1.5%');
  });

  it('inc clamps at zero and its inverse restores the exact value', () => {
    const { after, back } = roundTrip('items', items(), [O.item.inc('a', -3)]);
    expect((after as ReturnType<typeof items>).items[0].quantity).toBe(0);
    expect(back).toEqual(items());
  });

  it('inc re-applies on a newer version instead of overwriting', () => {
    // Partner raised eggs to 6 meanwhile; my +1 lands on top of theirs.
    const theirs = applyOps(items(), [O.item.inc('b', 2)]);
    const mine = applyOps(theirs, [O.item.inc('b', 1)]);
    expect(mine.items[1].quantity).toBe(7);
  });

  it('patch on a record the other person deleted is skipped, not resurrected', () => {
    const deleted = applyOps(items(), [O.item.remove('a')]);
    const r = applyOpsToFiles({ items: deleted }, [O.item.patch('a', { name: 'x' })]);
    expect(r.skipped).toHaveLength(1);
    expect((r.files.items as ReturnType<typeof items>).items).toHaveLength(1);
  });

  it('undo restores the exact previous state for mixed ops', () => {
    const ops: Op[] = [
      O.item.patch('a', { name: 'Milk 3.5%', lowThreshold: 2 } as never),
      O.item.remove('b'),
      O.item.upsert({ id: 'c', name: 'Rice' } as never),
      O.item.inc('c' as string, 5),
    ];
    const { back } = roundTrip('items', items(), ops);
    expect(back).toEqual(items());
  });

  it('patch with unset removes keys and undo puts them back', () => {
    const start = { items: [{ id: 'a', name: 'Milk', lowThreshold: 2 }] };
    const { after, back } = roundTrip('items', start, [O.item.patch('a', {}, ['lowThreshold'])]);
    expect((after as typeof start).items[0]).not.toHaveProperty('lowThreshold');
    expect(back).toEqual(start);
  });

  it('list and category ops invert cleanly', () => {
    const ops: Op[] = [
      O.household.listAdd('places', 'Bathroom'),
      O.household.listRename('places', 'Fridge', 'Cold'),
      O.household.listMove('places', 'Pantry', 0),
      O.household.catRename('Produce', 'Fresh'),
      O.household.subAdd('Fresh', 'Mushrooms'),
      O.household.subRename('Fresh', 'Fruit', 'Fruits'),
      O.household.subRemove('Fresh', 'Herbs'),
      O.household.catAdd('Garden', ['Seeds']),
    ];
    const { after, back } = roundTrip('household', household(), ops);
    expect(after).toEqual({
      places: ['Pantry', 'Cold', 'Bathroom'],
      categories: [
        { name: 'Fresh', subcategories: ['Fruits', 'Mushrooms'] },
        { name: 'Garden', subcategories: ['Seeds'] },
      ],
    });
    expect(back).toEqual(household());
  });

  it('renaming a store to an existing one merges them', () => {
    const d = applyOps({ stores: ['Lidl', 'LIDL', 'Penny'] }, [
      O.household.listRename('stores', 'LIDL', 'Lidl'),
    ]);
    expect(d.stores).toEqual(['Lidl', 'Penny']);
  });
});

describe('mapSet', () => {
  it('sets and removes keys and inverts', () => {
    const start = { fileIds: { items: 'a' } };
    const ops: Op[] = [
      { t: 'mapSet', file: 'household', field: 'fileIds', key: 'plan', value: 'b' },
      { t: 'mapSet', file: 'household', field: 'fileIds', key: 'items', value: 'c' },
    ];
    const { files, inverse } = applyOpsToFiles({ household: start }, ops);
    expect(files.household).toEqual({ fileIds: { items: 'c', plan: 'b' } });
    expect(applyOpsToFiles(files, inverse).files.household).toEqual(start);
  });
});
