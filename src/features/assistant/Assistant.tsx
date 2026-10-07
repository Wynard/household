import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useAssistantUi } from '../../app/assistantUi';
import { buildCtx, errorText, useMe, useRun, useSnapshot, useStore } from '../../app/data';
import { prefs } from '../../app/prefs';
import { useToast } from '../../ui/Toast';
import { IconCamera, IconChat, IconClose, IconMic, IconSend } from '../../ui/icons';
import { useOverlay } from '../../ui/overlay';
import { runTurn } from '../../ai/assistant/engine';
import { applyCard, previewSteps, type Card } from '../../ai/assistant/cards';
import { recipeCard, type Link } from '../../ai/assistant/tools';
import { GeminiError, geminiKey, geminiMessage } from '../../ai/gemini';
import { compressPhoto, type CompressedPhoto } from '../../ai/image';
import { readReceipt, receiptToDraft } from '../../ai/receipt';
import { answerToRecipe, importRecipe } from '../../ai/recipe';
import { Pseudonymiser } from '../../ai/privacy';
import type { Op } from '../../domain/ops';
import type { Recipe } from '../../domain/schemas';
import { PurchaseEditor, type PurchaseDraft } from '../budget/PurchaseEditor';
import { MoneySheet } from '../budget/BudgetScreen';
import { ItemEditor } from '../stock/ItemEditor';
import { RecipeEditor } from '../recipes/RecipeEditor';
import {
  deleteReceiptPhotos,
  receiptCard,
  receiptInput,
  receiptSummaryText,
  uploadReceiptPhotos,
} from './receiptFlow';
import { useSpeech } from './voice';
import { num } from '../../domain/format';

interface Msg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  photos?: number;
  cards?: Card[];
  links?: Link[];
  tone?: 'error';
  /** raw model text after a bad-json failure, so it can be entered by hand */
  raw?: string;
}

