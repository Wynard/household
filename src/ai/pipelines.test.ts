import { afterEach, describe, expect, it, vi } from 'vitest';
import { setTransport, GeminiError, extractJson } from './gemini';
import { readReceipt, receiptToDraft, sanitizeReceipt, shoppingMatches, type ReceiptAnswer } from './receipt';
import { answerToRecipe, importRecipe } from './recipe';
import { seedSnapshot, TODAY } from '../test/ctx';

vi.mock('../app/prefs', () => ({ prefs: { geminiKey: () => 'test-key', geminiModel: () => '' } }));

const snap = seedSnapshot();
const items = snap.items.items;
const tree = snap.household.categories;
const reply = (obj: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status === 200
        ? { candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(obj) }] } }] }
        : { error: { message: 'x' } },
    ),
    {
      status,
    },
  );

afterEach(() => setTransport((u, i) => fetch(u, i)));

const answer: ReceiptAnswer = {
  store: 'LIDL DISCOUNT SRL Str. Exemplu',
  date: '2026-10-02',
  time: '19:05',
  total: 24.47,
  lines: [
    {
      rawText: 'LAPTE ZUZU 1,5% 1L',
      name: 'Milk 1.5%',
      quantity: 2,
      unit: 'l',
      price: 11.98,
      category: 'Dairy & eggs',
      subcategory: 'Milk',
      itemId: 'milk',
      confidence: 0.95,
    },
    {
      rawText: 'ROSII CHERRY 250G',
      name: 'Cherry tomatoes',
      quantity: 0.25,
      unit: 'kg',
      price: 6.49,
      category: 'Produce',
      subcategory: 'Vegetables',
      itemId: 'tomatoes',
      confidence: 0.6,
    },
    {
      rawText: 'DETERG VASE 450ML',
      name: 'Dish soap',
      quantity: 1,
      unit: 'pcs',
      price: 6,
      category: 'Household',
      subcategory: 'Cleaning',
      itemId: null,
      confidence: 0.9,
    },
    {
      rawText: 'CARD VISA ****1234',
      name: 'Card payment',
      quantity: 1,
      unit: 'pcs',
      price: 24.47,
      category: 'Household',
      subcategory: 'Cleaning',
      itemId: null,
      confidence: 0.9,
    },
  ],
};

describe('receipt pipeline', () => {
  it('sends the photo, the tree and the catalog, never names or emails, and asks for JSON', async () => {
    let sent = '';
    setTransport(async (_u, init) => {
      sent = String(init.body);
      expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
      return reply(answer);
    });
    const r = await readReceipt([{ base64: 'AAAA', blob: new Blob(), width: 1, height: 1 }], items, tree);
    expect(sent).toContain('"inlineData"');
    expect(sent).toContain('responseJsonSchema');
    expect(sent).toContain('untrusted_data kind=\\"item catalog');
    expect(sent).not.toMatch(/@example\.com|Ana|Mihai/);
    expect(r.lines).toHaveLength(3); // the card line is dropped
  });

  it('drops sensitive lines and store addresses', () => {
    const s = sanitizeReceipt(answer);
    expect(s.store).toBe('LIDL DISCOUNT');
    expect(s.lines.some((l) => /CARD/.test(l.rawText))).toBe(false);
  });

  it('builds a draft: matched items, categories from the tree, stock defaults, low confidence kept', () => {
    const d = receiptToDraft(sanitizeReceipt(answer), {
      items,
      tree,
      stores: ['Lidl'],
      spentBy: 'ana@example.com',
      today: TODAY,
      now: '',
    });
    expect(d).toMatchObject({
      date: '2026-10-02',
      time: '19:05',
      printedTotal: 24.47,
      source: 'receipt',
      spentBy: 'ana@example.com',
    });
    const [milk, tom, soap] = d.lines;
    expect(milk).toMatchObject({ itemId: 'milk', name: 'Milk 1.5%', toStock: true, confirmed: true });
    expect(tom.confidence).toBeLessThan(0.7);
    expect(soap).toMatchObject({ itemId: 'dishsoap', category: 'Household', toStock: false }); // matched by alias, non-food
    expect(
      shoppingMatches(d, snap.shopping.items)
        .map((s) => s.id)
        .sort(),
    ).toEqual(['sh1', 'sh5']);
  });

  it('retries once on invalid JSON, then returns the raw text', async () => {
    let calls = 0;
    setTransport(async () => {
      calls++;
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json at all' }] } }] }),
      );
    });
    const e = await readReceipt([{ base64: 'A', blob: new Blob(), width: 1, height: 1 }], items, tree).catch(
      (x) => x,
    );
    expect(calls).toBe(2);
    expect(e).toBeInstanceOf(GeminiError);
    expect((e as GeminiError).kind).toBe('bad-json');
    expect((e as GeminiError).raw).toBe('not json at all');
  });

  it('turns HTTP errors into plain messages', async () => {
    setTransport(async () => reply(null, 429));
    await expect(readReceipt([], items, tree)).rejects.toMatchObject({
      kind: 'rate',
      message: "Gemini's free limit was reached, try again in a minute.",
    });
  });
});

