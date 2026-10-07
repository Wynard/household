// Receipt scanning (6.7): photos -> Gemini -> a reviewable purchase draft.
import { z } from 'zod';
import { generateJson } from './gemini';
import { untrusted, isSensitiveReceiptLine, scrubReceiptText } from './privacy';
import { catalogForPrompt, treeForPrompt } from './context';
import type { CompressedPhoto } from './image';
import type { CategoryTree, Item, ShoppingItem, Unit } from '../domain/schemas';
import { matchReceiptLine } from '../domain/matching';
import { ruleCategory, normalise } from '../domain/categorise';
import { NON_FOOD_CATEGORIES } from '../domain/defaults';
import { num, round2 } from '../domain/format';
import type { LineDraft, PurchaseDraft } from '../features/budget/PurchaseEditor';

const UNIT_ENUM = ['g', 'kg', 'ml', 'l', 'pcs'] as const;

export const RECEIPT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string', description: 'Store chain name only, e.g. Lidl, Kaufland, Mega Image' },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    time: { type: ['string', 'null'], description: 'HH:mm' },
    total: { type: ['number', 'null'], description: 'TOTAL printed on the receipt, in lei' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rawText: { type: 'string', description: 'The product line exactly as printed' },
          name: { type: 'string', description: 'Clear product name in English, e.g. "Milk 1.5%"' },
          quantity: { type: 'number' },
          unit: { type: 'string', enum: UNIT_ENUM },
          price: { type: 'number', description: 'Line total in lei after any discount on the next line' },
          category: { type: 'string' },
          subcategory: { type: 'string' },
          itemId: {
            type: ['string', 'null'],
            description: 'ID from the catalog when it is the same product, else null',
          },
          confidence: { type: 'number', description: '0 to 1: how sure you are about this line' },
        },
        required: [
          'rawText',
          'name',
          'quantity',
          'unit',
          'price',
          'category',
          'subcategory',
          'itemId',
          'confidence',
        ],
      },
    },
  },
  required: ['store', 'date', 'time', 'total', 'lines'],
};

const receiptAnswer = z
  .object({
    store: z.string().catch(''),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .catch(null),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .catch(null),
    total: z.number().nullable().catch(null),
    lines: z.array(
      z.object({
        rawText: z.string().catch(''),
        name: z.string().min(1),
        quantity: z.number().positive().catch(1),
        unit: z.enum(UNIT_ENUM).catch('pcs'),
        price: z.number(),
        category: z.string().catch(''),
        subcategory: z.string().catch(''),
        itemId: z.string().nullable().catch(null),
        confidence: z.number().min(0).max(1).catch(0.5),
      }),
    ),
  })
  // anything else Gemini adds (card numbers, cashier, address...) is dropped here
  .strip();
export type ReceiptAnswer = z.infer<typeof receiptAnswer>;

export const RECEIPT_PROMPT = `You read Romanian supermarket and market receipts for a two-person household in Romania. Amounts are in lei (RON).
Rules:
- Product names are abbreviated (e.g. "LAPTE ZUZU 1,5% 1L", "PIEPT PUI", "DETERG VASE"). Give each a clear English name.
- Commas are decimal separators: "12,99" means 12.99.
- Quantity lines like "2 BUC x 4,99" mean 2 pieces at 4.99 each; weight lines like "0,542 KG x 12,99" mean 0.542 kg. Use the line total as price.
- A discount line (DISCOUNT, REDUCERE, "-2,00") belongs to the product line above it: subtract it from that line's price and don't list it separately.
- Ignore VAT/TVA summaries, fiscal codes, payment lines, change (REST), subtotals and totals except the final TOTAL.
- Never return card numbers, card types, loyalty or account numbers, cashier names or store addresses. Leave them out entirely.
- Choose category and subcategory only from the category tree given.
- Set itemId only when the line is clearly the same product as a catalog item; otherwise null.
- confidence below 0.7 means the person should check the line.
- If something is unreadable, give your best guess and a low confidence.`;

