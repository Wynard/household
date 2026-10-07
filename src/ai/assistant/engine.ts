// One Assistant turn (6.10): the user's message goes to Gemini with read and
// proposal tools; read tools answer from local data, proposal tools become
// cards. At most MAX_ROUNDS tool rounds per message.
import { generate, type Content, type Part } from '../gemini';
import { Pseudonymiser, untrusted } from '../privacy';
import { ALL_TOOLS, runTool, type Link } from './tools';
import type { Card } from './cards';
import type { Ctx } from '../../domain/actions';
import { treeForPrompt } from '../context';

export const MAX_ROUNDS = 6;

export interface ScreenInfo {
  key: string;
  label: string;
  recordId?: string;
}

export interface TurnInput {
  ctx: Ctx;
  screen: ScreenInfo;
  /** previous messages, oldest first (text only) */
  history: { role: 'user' | 'assistant'; text: string }[];
  text: string;
  signal?: AbortSignal;
}

export interface TurnOutput {
  text: string;
  cards: Card[];
  links: Link[];
}

export function systemPrompt(ctx: Ctx, screen: ScreenInfo, pseudo: Pseudonymiser): string {
  const h = ctx.snap.household;
  const me = pseudo.label(ctx.me.email);
  const record =
    screen.key === 'recipe' && screen.recordId
      ? ` The open recipe is "${ctx.snap.recipes.recipes.find((r) => r.id === screen.recordId)?.title ?? ''}" (id ${screen.recordId}).`
      : '';
  return [
    `You are the assistant inside "Household", an app shared by two people in Romania, called ${h.members
      .slice(0, 2)
      .map((m) => pseudo.label(m.email))
      .join(' and ')}. You are talking to ${me}. Money is in lei (RON), units are metric.`,
    `Today is ${ctx.today}. The user is looking at: ${screen.label}.${record}`,
    'You can read their stock, recipes, meal plan, shopping list, budget and spending with the read tools. Call them instead of guessing.',
    'To change anything, call a propose… tool. It only shows the user a card with Apply / Edit / Cancel. Never say something is done, saved or added: say you prepared it and they can apply it.',
    'Use item and recipe ids from the read tools. When a purchase mentions who paid, set spentBy to that person; otherwise leave it out (it defaults to the user).',
    'For the shared pot: contributions put money in, purchases take money out. There are no debts between the two people.',
    'Reply briefly, in plain words, in the language the user wrote in (Romanian or English). No markdown tables, no links, no images.',
    'Offer openScreen buttons when it helps the user see something ("Open Tomato pasta", "See it in Insights").',
    untrusted('category tree', treeForPrompt(h.categories)),
    untrusted('storage places', h.places.join(', ')),
    untrusted('recipe categories', h.recipeCategories.join(', ')),
  ].join('\n');
}

export async function runTurn(input: TurnInput): Promise<TurnOutput> {
  const pseudo = new Pseudonymiser(input.ctx.snap.household.members);
  const contents: Content[] = [
    ...input.history
      .slice(-12)
      .map((m): Content => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: pseudo.hide(m.text) }],
      })),
    { role: 'user', parts: [{ text: pseudo.hide(input.text) }] },
  ];
  const cards: Card[] = [];
  const links: Link[] = [];
  const system = systemPrompt(input.ctx, input.screen, pseudo);
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const r = await generate(
      {
        systemInstruction: system,
        contents,
        tools: round < MAX_ROUNDS ? [{ functionDeclarations: ALL_TOOLS }] : undefined,
      },
      { signal: input.signal },
    );
    if (!r.functionCalls.length) {
      return {
        text:
          pseudo.reveal(r.text.trim()) ||
          (cards.length ? 'Here it is. Check it and tap Apply.' : 'Done looking.'),
        cards,
        links,
      };
    }
    // keep the model's own turn exactly as returned (thought signatures included)
    contents.push(r.content);
    const responses: Part[] = [];
    for (const call of r.functionCalls) {
      let response: Record<string, unknown>;
      try {
        const res = runTool(call.name, call.args, { ctx: input.ctx, pseudo });
        response = res.response;
        if (res.card) cards.push(res.card);
        if (res.link && !links.some((l) => l.to === res.link!.to)) links.push(res.link);
      } catch (e) {
        response = { error: e instanceof Error ? e.message : 'Tool failed' };
      }
      // read results go back pseudonymised, wrapped as data
      responses.push({
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: JSON.parse(pseudo.hide(JSON.stringify(response))),
        },
      });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return {
    text: cards.length
      ? 'I prepared this. Check it and tap Apply.'
      : "I couldn't finish that. Try asking in a simpler way.",
    cards,
    links,
  };
}