describe('recipe import', () => {
  const recipe = {
    title: 'Ciorbă de legume',
    servings: 4,
    prepMinutes: 15,
    cookMinutes: 40,
    categories: ['romanian', 'Soups'],
    newCategory: 'Soups',
    ingredients: [
      { name: 'potatoes', amount: 500, unit: 'g', itemId: 'potatoes', pantryStaple: false, optional: false },
      { name: 'salt', amount: null, unit: 'to taste', itemId: null, pantryStaple: true, optional: false },
      { name: 'lovage', amount: null, unit: null, itemId: 'not-real', pantryStaple: false, optional: true },
    ],
    steps: [
      { text: 'Peel and dice the potatoes.', timerSeconds: null },
      { text: 'Simmer for 25 minutes.', timerSeconds: null },
    ],
    notes: null,
  };

  it('uses URL context with a schema, and refuses non-https links', async () => {
    let sent = '';
    setTransport(async (_u, init) => {
      sent = String(init.body);
      return reply(recipe);
    });
    await importRecipe({ url: 'https://recipes.example.com/ciorba' }, items, ['Romanian']);
    expect(sent).toContain('"url_context"');
    expect(sent).toContain('responseJsonSchema');
    await expect(importRecipe({ url: 'http://recipes.example.com' }, items, [])).rejects.toThrow(/https/);
  });

  it('falls back to two calls when tools and schema can’t be combined', async () => {
    const bodies: string[] = [];
    setTransport(async (_u, init) => {
      bodies.push(String(init.body));
      if (bodies.length === 1)
        return new Response(
          JSON.stringify({ error: { message: 'Tool use with a response schema is unsupported' } }),
          { status: 400 },
        );
      if (bodies.length === 2)
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: 'Ciorba... potatoes 500 g ...' }] } }],
          }),
        );
      return reply(recipe);
    });
    const r = await importRecipe({ url: 'https://recipes.example.com/ciorba' }, items, ['Romanian']);
    expect(r.title).toBe('Ciorbă de legume');
    expect(bodies[1]).toContain('url_context');
    expect(bodies[2]).not.toContain('url_context');
    expect(bodies[2]).toContain('untrusted_data kind=\\"pasted recipe text');
  });

  it('builds a clean draft: known categories, one new category, real item links only, timers detected', () => {
    const d = answerToRecipe(
      recipe as never,
      items,
      ['Romanian', 'Italian'],
      'https://recipes.example.com/ciorba',
    );
    expect(d.categories).toEqual(['Romanian']);
    expect(d.newCategory).toBe('Soups');
    expect(d.ingredients!.map((g) => g.itemId)).toEqual(['potatoes', undefined, undefined]);
    expect(d.ingredients![1].pantryStaple).toBe(true);
    expect(d.steps![1].timerSeconds).toBe(1500);
    expect(d.steps![0].ingredientIds).toEqual([d.ingredients![0].id]);
    expect(d.sourceUrl).toBe('https://recipes.example.com/ciorba');
    expect(answerToRecipe(recipe as never, items, [], 'javascript:alert(1)').sourceUrl).toBeUndefined();
  });

  it('extracts JSON from fenced answers', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} thanks')).toEqual({ a: 2 });
  });
});
