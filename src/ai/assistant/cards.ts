// Action cards (6.10). A card is a preview of one or more actions. Nothing is
// written until a person taps Apply; Apply re-plans against fresh data and, if
// the preview changed, shows the new preview instead of applying blindly.
import { ACTIONS, applyToSnapshot, planAction, type ActionName, type Ctx } from '../../domain/actions';
import type { Op } from '../../domain/ops';

export interface CardStep {
  action: ActionName;
  input: unknown;
}

export type CardStatus = 'pending' | 'applied' | 'cancelled' | 'undone' | 'expired';

export interface Card {
  id: string;
  kind: 'action' | 'receipt' | 'recipe';
  steps: CardStep[];
  title: string;
  lines: string[];
  danger?: boolean;
  /** why Apply is disabled ("I didn't catch the store, tap Edit to add it") */
  blocked?: string;
  status: CardStatus;
  /** which form Edit opens */
  edit?: 'purchase' | 'contribution' | 'item' | 'recipe' | 'receipt';
  /** set when Apply found the data had changed and showed an updated preview */
  refreshed?: boolean;
  /** danger cards need a second tap */
  armed?: boolean;
  inverse?: Op[];
  /** receipt cards: uploaded photo IDs (for undo) */
  photoIds?: string[];
  note?: string;
  /** the preview as planned (title + lines); Apply compares against this, since some cards show a custom summary */
  planned?: { title: string; lines: string[] };
  /** after applying: a link to open what was created */
  openAfter?: { label: string; to: string };
}

export interface Preview {
  title: string;
  lines: string[];
  danger: boolean;
  blocked?: string;
  ops: Op[];
}

/**
 * Plans every step in order against the given context (each step sees the
 * previous ones' effect) and returns one combined preview. Never writes.
 */
export function previewSteps(ctx: Ctx, steps: CardStep[]): Preview {
  let cur = ctx;
  const ops: Op[] = [];
  const lines: string[] = [];
  let title = '';
  let danger = false;
  for (const s of steps) {
    const def = ACTIONS[s.action] as never;
    const p = planAction(def, cur, s.input);
    if (p.blocked)
      return { title: p.title, lines: [...lines, ...p.lines], danger, blocked: p.blocked, ops: [] };
    title ||= p.title;
    lines.push(...(steps.length > 1 ? [p.title, ...p.lines] : p.lines));
    danger ||= !!p.danger;
    ops.push(...p.ops);
    cur = { ...cur, snap: applyToSnapshot(cur.snap, p.ops).snap };
  }
  if (steps.length > 1) title = `${steps.length} changes`;
  return { title, lines, danger: danger || ops.length > 10, ops };
}

export const samePreview = (card: Pick<Card, 'title' | 'lines'>, p: Pick<Preview, 'title' | 'lines'>) =>
  card.title === p.title && JSON.stringify(card.lines) === JSON.stringify(p.lines);

export function makeCard(ctx: Ctx, steps: CardStep[], extra: Partial<Card> = {}): Card {
  const p = previewSteps(ctx, steps);
  return {
    id: ctx.newId(),
    kind: 'action',
    steps,
    title: extra.title ?? p.title,
    lines: p.lines,
    danger: p.danger,
    blocked: extra.blocked ?? p.blocked,
    status: 'pending',
    ...extra,
    planned: { title: p.title, lines: p.lines },
  };
}

export type ApplyOutcome =
  | { kind: 'applied'; inverse: Op[] }
  | { kind: 'refreshed'; card: Card }
  | { kind: 'blocked'; reason: string }
  | { kind: 'needs-confirm' };

/**
 * Apply (6.10): re-plans with fresh data; if the preview differs from what the
 * person saw, returns the refreshed card instead of writing. Danger cards need
 * `confirmed` (the second tap). Only then are the exact planned ops committed.
 */
export async function applyCard(
  card: Card,
  freshCtx: Ctx,
  commit: (ops: Op[]) => Promise<{ inverse: Op[] }>,
  confirmed = false,
): Promise<ApplyOutcome> {
  const p = previewSteps(freshCtx, card.steps);
  if (p.blocked) return { kind: 'blocked', reason: p.blocked };
  // always compare with what's on screen right now, however many times it changed
  if (!samePreview(card.planned ?? card, p)) {
    return {
      kind: 'refreshed',
      card: {
        ...card,
        title: card.steps.length > 1 || card.kind !== 'action' ? card.title : p.title,
        lines: p.lines,
        planned: { title: p.title, lines: p.lines },
        danger: p.danger,
        refreshed: true,
        armed: false,
      },
    };
  }
  if ((p.danger || card.danger) && !confirmed) return { kind: 'needs-confirm' };
  const { inverse } = await commit(p.ops);
  return { kind: 'applied', inverse };
}