export async function readReceipt(
  photos: CompressedPhoto[],
  items: Item[],
  tree: CategoryTree,
  signal?: AbortSignal,
): Promise<ReceiptAnswer> {
  const answer = await generateJson(
    {
      systemInstruction: RECEIPT_PROMPT,
      contents: [
        {
          role: 'user',
          parts: [
            ...photos.map((p) => ({ inlineData: { mimeType: 'image/jpeg', data: p.base64 } })),
            {
              text: [
                `The ${photos.length > 1 ? `${photos.length} photos are parts of one long receipt, top to bottom` : 'photo is one receipt'}. Read it.`,
                untrusted('category tree', treeForPrompt(tree)),
                untrusted(
                  'item catalog (id | name | known receipt spellings | unit)',
                  catalogForPrompt(items),
                ),
              ].join('\n\n'),
            },
          ],
        },
      ],
    },
    RECEIPT_JSON_SCHEMA,
    receiptAnswer,
    { signal },
  );
  return sanitizeReceipt(answer);
}

/** Removes anything sensitive that came back anyway. */
export function sanitizeReceipt(a: ReceiptAnswer): ReceiptAnswer {
  return {
    ...a,
    store: scrubReceiptText(a.store)
      .replace(/\s+(srl|sa|s\.r\.l\.|s\.a\.)\b.*$/i, '')
      .trim()
      .slice(0, 60),
    lines: a.lines
      .filter((l) => !isSensitiveReceiptLine(l.rawText) && !isSensitiveReceiptLine(l.name))
      .map((l) => ({ ...l, rawText: scrubReceiptText(l.rawText) })),
  };
}

/** Matches lines to the catalog and builds the review draft. */
export function receiptToDraft(
  a: ReceiptAnswer,
  ctx: { items: Item[]; tree: CategoryTree; stores: string[]; spentBy: string; today: string; now: string },
): PurchaseDraft {
  const inTree = (c: string, s: string) => ctx.tree.some((n) => n.name === c && n.subcategories.includes(s));
  const lines: LineDraft[] = a.lines.map((l) => {
    const m = matchReceiptLine(l.rawText, l.name, ctx.items, { itemId: l.itemId, confidence: l.confidence });
    const it = m.itemId ? ctx.items.find((i) => i.id === m.itemId) : undefined;
    let category = it?.category ?? (inTree(l.category, l.subcategory) ? l.category : undefined);
    let subcategory = it?.subcategory ?? (category ? l.subcategory : undefined);
    if (!category) {
      const r = ruleCategory(`${l.name} ${l.rawText}`);
      if (r && inTree(r.category, r.subcategory)) ({ category, subcategory } = r);
    }
    const confidence = Math.min(l.confidence, m.via === 'none' ? l.confidence : m.confidence);
    const unit: Unit = l.unit;
    return {
      id: crypto.randomUUID(),
      rawText: l.rawText || undefined,
      itemId: it?.id,
      name: it?.name ?? l.name,
      quantity: num(l.quantity, 3),
      unit,
      price: num(round2(l.price)),
      category,
      subcategory,
      auto: !it && !!category,
      toStock:
        !!category && !NON_FOOD_CATEGORIES.includes(category)
          ? true
          : !!it && it.showInStock && !NON_FOOD_CATEGORIES.includes(it.category),
      confidence,
      confirmed: m.via === 'alias',
    };
  });
  const store = ctx.stores.find((s) => normalise(s) === normalise(a.store)) ?? a.store;
  const date = a.date && a.date <= ctx.today && a.date > '2000-01-01' ? a.date : ctx.today;
  return {
    store,
    date,
    time: a.time ?? undefined,
    spentBy: ctx.spentBy,
    purpose: '',
    lines,
    printedTotal: a.total ?? undefined,
    source: 'receipt',
  };
}

/** Open shopping-list entries this receipt will check off. */
export function shoppingMatches(draft: PurchaseDraft, list: ShoppingItem[]): ShoppingItem[] {
  const ids = new Set(draft.lines.map((l) => l.itemId).filter(Boolean));
  const names = new Set(draft.lines.map((l) => normalise(l.name)));
  return list.filter((s) => !s.checked && ((s.itemId && ids.has(s.itemId)) || names.has(normalise(s.name))));
}
