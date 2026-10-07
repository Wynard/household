import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTransport } from '../gemini';
import { runTurn } from './engine';
import { applyCard } from './cards';
import { makeCtx } from '../../test/ctx';
import { applyToSnapshot } from '../../domain/actions';
import type { Op } from '../../domain/ops';

vi.mock('../../app/prefs', () => ({ prefs: { geminiKey: () => 'k', geminiModel: () => '' } }));
afterEach(() => setTransport((u, i) => fetch(u, i)));

type Call = { name: string; args: Record<string, unknown> };
/** Scripted Gemini: each request gets the next answer (function calls or text). */
function script(answers: (Call[] | string)[]) {
  const bodies: Record<string, unknown>[] = [];
  let i = 0;
  setTransport(async (_u, init) => {
    bodies.push(JSON.parse(String(init.body)));
    const a = answers[Math.min(i++, answers.length - 1)];
    const parts =
      typeof a === 'string' ? [{ text: a }] : a.map((c) => ({ functionCall: c, thoughtSignature: 'sig' }));
    return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts } }] }));
  });
  return bodies;
}

const screen = { key: 'stock', label: 'Looking at Stock' };

describe('assistant tool routing (mocked Gemini)', () => {
  it('proposal tools never write: they only return a card', async () => {
    const ctx = makeCtx();
    const before = JSON.stringify(ctx.snap);
    script([
      [{ name: 'searchItems', args: { query: 'potatoes' } }],
      [
        {
          name: 'proposePurchase',
          args: {
            store: 'Piața Obor',
            spentBy: 'Person B',
            lines: [
              { name: 'Potatoes', itemId: 'potatoes', quantity: 2, unit: 'kg', price: 10, addToStock: true },
            ],
          },
        },
      ],
      'Here is the purchase. Check it and tap Apply.',
    ]);
    const out = await runTurn({
      ctx,
      screen,
      history: [],
      text: 'we bought 2 kg potatoes at the market for 10 lei, Mihai paid',
    });
    expect(JSON.stringify(ctx.snap)).toBe(before);
    expect(out.cards).toHaveLength(1);
    expect(out.cards[0]).toMatchObject({
      title: 'Add a purchase of 10,00 lei',
      status: 'pending',
      edit: 'purchase',
    });
    expect(out.cards[0].lines[0]).toBe('Piața Obor, 7 Oct, money taken by Mihai');
    expect(out.cards[0].lines).toContain('Stock: Potatoes 2,5 kg → 4,5 kg, Pantry');
  });

  it('names are pseudonymised on the way out and restored in the reply; thought signatures are kept', async () => {
    const ctx = makeCtx();
    const bodies = script([[{ name: 'getBudget', args: {} }], 'Person B spent the most this month.']);
    const out = await runTurn({
      ctx,
      screen,
      history: [{ role: 'user', text: 'hi Ana here' }],
      text: 'Did Mihai spend more than me?',
    });
    const sent = JSON.stringify(bodies);
    expect(sent).not.toMatch(/Mihai|Ana\b|@example\.com/);
    expect(sent).toContain('Person B');
    expect(sent).toContain('"thoughtSignature":"sig"');
    expect(out.text).toBe('Mihai spent the most this month.');
  });

  it('Apply writes exactly what the card showed', async () => {
    const ctx = makeCtx();
    script([
      [{ name: 'proposeStockChange', args: { changes: [{ itemId: 'rice', set: 500 }] } }],
      'Prepared.',
    ]);
    const { cards } = await runTurn({ ctx, screen, history: [], text: 'we have only 500 g of rice' });
    let written: Op[] = [];
    const res = await applyCard(cards[0], makeCtx(), async (ops) => {
      written = ops;
      return { inverse: [] };
    });
    expect(res.kind).toBe('applied');
    const after = applyToSnapshot(ctx.snap, written).snap;
    expect(after.items.items.find((i) => i.id === 'rice')!.quantity).toBe(500);
    expect(cards[0].lines).toEqual(['Rice: 1000 g → 500 g, Pantry'.replace('1000 g', '1 kg')]);
  });

  it('a stale card re-previews instead of applying', async () => {
    const ctx = makeCtx();
    script([[{ name: 'proposeStockChange', args: { changes: [{ itemId: 'rice', delta: -100 }] } }], 'ok']);
    const { cards } = await runTurn({ ctx, screen, history: [], text: 'used 100 g rice' });
    // meanwhile the other person changed the rice
    const changed = applyToSnapshot(ctx.snap, [
      { t: 'patch', file: 'items', coll: 'items', id: 'rice', set: { quantity: 400 } },
    ]).snap;
    const commit = vi.fn(async () => ({ inverse: [] }));
    const res = await applyCard(cards[0], makeCtx(changed), commit);
    expect(res.kind).toBe('refreshed');
    expect(commit).not.toHaveBeenCalled();
    if (res.kind === 'refreshed') {
      expect(res.card.lines).toEqual(['Rice: 400 g → 300 g, Pantry']);
      // tapping Apply again on the refreshed card applies it
      const again = await applyCard(res.card, makeCtx(changed), commit);
      expect(again.kind).toBe('applied');
      expect(commit).toHaveBeenCalledTimes(1);
    }
  });

  it('deletions need a second tap; missing store disables Apply with the reason', async () => {
    const ctx = makeCtx();
    script([
      [
        { name: 'proposeDelete', args: { kind: 'item', id: 'trashbags' } },
        { name: 'proposePurchase', args: { lines: [{ name: 'Bread', quantity: 1, unit: 'pcs', price: 5 }] } },
      ],
      'ok',
    ]);
    const { cards } = await runTurn({
      ctx,
      screen,
      history: [],
      text: 'delete trash bags and add bread for 5 lei',
    });
    const [del, buy] = cards;
    expect(del.danger).toBe(true);
    const commit = vi.fn(async () => ({ inverse: [] }));
    expect((await applyCard(del, makeCtx(), commit)).kind).toBe('needs-confirm');
    expect((await applyCard(del, makeCtx(), commit, true)).kind).toBe('applied');
    expect(buy.blocked).toBe("I didn't catch the store, tap Edit to add it");
  });

  it('caps tool rounds per message', async () => {
    const ctx = makeCtx();
    const bodies = script([[{ name: 'getPlaces', args: {} }]]);
    const out = await runTurn({ ctx, screen, history: [], text: 'loop forever' });
    expect(bodies.length).toBe(7); // 6 rounds with tools + 1 final without
    expect(bodies.at(-1)!.tools).toBeUndefined();
    expect(out.text).toMatch(/simpler way|Done looking/);
  });
});
