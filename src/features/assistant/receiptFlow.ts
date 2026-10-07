// Receipt card and confirm (6.7): the card summarises the draft; Apply (or
// Confirm on the review screen) uploads the clean photos to receipts/YYYY/,
// then saves the purchase, stock, last prices, learned spellings and the
// shopping-list check-off in one action. Undo reverts all of it.
import type { Ctx } from '../../domain/actions';
import { makeCard, type Card } from '../../ai/assistant/cards';
import { shoppingMatches } from '../../ai/receipt';
import { lineTotal, toActionInput, LOW_CONFIDENCE, type PurchaseDraft } from '../budget/PurchaseEditor';
import { dayLabel, money, parseDecimal, plural, qty as fmtQty, round2 } from '../../domain/format';
import { memberName } from '../../domain/actions/budget';
import type { CompressedPhoto } from '../../ai/image';
import type { DataStore } from '../../storage/store';

export function receiptInput(d: PurchaseDraft, ctx: Ctx, receiptFileIds: string[] = []) {
  return {
    ...toActionInput(d),
    source: 'receipt' as const,
    total: d.printedTotal ?? lineTotal(d.lines),
    receiptFileIds,
    checkShoppingIds: shoppingMatches(d, ctx.snap.shopping.items).map((s) => s.id),
  };
}

export function receiptCard(ctx: Ctx, d: PurchaseDraft): Card {
  const total = lineTotal(d.lines);
  const printed = d.printedTotal;
  const checks = shoppingMatches(d, ctx.snap.shopping.items).length;
  const missingCat = d.lines.filter((l) => !l.category).length;
  const card = makeCard(ctx, [{ action: 'addPurchase', input: receiptInput(d, ctx) }], {
    kind: 'receipt',
    edit: 'receipt',
    title: `Save a ${d.store || 'receipt'} purchase of ${money(printed ?? total)}`,
    ...(!d.store
      ? { blocked: "I couldn't read the store name. Tap Edit to add it." }
      : missingCat
        ? { blocked: `Pick a category for ${plural(missingCat, 'item')}: tap Edit.` }
        : {}),
  });
  const lines = [
    `${d.store || 'Store not found'}, ${dayLabel(d.date)}${d.time ? ` ${d.time}` : ''}, total ${money(printed ?? total)}${
      printed === undefined
        ? ''
        : Math.abs(printed - total) < 0.01
          ? ', matches the printed total'
          : `, lines add up to ${money(total)} (${money(Math.abs(round2(printed - total)))} off)`
    }`,
    ...d.lines.map((l) => {
      const q = parseDecimal(l.quantity) || 0;
      const low = l.confidence !== undefined && l.confidence < LOW_CONFIDENCE && !l.confirmed;
      return `${l.name}, ${fmtQty(q, l.unit)}, ${money(parseDecimal(l.price) || 0)}${l.toStock ? ', added to stock' : ''}${low ? ' (please check)' : ''}`;
    }),
    `Money taken from the pot by ${memberName(ctx, d.spentBy)}`,
    `${plural(checks, 'shopping list item')} will be checked off`,
    'Receipt photo saved without location data',
  ];
  return { ...card, lines };
}

export function receiptSummaryText(d: PurchaseDraft): string {
  const total = lineTotal(d.lines);
  const unsure = d.lines.filter(
    (l) => l.confidence !== undefined && l.confidence < LOW_CONFIDENCE && !l.confirmed,
  );
  const matches = d.printedTotal === undefined || Math.abs(d.printedTotal - total) < 0.01;
  return [
    `I read a ${d.store || ''} receipt from ${dayLabel(d.date)}: ${plural(d.lines.length, 'item')}, ${money(d.printedTotal ?? total)}${
      d.printedTotal === undefined
        ? ''
        : matches
          ? ', which matches the printed total'
          : `, but the lines add up to ${money(total)}`
    }.`,
    unsure.length
      ? unsure.length === 1
        ? ` One line I'm less sure about: ${unsure[0].rawText ?? unsure[0].name}${unsure[0].itemId ? ` looks like your ${unsure[0].name}` : ''}. Tap Edit if that's wrong.`
        : ` ${unsure.length} lines are marked "please check". Tap Edit to look at them.`
      : '',
  ]
    .join('')
    .replace(/\s+/g, ' ');
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) || 'receipt';

/** Uploads the photos; returns their Drive IDs. */
export async function uploadReceiptPhotos(
  store: DataStore,
  d: PurchaseDraft,
  photos: CompressedPhoto[],
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < photos.length; i++) {
    const { fileId } = await store.adapter.uploadImage(
      `receipts/${d.date.slice(0, 4)}/${d.date}-${slug(d.store)}-${Date.now().toString(36)}-${i + 1}.jpg`,
      photos[i].blob,
    );
    ids.push(fileId);
  }
  return ids;
}

export async function deleteReceiptPhotos(store: DataStore, ids: string[]) {
  for (const id of ids) await store.adapter.deleteImage?.(id).catch(() => undefined);
}
