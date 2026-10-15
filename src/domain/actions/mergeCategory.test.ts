import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx } from '../../test/ctx';
import { unusedCategories } from './settings';

const lines = (s: ReturnType<typeof makeCtx>['snap']) =>
  Object.values(s.budgets).flatMap((b) => b.purchases.flatMap((p) => p.lines));

describe('merge categories and remove unused ones', () => {
  it('merges a subcategory into another category: items, purchase lines and usage move, the source goes', () => {
    const ctx = makeCtx();
    const before = {
      items: ctx.snap.items.items.filter((i) => i.category === 'Household' && i.subcategory === 'Cleaning')
        .length,
      lines: lines(ctx.snap).filter((l) => l.category === 'Household' && l.subcategory === 'Cleaning').length,
    };
    expect(before.items + before.lines).toBeGreaterThan(0);
    const p = planAction(ACTIONS.mergeCategory, ctx, {
      from: { category: 'Household', subcategory: 'Cleaning' },
      to: { category: 'Personal care', subcategory: 'Hygiene' },
    });
    expect(p.blocked).toBeUndefined();
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.items.items.filter((i) => i.subcategory === 'Cleaning')).toHaveLength(0);
    expect(
      lines(snap).filter((l) => l.category === 'Household' && l.subcategory === 'Cleaning'),
    ).toHaveLength(0);
    expect(snap.household.categories.find((c) => c.name === 'Household')!.subcategories).not.toContain(
      'Cleaning',
    );
    expect(applyToSnapshot(snap, inverse).snap).toEqual(ctx.snap);
  });

  it('merges a whole category into one without subcategories, and removes the category', () => {
    const ctx = makeCtx();
    const s1 = applyToSnapshot(
      ctx.snap,
      planAction(ACTIONS.addCategory, ctx, { name: 'Casa', subcategories: [] }).ops,
    ).snap;
    const p = planAction(ACTIONS.mergeCategory, makeCtx(s1), {
      from: { category: 'Household' },
      to: { category: 'Casa' },
    });
    const s2 = applyToSnapshot(s1, p.ops).snap;
    expect(s2.household.categories.map((c) => c.name)).not.toContain('Household');
    expect(s2.items.items.filter((i) => i.category === 'Casa').every((i) => i.subcategory === '')).toBe(true);
    expect(s2.items.items.some((i) => i.category === 'Household')).toBe(false);
  });

  it('refuses merging into itself or into something that does not exist', () => {
    const ctx = makeCtx();
    expect(
      planAction(ACTIONS.mergeCategory, ctx, { from: { category: 'Produce' }, to: { category: 'Produce' } })
        .blocked,
    ).toBeTruthy();
    expect(
      planAction(ACTIONS.mergeCategory, ctx, { from: { category: 'Produce' }, to: { category: 'Nope' } })
        .blocked,
    ).toMatch(/no Nope/);
  });

  it('removes only categories and subcategories nothing uses', () => {
    const ctx = makeCtx();
    const s1 = applyToSnapshot(ctx.snap, [
      ...planAction(ACTIONS.addCategory, ctx, { name: 'Empty one', subcategories: ['A'] }).ops,
      ...planAction(ACTIONS.addSubcategory, ctx, { category: 'Produce', name: 'Unused sub' }).ops,
    ]).snap;
    const u = unusedCategories(makeCtx(s1));
    expect(u.cats).toContain('Empty one');
    expect(u.subs).toContainEqual({ category: 'Produce', name: 'Unused sub' });
    const p = planAction(ACTIONS.removeUnusedCategories, makeCtx(s1), {});
    const s2 = applyToSnapshot(s1, p.ops).snap;
    expect(s2.household.categories.map((c) => c.name)).not.toContain('Empty one');
    expect(s2.household.categories.find((c) => c.name === 'Produce')!.subcategories).not.toContain(
      'Unused sub',
    );
    // everything an item or purchase line uses is still there
    for (const i of s2.items.items)
      expect(s2.household.categories.some((c) => c.name === i.category)).toBe(true);
  });
});
