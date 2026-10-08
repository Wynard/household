import { describe, expect, it } from 'vitest';
import { allUnits, convert, isCountUnit, isStockUnit } from './units';
import { ACTIONS, applyToSnapshot, planAction } from './actions';
import { makeCtx } from '../test/ctx';
import { parseFile } from './files';
import { stepFor } from './stock';

describe('own units (can, jar…)', () => {
  it('are counting units: same-unit amounts add up, a piece weight converts to grams', () => {
    expect(isCountUnit('can')).toBe(true);
    expect(isCountUnit('kg')).toBe(false);
    expect(isStockUnit('can')).toBe(true);
    expect(isStockUnit('tbsp')).toBe(false);
    expect(convert(2, 'can', 'can')).toBe(2);
    expect(convert(2, 'can', 'g', 400)).toBe(800);
    expect(convert(0.8, 'kg', 'can', 400)).toBe(2);
    expect(convert(1, 'can', 'pcs')).toBeNull();
    expect(stepFor({ unit: 'can' })).toBe(1);
  });

  it('add, rename while unused, and refuse duplicates or built-in names', () => {
    const ctx = makeCtx();
    expect(planAction(ACTIONS.addUnit, ctx, { name: 'kg' }).blocked).toMatch(/built-in/);
    const add = planAction(ACTIONS.addUnit, ctx, { name: ' Can ' });
    expect(add.title).toBe('New unit: can');
    const s1 = applyToSnapshot(ctx.snap, add.ops).snap;
    expect(allUnits(s1.household)).toEqual(['g', 'kg', 'ml', 'l', 'pcs', 'can']);
    expect(planAction(ACTIONS.addUnit, makeCtx(s1), { name: 'CAN' }).blocked).toMatch(/already/);
    const ren = planAction(ACTIONS.renameUnit, makeCtx(s1), { from: 'can', to: 'tin' });
    expect(applyToSnapshot(s1, ren.ops).snap.household.units).toEqual(['tin']);
  });

  it('can be used by items, and then not deleted or renamed', () => {
    const ctx = makeCtx();
    const s1 = applyToSnapshot(ctx.snap, planAction(ACTIONS.addUnit, ctx, { name: 'jar' }).ops).snap;
    const add = planAction(ACTIONS.upsertItem, makeCtx(s1), {
      name: 'Pickles',
      category: 'Pantry',
      subcategory: 'Canned & jars',
      place: 'Pantry',
      tracking: 'amount',
      unit: 'jar',
      quantity: 2,
    });
    expect(add.blocked).toBeUndefined();
    const s2 = applyToSnapshot(s1, add.ops).snap;
    expect(planAction(ACTIONS.deleteUnit, makeCtx(s2), { name: 'jar' }).blocked).toMatch(/used 1 time/);
    expect(planAction(ACTIONS.renameUnit, makeCtx(s2), { from: 'jar', to: 'pot' }).blocked).toMatch(
      /can't be renamed/,
    );
  });

  it('older files get an empty unit list', () => {
    const h = makeCtx().snap.household;
    const { units: _u, ...old } = h;
    void _u;
    expect(parseFile('household', { ...old, schemaVersion: 3 }).units).toEqual([]);
  });
});