const MAX_KEPT = 50;
const URL_RE = /https:\/\/[^\s<>"']+/i;
const uid = () => crypto.randomUUID();

function loadChat(): Msg[] {
  try {
    const raw = prefs.chatRaw();
    const list = raw ? (JSON.parse(raw) as Msg[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function suggestions(key: string, otherName: string): string[] {
  const buy = `We bought 2 kg potatoes for 10 lei at the market, ${otherName} paid`;
  const m: Record<string, string[]> = {
    stock: [buy, 'What’s running low?', 'Move all cleaning items to the storage room'],
    recipe: [
      'Make this for 4 on Saturday',
      'What can we cook tonight?',
      'Add what’s missing to the shopping list',
    ],
    recipes: ['What can we cook tonight?', 'Plan the free dinners this week, nothing over 40 minutes'],
    plan: ['Plan the free dinners this week, nothing over 40 minutes', 'Use the chicken first'],
    shopping: ['What’s running low?', 'Add what this week’s meals need', buy],
    budget: ['How much did we spend on snacks this month?', buy, 'We each put in 500 lei today'],
    insights: [
      'What did we spend the most on last month?',
      'How much did we spend on snacks this month?',
      'What do we buy but not use?',
    ],
  };
  return m[key] ?? m.stock;
}

type Editing =
  | { kind: 'receipt'; card: Card; msgId: string; draft: PurchaseDraft; photos: CompressedPhoto[] }
  | { kind: 'purchase'; draft: PurchaseDraft }
  | { kind: 'contribution'; prefill: { amount?: number; by?: string; date?: string; note?: string } }
  | { kind: 'item'; itemId: string }
  | { kind: 'recipe'; initial: Partial<Recipe> };

/** Lives inside the app shell; shows the panel and any form opened from a card's Edit. */
export function AssistantHost() {
  const ui = useAssistantUi();
  const [editing, setEditing] = useState<Editing | null>(null);
  return (
    <>
      {ui.isOpen && <AssistantPanel onEdit={(e) => setEditing(e)} />}
      {editing && <EditHost editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function AssistantPanel({ onEdit }: { onEdit: (e: Editing) => void }) {
  useOverlay();
  const ui = useAssistantUi();
  const nav = useNavigate();
  const store = useStore();
  const me = useMe();
  const { snap } = useSnapshot();
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[]>(loadChat);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState<string | null>(null);
  const [photos, setPhotos] = useState<CompressedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [textImport, setTextImport] = useState(false);
  const receipts = useRef(new Map<string, { draft: PurchaseDraft; photos: CompressedPhoto[] }>());
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const speech = useSpeech(prefs.ui().voiceLang, setInput);

  // persist the conversation on this phone only (never to Drive)
  useEffect(() => prefs.setChatRaw(JSON.stringify(msgs.slice(-MAX_KEPT))), [msgs]);
  useEffect(() => {
    const onClear = () => setMsgs([]);
    window.addEventListener('hh-chat-cleared', onClear);
    return () => window.removeEventListener('hh-chat-cleared', onClear);
  }, []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs, thinking]);
  // a prompt from elsewhere ("Import from a link")
  useEffect(() => {
    const p = ui.takePrompt();
    if (p?.prompt) setMsgs((m) => [...m, { id: uid(), role: 'assistant', text: p.prompt! }]);
    if (p?.draft) setInput(p.draft);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => abort.current?.abort(), []);

  const push = (m: Omit<Msg, 'id'>) => setMsgs((x) => [...x, { id: uid(), ...m }]);
  const setCard = (msgId: string, cardId: string, patch: Partial<Card> | ((c: Card) => Card)) =>
    setMsgs((x) =>
      x.map((m) =>
        m.id !== msgId
          ? m
          : {
              ...m,
              cards: m.cards?.map((c) =>
                c.id !== cardId ? c : typeof patch === 'function' ? patch(c) : { ...c, ...patch },
              ),
            },
      ),
    );

  const failure = (e: unknown) => {
    const kind = e instanceof GeminiError ? e.kind : 'other';
    push({
      role: 'assistant',
      text: geminiMessage(e),
      tone: 'error',
      raw: e instanceof GeminiError ? e.raw : undefined,
      links:
        kind === 'no-key' || kind === 'key' || kind === 'model'
          ? [{ label: 'Open Settings', to: '/settings/device' }]
          : undefined,
    });
  };

  const others = snap?.household.members.filter((m) => m.email !== me?.email) ?? [];
  const chips = suggestions(ui.context.key, others[0]?.name ?? 'my partner');

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (thinking || (!text && !photos.length) || !me || !snap) return;
    speech.stop();
    setInput('');
    if (!geminiKey()) {
      push({ role: 'user', text: text || 'Receipt photo', photos: photos.length || undefined });
      failure(
        new GeminiError(
          'no-key',
          'Add your Gemini key in Settings › This phone first. It takes a minute and each of you uses your own.',
        ),
      );
      return;
    }
    const ac = new AbortController();
    abort.current = ac;
    const history = msgs.filter((m) => !m.tone).map((m) => ({ role: m.role, text: m.text }));
    try {
      const ctx = await buildCtx(store, me, { viaAssistant: true });
      if (photos.length) {
        // ---- receipt ----
        const shots = photos;
        setPhotos([]);
        push({
          role: 'user',
          text: text || (shots.length > 1 ? `Receipt, ${shots.length} photos` : 'Receipt photo'),
          photos: shots.length,
        });
        setThinking('Reading the receipt and matching it to your stock…');
        const answer = await readReceipt(
          shots,
          ctx.snap.items.items,
          ctx.snap.household.categories,
          ac.signal,
        );
        const pseudo = new Pseudonymiser(ctx.snap.household.members);
        const named = ctx.snap.household.members.find(
          (m) => new RegExp(`\\b${m.name}\\b`, 'i').test(text) && /paid|plătit|platit|a dat/i.test(text),
        );
        const draft = receiptToDraft(answer, {
          items: ctx.snap.items.items,
          tree: ctx.snap.household.categories,
          stores: ctx.snap.household.stores,
          spentBy: named?.email ?? pseudo.emailFor(text) ?? me.email,
          today: ctx.today,
          now: ctx.now,
        });
        if (!draft.lines.length) {
          push({
            role: 'assistant',
            text: "I couldn't find any products on that photo. Try again with the whole receipt flat and in good light, or add the purchase by hand in Budget.",
          });
          return;
        }
        const card = receiptCard(ctx, draft);
        receipts.current.set(card.id, { draft, photos: shots });
        push({ role: 'assistant', text: receiptSummaryText(draft), cards: [card] });
      } else if (textImport || URL_RE.test(text)) {
        // ---- recipe import ----
        const url = textImport ? undefined : text.match(URL_RE)![0].replace(/[).,]+$/, '');
        push({ role: 'user', text });
        setTextImport(false);
        setThinking('Reading the page and writing clear steps…');
        const answer = await importRecipe(
          url ? { url } : { text },
          ctx.snap.items.items,
          ctx.snap.household.recipeCategories,
          ac.signal,
        );
        const draft = answerToRecipe(answer, ctx.snap.items.items, ctx.snap.household.recipeCategories, url);
        const card = recipeCard(ctx, draft);
        const host = url ? new URL(url).hostname.replace(/^www\./, '') : undefined;
        push({
          role: 'assistant',
          text: `${host ? `I read the recipe on ${host}` : 'I read the recipe'} and rewrote the steps as short, clear actions. Check it, then Apply to add it to your recipes, or Edit to change anything first.`,
          cards: [card],
        });
      } else {
        // ---- conversation ----
        push({ role: 'user', text });
        setThinking('Checking your data…');
        const out = await runTurn({ ctx, screen: ui.context, history, text, signal: ac.signal });
        push({
          role: 'assistant',
          text: out.text,
          cards: out.cards.length ? out.cards : undefined,
          links: out.links.length ? out.links : undefined,
        });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (URL_RE.test(text) && !(e instanceof GeminiError && (e.kind === 'no-key' || e.kind === 'rate'))) {
        push({
          role: 'assistant',
          text: `${geminiMessage(e)} You can paste the recipe text instead.`,
          tone: 'error',
          links: [{ label: 'Paste recipe text', to: '#paste-recipe' }],
        });
      } else failure(e);
    } finally {
      setThinking(null);
      abort.current = null;
    }
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPreparing(true);
    try {
      const out: CompressedPhoto[] = [];
      for (const f of Array.from(files).slice(0, 6)) out.push(await compressPhoto(f));
      setPhotos((p) => [...p, ...out].slice(0, 6));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't prepare that photo.");
    } finally {
      setPreparing(false);
    }
  };

  const apply = async (msg: Msg, card: Card) => {
    if (!me) return;
    if (card.danger && !card.armed) {
      setCard(msg.id, card.id, { armed: true });
      return;
    }
    try {
      const ctx = await buildCtx(store, me, { viaAssistant: true });
      if (card.kind === 'receipt') {
        const data = receipts.current.get(card.id);
        const current = previewSteps(ctx, card.steps);
        if (current.blocked) return void toast.show(current.blocked);
        const ids = data ? await uploadReceiptPhotos(store, data.draft, data.photos) : [];
        const steps = [
          {
            action: 'addPurchase' as const,
            input: data ? receiptInput(data.draft, ctx, ids) : card.steps[0].input,
          },
        ];
        const p = previewSteps(ctx, steps);
        if (p.blocked) {
          await deleteReceiptPhotos(store, ids);
          return void toast.show(p.blocked);
        }
        const { inverse } = await store.commit(p.ops);
        setCard(msg.id, card.id, { status: 'applied', inverse, photoIds: ids });
        toast.show('Receipt saved via Assistant');
        return;
      }
      const out = await applyCard(card, ctx, (ops) => store.commit(ops), !!card.armed);
      if (out.kind === 'blocked') return void toast.show(out.reason);
      if (out.kind === 'needs-confirm') return void setCard(msg.id, card.id, { armed: true });
      if (out.kind === 'refreshed') {
        setCard(msg.id, card.id, out.card);
        toast.show('Things changed since I prepared this. Check the new preview and tap Apply again.');
        return;
      }
      const created = createdRecipe(card, out.inverse);
      setCard(msg.id, card.id, {
        status: 'applied',
        inverse: out.inverse,
        armed: false,
        ...(created ? { openAfter: { label: `Open ${created.title}`, to: `/recipes/${created.id}` } } : {}),
      });
      toast.show('Applied via Assistant');
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const undo = async (msg: Msg, card: Card) => {
    try {
      if (card.inverse) await store.commit(card.inverse as Op[]);
      if (card.photoIds?.length) await deleteReceiptPhotos(store, card.photoIds);
      setCard(msg.id, card.id, { status: 'undone' });
    } catch (e) {
      toast.error(errorText(e));
    }
  };

  const edit = (msg: Msg, card: Card) => {
    const step = card.steps[0];
    setCard(msg.id, card.id, { status: 'cancelled', note: 'Opened in the form. Save it there.' });
    ui.close();
    if (card.kind === 'receipt') {
      const data = receipts.current.get(card.id);
      if (data)
        return onEdit({ kind: 'receipt', card, msgId: msg.id, draft: data.draft, photos: data.photos });
      return onEdit({ kind: 'purchase', draft: inputToDraft(step.input, 'receipt') });
    }
    if (card.edit === 'purchase')
      return onEdit({ kind: 'purchase', draft: inputToDraft(step.input, 'manual') });
    if (card.edit === 'contribution') return onEdit({ kind: 'contribution', prefill: step.input as never });
    if (card.edit === 'item') return onEdit({ kind: 'item', itemId: (step.input as { id: string }).id });
    if (card.edit === 'recipe') return onEdit({ kind: 'recipe', initial: step.input as Partial<Recipe> });
  };

  const go = (l: Link) => {
    if (l.to === '#paste-recipe') {
      setTextImport(true);
      inputRef.current?.focus();
      return;
    }
    ui.close();
    nav(l.to);
  };

  return createPortal(
    <div className="overlay" style={{ zIndex: 42, justifyContent: 'stretch' }}>
      <button
        type="button"
        aria-label="Close the assistant"
        className="overlay-close"
        style={{ flex: '0 0 56px' }}
        onClick={ui.close}
      />
      <div className="chat" role="dialog" aria-modal="true" aria-label="Assistant">
        <div className="chat-head">
          <div className="row-between">
            <span className="row" style={{ gap: 10 }}>
              <span className="chat-avatar" aria-hidden>
                <IconChat size={20} />
              </span>
              <span className="display bold" style={{ fontSize: 22 }}>
                Assistant
              </span>
            </span>
            <span className="row" style={{ gap: 0 }}>
              <button type="button" className="link-btn" onClick={() => setMsgs([])}>
                New chat
              </button>
              <button type="button" className="icon-btn" aria-label="Close" onClick={ui.close}>
                <IconClose size={20} />
              </button>
            </span>
          </div>
          <span className="small muted">{ui.context.label}. Nothing changes until you tap Apply.</span>
        </div>

        <div className="chat-body" ref={scroller} aria-live="polite">
          {msgs.length === 0 && !thinking && (
            <div className="bubble-ai card" style={{ padding: '14px 16px', lineHeight: 1.45 }}>
              Tell me what happened or ask about anything at home: stock, recipes, the plan, the shopping list
              or money. You can also scan a receipt with the camera button or paste a recipe link. I prepare
              the change and you decide whether to apply it.
            </div>
          )}
          {msgs.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className="bubble-user">
                {m.photos ? <span className="receipt-thumb" aria-hidden /> : null}
                <span style={{ overflowWrap: 'anywhere' }}>{m.text}</span>
              </div>
            ) : (
              <div key={m.id} className="stack" style={{ alignSelf: 'flex-start', maxWidth: '92%', gap: 8 }}>
                <div className={`bubble-ai${m.tone === 'error' ? ' error' : ''}`}>{m.text}</div>
                {m.raw && (
                  <details className="note small">
                    <summary>What Gemini answered</summary>
                    <pre
                      style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0', fontFamily: 'var(--font-mono)' }}
                    >
                      {m.raw}
                    </pre>
                  </details>
                )}
                {m.cards?.map((c) => (
                  <CardView
                    key={c.id}
                    card={c}
                    onApply={() => void apply(m, c)}
                    onEdit={() => edit(m, c)}
                    onCancel={() => setCard(m.id, c.id, { status: 'cancelled' })}
                    onUndo={() => void undo(m, c)}
                    onOpen={go}
                  />
                ))}
                {m.links && (
                  <div className="wrap" style={{ gap: 6 }}>
                    {m.links.map((l) => (
                      <button
                        key={l.to + l.label}
                        type="button"
                        className="chip chip-sm chip-soft"
                        onClick={() => go(l)}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}
          {thinking && (
            <div className="bubble-ai muted" role="status">
              {thinking}
            </div>
          )}
        </div>

        <div className="chat-foot">
          <div className="hscroll" style={{ gap: 6 }}>
            <button type="button" className="sugg" onClick={() => camera.current?.click()}>
              Scan a receipt
            </button>
            <button
              type="button"
              className="sugg"
              onClick={() => {
                push({
                  role: 'assistant',
                  text: 'Paste the link to a recipe page. I’ll read it, match the ingredients to your items and write clear steps, then you decide whether to save it.',
                });
                inputRef.current?.focus();
              }}
            >
              Import a recipe from a link
            </button>
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                className="sugg"
                onClick={() => void send(c)}
                disabled={!!thinking}
              >
                {c}
              </button>
            ))}
          </div>
          {(photos.length > 0 || preparing) && (
            <div className="photo-tray">
              {photos.map((p, i) => (
                <PhotoThumb
                  key={i}
                  photo={p}
                  onRemove={() => setPhotos((x) => x.filter((_, j) => j !== i))}
                />
              ))}
              {preparing && <span className="small muted">Preparing the photo…</span>}
              <span className="stack" style={{ gap: 4 }}>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => camera.current?.click()}
                >
                  Add another part
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => gallery.current?.click()}
                >
                  From gallery
                </button>
              </span>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={preparing || !!thinking}
                onClick={() => void send()}
              >
                Read receipt
              </button>
            </div>
          )}
          {speech.listening && (
            <div className="row bold small" style={{ color: 'var(--red)' }}>
              <span className="pulse-dot" />
              Listening. Tap the microphone when you're done.
            </div>
          )}
          {speech.error && <div className="small danger-text">{speech.error}</div>}
          {textImport && <div className="small text-cobalt bold">Paste the recipe text and tap send.</div>}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <button
              type="button"
              className="round-btn"
              aria-label="Scan a receipt"
              onClick={() => camera.current?.click()}
            >
              <IconCamera />
            </button>
            <button
              type="button"
              className={`round-btn${speech.listening ? ' live' : ''}`}
              aria-label={speech.listening ? 'Stop listening' : 'Speak your message'}
              aria-pressed={speech.listening}
              onClick={() => (speech.listening ? speech.stop() : speech.start(input))}
            >
              <IconMic />
            </button>
            <input
              ref={inputRef}
              className="chat-input"
              aria-label="Message the assistant"
              placeholder={
                textImport
                  ? 'Paste the recipe here'
                  : photos.length
                    ? 'Who paid? Optional'
                    : 'Type, talk or paste a link'
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              enterKeyHint="send"
            />
            <button
              type="submit"
              className="round-btn send"
              aria-label="Send"
              disabled={!!thinking || (!input.trim() && !photos.length)}
            >
              <IconSend />
            </button>
          </form>
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void addPhotos(e.target.files).then(() => (e.target.value = ''))}
          />
          <input
            ref={gallery}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(e) => void addPhotos(e.target.files).then(() => (e.target.value = ''))}
          />
        </div>
      </div>
    </div>,
    document.getElementById('app-frame') ?? document.body,
  );
}

function PhotoThumb({ photo, onRemove }: { photo: CompressedPhoto; onRemove?: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const u = URL.createObjectURL(photo.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [photo]);
  return (
    <span className="tray-photo">
      {url && <img src={url} alt="Receipt photo" />}
      {onRemove && (
        <button type="button" aria-label="Remove this photo" onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  );
}

function CardView({
  card,
  onApply,
  onEdit,
  onCancel,
  onUndo,
  onOpen,
}: {
  card: Card;
  onApply: () => void;
  onEdit: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onOpen: (l: Link) => void;
}) {
  const pending = card.status === 'pending';
  return (
    <div className={`action-card${pending ? ' pending' : ''}${card.danger ? ' danger' : ''}`}>
      <span className="bold" style={{ fontSize: 17 }}>
        {card.title}
      </span>
      <div className="stack" style={{ gap: 4 }}>
        {card.lines.map((l, i) => (
          <span key={i} className="card-line">
            {l}
          </span>
        ))}
      </div>
      {card.refreshed && pending && (
        <span className="small bold" style={{ color: 'var(--saffron-ink)' }}>
          Updated: the data changed since I first prepared this.
        </span>
      )}
      {pending ? (
        <>
          {card.blocked && <span className="small bold danger-text">{card.blocked}</span>}
          <div className="wrap" style={{ gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className={`btn btn-md ${card.danger ? 'btn-danger' : 'btn-primary'}`}
              data-armed={card.armed}
              disabled={!!card.blocked}
              onClick={onApply}
              style={{ height: 44, fontSize: 15 }}
            >
              {card.armed ? 'Tap again to apply' : 'Apply'}
            </button>
            {card.edit && (
              <button
                type="button"
                className="btn btn-outline btn-md"
                onClick={onEdit}
                style={{ height: 44, fontSize: 15 }}
              >
                Edit
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-md"
              onClick={onCancel}
              style={{ height: 44, fontSize: 15, color: 'var(--muted)' }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="row-between">
          <span
            className="small bold"
            style={{ color: card.status === 'applied' ? 'var(--cobalt)' : 'var(--muted)' }}
          >
            {card.status === 'applied'
              ? 'Applied. Marked “via Assistant” in your history.'
              : card.status === 'undone'
                ? 'Undone. Everything is back as it was.'
                : (card.note ?? 'Cancelled. Nothing was changed.')}
          </span>
          {card.status === 'applied' && (
            <span className="row" style={{ gap: 6 }}>
              {card.openAfter && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  style={{ borderWidth: 1 }}
                  onClick={() => onOpen(card.openAfter!)}
                >
                  {card.openAfter.label}
                </button>
              )}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ borderWidth: 1 }}
                onClick={onUndo}
              >
                Undo
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Opens the normal form for a card's Edit (the person saves it themselves). */
function EditHost({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const store = useStore();
  const { run } = useRun();
  const nav = useNavigate();
  const me = useMe();
  if (editing.kind === 'receipt' || (editing.kind === 'purchase' && editing.draft.source === 'receipt')) {
    const photos = editing.kind === 'receipt' ? editing.photos : [];
    const draft = editing.draft;
    return (
      <PurchaseEditor
        initial={draft}
        title="Check the receipt"
        header={photos.length ? <ReceiptHeader photos={photos} /> : undefined}
        saveLabel={(t) => `Save ${t} and update stock`}
        onClose={onClose}
        submit={async (d) => {
          if (!me) return null;
          const ctx = await buildCtx(store, me);
          const ids = await uploadReceiptPhotos(store, d, photos);
          const r = await run('addPurchase', receiptInput(d, ctx, ids), {
            toast: `Receipt from ${d.store} saved`,
          });
          if (!r) await deleteReceiptPhotos(store, ids);
          return r;
        }}
        onSaved={() => nav('/budget')}
      />
    );
  }
  if (editing.kind === 'purchase')
    return <PurchaseEditor initial={editing.draft} onClose={onClose} onSaved={() => nav('/budget')} />;
  if (editing.kind === 'contribution')
    return <MoneySheet prefill={editing.prefill} onClose={onClose} onSaved={() => nav('/budget')} />;
  if (editing.kind === 'item') return <ItemEditor itemId={editing.itemId} onClose={onClose} />;
  return (
    <RecipeEditor
      initial={editing.initial}
      heading="Check the recipe"
      onClose={onClose}
      onSaved={(id) => id && nav(`/recipes/${id}`)}
    />
  );
}

function ReceiptHeader({ photos }: { photos: CompressedPhoto[] }) {
  return (
    <div className="hscroll" style={{ gap: 8 }}>
      {photos.map((p, i) => (
        <PhotoThumb key={i} photo={p} />
      ))}
      <span className="small muted" style={{ alignSelf: 'center' }}>
        Saved without location data.
      </span>
    </div>
  );
}

/** addPurchase input -> form draft (for Edit on a purchase card). */
function inputToDraft(input: unknown, source: 'manual' | 'receipt'): PurchaseDraft {
  const i = input as {
    store: string;
    date: string;
    time?: string;
    spentBy: string;
    purpose?: string;
    total?: number;
    lines: {
      id?: string;
      rawText?: string;
      itemId?: string;
      name: string;
      quantity: number;
      unit: never;
      price: number;
      category: string;
      subcategory: string;
      toStock?: boolean;
      note?: string;
    }[];
  };
  return {
    store: i.store,
    date: i.date,
    time: i.time,
    spentBy: i.spentBy,
    purpose: i.purpose ?? '',
    source,
    printedTotal: source === 'receipt' ? i.total : undefined,
    lines: i.lines.map((l) => ({
      id: l.id ?? uid(),
      rawText: l.rawText,
      itemId: l.itemId,
      name: l.name,
      quantity: num(l.quantity, 3),
      unit: l.unit,
      price: num(l.price),
      category: l.category || undefined,
      subcategory: l.subcategory || undefined,
      auto: false,
      toStock: !!l.toStock,
      note: l.note,
    })),
  };
}

/** The recipe a recipe card created (its undo op removes that id), for the card's "Open …" button. */
function createdRecipe(card: Card, inverse: Op[]): { id: string; title: string } | null {
  if (card.kind !== 'recipe') return null;
  const rm = inverse.find((o) => o.t === 'remove' && o.file === 'recipes');
  const title = (card.steps[0].input as { title?: string }).title ?? 'the recipe';
  return rm && rm.t === 'remove' ? { id: rm.id, title } : null;
}
