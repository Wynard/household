import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FullScreen } from '../../ui/Sheet';
import { BackButton, DecimalInput } from '../../ui/controls';
import { IconCheck, IconClose, IconTimer } from '../../ui/icons';
import { useRun, useSnapshot } from '../../app/data';
import { useToast } from '../../ui/Toast';
import { availability, deductionsFor } from '../../domain/recipes';
import { num, parseDecimal, qty as fmtQty, round3 } from '../../domain/format';
import type { Recipe } from '../../domain/schemas';
import { amountText } from './RecipeDetail';

interface Timer {
  /** seconds left when paused / not started */
  left: number;
  /** epoch ms when it will finish while running */
  endsAt?: number;
  done?: boolean;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Short three-beep chime made with Web Audio (no sound files). */
function chime() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.35, 0.7].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    /* no audio */
  }
}

/** Keeps the screen on while cooking (Screen Wake Lock API), re-acquiring after tab switches. */
function useWakeLock() {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let alive = true;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible')
          lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed or not supported */
      }
    };
    void acquire();
    const onVis = () => alive && document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

export function CookingMode({
  recipe,
  servings,
  planEntryId,
  startAtFinish,
  onClose,
}: {
  recipe: Recipe;
  servings: number;
  planEntryId?: string;
  /** open straight on the stock-deduction confirmation (marking a planned meal cooked) */
  startAtFinish?: boolean;
  onClose: () => void;
}) {
  useWakeLock();
  const toast = useToast();
  const steps = recipe.steps;
  const [current, setCurrent] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const [finishing, setFinishing] = useState(!!startAtFinish);
  const [timers, setTimers] = useState<Record<string, Timer>>({});
  const [, tick] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const { snap } = useSnapshot();
  const items = useMemo(() => snap?.items.items ?? [], [snap]);

  // amounts per ingredient, scaled
  const rows = useMemo(() => availability(recipe, servings, items).rows, [recipe, servings, items]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.ingredient.id, r])), [rows]);

  // one ticking interval drives every running timer
  const anyRunning = Object.values(timers).some((t) => t.endsAt);
  useEffect(() => {
    if (!anyRunning) return;
    const h = setInterval(() => {
      const now = Date.now();
      let finished: string[] = [];
      setTimers((T) => {
        const next = { ...T };
        finished = [];
        for (const [k, t] of Object.entries(T)) {
          if (t.endsAt && t.endsAt <= now) {
            next[k] = { left: 0, done: true };
            finished.push(k);
          }
        }
        return finished.length ? next : T;
      });
      if (finished.length) {
        const n = finished.map((k) => steps.findIndex((s) => s.id === k) + 1).join(' and ');
        toast.show(`Timer for step ${n} is done`, { ms: 8000 });
        navigator.vibrate?.([300, 120, 300, 120, 300]);
        chime();
      }
      tick((x) => x + 1);
    }, 250);
    return () => clearInterval(h);
  }, [anyRunning, steps, toast]);

  const leftOf = (id: string, total: number) => {
    const t = timers[id];
    if (!t) return total;
    if (t.endsAt) return Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000));
    return t.left;
  };

  const toggleTimer = (id: string, total: number) =>
    setTimers((T) => {
      const t = T[id];
      if (!t || t.done) return { ...T, [id]: { left: total, endsAt: Date.now() + total * 1000 } };
      if (t.endsAt) return { ...T, [id]: { left: Math.max(0, Math.ceil((t.endsAt - Date.now()) / 1000)) } };
      return { ...T, [id]: { left: t.left, endsAt: Date.now() + t.left * 1000 } };
    });
  const restartTimer = (id: string, total: number) =>
    setTimers((T) => ({ ...T, [id]: { left: total, endsAt: Date.now() + total * 1000 } }));

  const nextOpen = useCallback(
    (d: Set<number>, from: number) => {
      for (let j = 0; j < steps.length; j++) {
        const k = (from + j) % steps.length;
        if (!d.has(k)) return k;
      }
      return from;
    },
    [steps.length],
  );

  // keep the current step in view
  useEffect(() => {
    if (finishing) return;
    refs.current[current]?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
  }, [current, finishing]);

  const toggleDone = (i: number) => {
    const d = new Set(done);
    if (d.has(i)) {
      d.delete(i);
      setDone(d);
      setCurrent(i);
    } else {
      d.add(i);
      setDone(d);
      setCurrent(nextOpen(d, i));
    }
  };
  const allDone = done.size === steps.length;

  if (finishing)
    return (
      <FinishCooking
        recipe={recipe}
        servings={servings}
        planEntryId={planEntryId}
        onBack={startAtFinish ? undefined : () => setFinishing(false)}
        onClose={onClose}
      />
    );

  return (
    <FullScreen z={35} rim={false} bg="var(--surface)" label={`Cooking ${recipe.title}`}>
      <div
        className="cook-progress"
        role="progressbar"
        aria-label="Steps done"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={done.size}
      >
        <div style={{ width: `${steps.length ? Math.round((done.size / steps.length) * 100) : 0}%` }} />
      </div>
      <div className="row-between" style={{ padding: '8px 12px 0 20px' }}>
        <span className="bold muted" style={{ fontSize: 15 }}>
          {recipe.title}
        </span>
        <button type="button" className="icon-btn" aria-label="Exit cooking mode" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="full-body" style={{ padding: '8px 16px 20px', gap: 10 }}>
        <p className="muted" style={{ margin: '0 4px 4px', fontSize: 15 }}>
          {done.size} of {steps.length} steps done. Serves {servings}.
        </p>
        {steps.map((st, i) => {
          const isDone = done.has(i);
          const active = current === i && !isDone;
          const total = st.timerSeconds ?? 0;
          const left = leftOf(st.id, total);
          const t = timers[st.id];
          const running = !!t?.endsAt;
          const ended = !!t?.done;
          const ings = (st.ingredientIds ?? []).map((id) => rowById.get(id)).filter((r) => !!r);
          return (
            <div
              key={st.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={`cook-step${active ? ' active' : ''}${isDone ? ' done' : ''}`}
            >
              <button
                type="button"
                className="cook-num"
                aria-pressed={isDone}
                aria-label={isDone ? `Mark step ${i + 1} as not done` : `Mark step ${i + 1} as done`}
                onClick={() => toggleDone(i)}
              >
                {isDone ? <IconCheck size={20} /> : i + 1}
              </button>
              <div className="grow stack" style={{ gap: 10 }}>
                <button
                  type="button"
                  className="cook-text"
                  onClick={() => setCurrent(i)}
                  aria-current={active ? 'step' : undefined}
                >
                  {st.text}
                </button>
                {ings.length > 0 && (
                  <div className="wrap" style={{ gap: 6 }}>
                    {ings.map((r) => (
                      <span
                        key={r.ingredient.id}
                        className="tag tag-cobalt"
                        style={{ padding: '4px 10px', borderRadius: 9, fontSize: 15 }}
                      >
                        {[amountText(r), r.ingredient.name].filter(Boolean).join(' ')}
                      </span>
                    ))}
                  </div>
                )}
                {total > 0 && (
                  <div className={`cook-timer${running ? ' running' : ''}${ended ? ' ended' : ''}`}>
                    <span className="cook-time" aria-live={ended ? 'assertive' : 'off'}>
                      <IconTimer />
                      {fmt(left)}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {t && !ended && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => restartTimer(st.id, total)}
                        >
                          Restart
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-primary btn-md"
                        onClick={() => toggleTimer(st.id, total)}
                      >
                        {running ? 'Pause' : ended ? 'Restart' : t ? 'Resume' : 'Start'}
                      </button>
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="full-foot" style={{ flexDirection: 'row', gap: 10 }}>
        {allDone ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            style={{ height: 58, fontSize: 18 }}
            onClick={() => setFinishing(true)}
          >
            Finish cooking
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-outline"
              style={{ height: 58, flex: 1, fontSize: 17 }}
              onClick={() => setFinishing(true)}
            >
              Finish
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ height: 58, flex: 2, fontSize: 18 }}
              onClick={() => {
                const d = new Set(done).add(current);
                setDone(d);
                setCurrent(nextOpen(d, current));
              }}
            >
              Step {current + 1} done
            </button>
          </>
        )}
      </div>
    </FullScreen>
  );
}

/** "Enjoy! Take these out of stock?" with an editable list, then applies it. */
export function FinishCooking({
  recipe,
  servings,
  planEntryId,
  onBack,
  onClose,
}: {
  recipe: Recipe;
  servings: number;
  planEntryId?: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const items = useMemo(() => snap?.items.items ?? [], [snap]);
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(deductionsFor(recipe, servings, items).map((d) => [d.itemId, num(d.amount, 3)])),
  );
  const [busy, setBusy] = useState(false);
  const entries = Object.entries(amounts);
  const bad = entries.some(([, v]) => v.trim() !== '' && !(parseDecimal(v) >= 0));

  const apply = async (withStock: boolean) => {
    setBusy(true);
    const deductions = withStock
      ? entries
          .map(([itemId, v]) => ({ itemId, amount: v.trim() ? parseDecimal(v) : 0 }))
          .filter((d) => d.amount > 0)
      : [];
    const res = await run(
      'cookRecipe',
      { recipeId: recipe.id, servings, deductions, planEntryId },
      {
        toast: (p) => {
          const added = p.ops.filter((o) => o.file === 'shopping' && o.t === 'upsert').length;
          return withStock
            ? `Stock updated${added ? `. ${added} running low, added to the shopping list` : ''}`
            : 'Marked as cooked';
        },
      },
    );
    setBusy(false);
    if (res) onClose();
  };

  return (
    <FullScreen z={36} rim={false} bg="var(--surface)" label="Finish cooking">
      <div className="full-body" style={{ padding: '16px 24px' }}>
        {onBack && <BackButton label="Back to the steps" onClick={onBack} />}
        <h2 className="display" style={{ margin: 0, fontSize: 28, lineHeight: 1.15 }}>
          Enjoy! Take these out of stock?
        </h2>
        {entries.length ? (
          <div className="list" style={{ background: 'var(--surface-2)' }}>
            {entries.map(([itemId, v]) => {
              const it = items.find((i) => i.id === itemId);
              if (!it) return null;
              const a = v.trim() ? parseDecimal(v) : 0;
              return (
                <div key={itemId} className="row" style={{ gap: 10, padding: '10px 12px 10px 16px' }}>
                  <span className="grow stack" style={{ gap: 0 }}>
                    <span className="bold">{it.name}</span>
                    <span className="small muted">
                      {a >= 0
                        ? `${fmtQty(Math.max(0, round3(it.quantity - a)), it.unit)} left`
                        : 'Enter a number'}
                    </span>
                  </span>
                  <label className="row" style={{ gap: 6 }}>
                    <span className="sr-only">Amount of {it.name} used</span>
                    <DecimalInput
                      className="input input-sm"
                      style={{ width: 84, textAlign: 'right' }}
                      value={v}
                      onChange={(e) => setAmounts((x) => ({ ...x, [itemId]: e.target.value }))}
                    />
                    <span className="small muted" style={{ width: 28 }}>
                      {it.unit}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted">None of the ingredients are tracked in stock, so nothing changes.</p>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Change an amount if you used more or less. Set it to 0 to leave that item alone.
        </p>
      </div>
      <div
        className="stack"
        style={{ padding: '12px 20px calc(16px + env(safe-area-inset-bottom))', gap: 8 }}
      >
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ fontSize: 18 }}
          disabled={busy || bad}
          onClick={() => void apply(true)}
        >
          {entries.length ? 'Update stock' : 'Mark as cooked'}
        </button>
        {entries.length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-md"
            disabled={busy}
            onClick={() => void apply(false)}
          >
            Leave stock as it is
          </button>
        )}
      </div>
    </FullScreen>
  );
}
