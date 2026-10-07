import { describe, expect, it } from 'vitest';
import { ACTIONS, applyToSnapshot, planAction } from './index';
import { makeCtx, seedSnapshot } from '../../test/ctx';

const item = (snap: ReturnType<typeof seedSnapshot>, id: string) =>
  snap.items.items.find((i) => i.id === id)!;

describe('adjustStock', () => {
  it('previews the change with before and after', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.adjustStock, ctx, { itemId: 'potatoes', delta: 2 });
    expect(p.blocked).toBeUndefined();
    expect(p.title).toBe('Potatoes: 2,5 kg → 4,5 kg');
    expect(p.lines).toEqual(['Potatoes: 2,5 kg → 4,5 kg, Pantry']);
  });

  it('logs usage on decrease (not on increase) with an estimated value', () => {
    const ctx = makeCtx();
    const down = planAction(ACTIONS.adjustStock, ctx, { itemId: 'rice', delta: -100 });
    const { snap } = applyToSnapshot(ctx.snap, down.ops);
    const u = snap.usage[2026].usage.at(-1)!;
    expect(u).toMatchObject({
      itemId: 'rice',
      quantity: 100,
      unit: 'g',
      reason: 'manual-decrease',
      by: 'ana@example.com',
    });
    expect(u.value).toBeGreaterThan(0);

    const up = planAction(ACTIONS.adjustStock, ctx, { itemId: 'rice', delta: 100 });
    const after = applyToSnapshot(ctx.snap, up.ops).snap;
    expect(after.usage[2026].usage).toHaveLength(ctx.snap.usage[2026].usage.length);
  });

  it('adds a low-stock shopping entry when crossing the threshold and removes it when restored', () => {
    const ctx = makeCtx();
    // potatoes 2,5 kg, threshold 1 kg
    const down = planAction(ACTIONS.adjustStock, ctx, { itemId: 'potatoes', set: 0.5 });
    const s1 = applyToSnapshot(ctx.snap, down.ops).snap;
    const entry = s1.shopping.items.find((s) => s.itemId === 'potatoes');
    expect(entry).toMatchObject({ source: 'low-stock', checked: false, addedBy: 'Ana' });

    const up = planAction(ACTIONS.adjustStock, makeCtx(s1), { itemId: 'potatoes', set: 2 });
    const s2 = applyToSnapshot(s1, up.ops).snap;
    expect(s2.shopping.items.find((s) => s.itemId === 'potatoes')).toBeUndefined();
  });

  it('undo restores the exact previous state, including usage and shopping', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.adjustStock, ctx, { itemId: 'potatoes', set: 0 });
    const { snap, inverse } = applyToSnapshot(ctx.snap, p.ops);
    expect(item(snap, 'potatoes').quantity).toBe(0);
    const back = applyToSnapshot(snap, inverse).snap;
    expect(back).toEqual(ctx.snap);
  });

  it('records the Assistant actor in audit fields', () => {
    const ctx = makeCtx(undefined, { actor: 'Assistant, approved by Ana' });
    const p = planAction(ACTIONS.adjustStock, ctx, { itemId: 'potatoes', set: 0 });
    const { snap } = applyToSnapshot(ctx.snap, p.ops);
    expect(snap.shopping.items.find((s) => s.itemId === 'potatoes')?.addedBy).toBe(
      'Assistant, approved by Ana',
    );
  });

  it('never goes below zero and blocks unknown items', () => {
    const ctx = makeCtx();
    const p = planAction(ACTIONS.adjustStock, ctx, { itemId: 'eggs', delta: -100 });
    expect(applyToSnapshot(ctx.snap, p.ops).snap.items.items.find((i) => i.id === 'eggs')!.quantity).toBe(0);
    expect(planAction(ACTIONS.adjustStock, ctx, { itemId: 'nope', delta: 1 }).blocked).toBeTruthy();
  });
});
