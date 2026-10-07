import { useMemo, useState } from 'react';
import { FullScreen } from '../../ui/Sheet';
import { DecimalInput, DeleteButton, Field } from '../../ui/controls';
import { IconClose } from '../../ui/icons';
import { useRun, useSnapshot } from '../../app/data';
import { useToast } from '../../ui/Toast';
import { normalise } from '../../domain/categorise';
import { num, parseDecimal, qty as fmtQty } from '../../domain/format';
import { detectTimerSeconds, totalMinutes } from '../../domain/recipes';
import { isStockUnit } from '../../domain/units';
import type { Ingredient, Item, Recipe, Unit } from '../../domain/schemas';
import { ItemEditor } from '../stock/ItemEditor';

type StepDraft = { id: string; text: string; timer: string };
interface Draft {
  title: string;
  minutes: string;
  servings: string;
  favourite: boolean;
  categories: string[];
  sourceUrl?: string;
  notes?: string;
  ingredients: Ingredient[];
  steps: StepDraft[];
}

const uid = () => crypto.randomUUID();

function toDraft(r?: Partial<Recipe>): Draft {
  return {
    title: r?.title ?? '',
    minutes:
      r && totalMinutes({ prepMinutes: r.prepMinutes, cookMinutes: r.cookMinutes })
        ? String(totalMinutes({ prepMinutes: r.prepMinutes, cookMinutes: r.cookMinutes }))
        : '',
    servings: String(r?.servings ?? 2),
    favourite: r?.favourite ?? false,
    categories: r?.categories ?? [],
    sourceUrl: r?.sourceUrl,
    notes: r?.notes,
    ingredients: r?.ingredients?.map((g) => ({ ...g })) ?? [],
    steps: r?.steps?.length
      ? r.steps.map((s) => ({
          id: s.id,
          text: s.text,
          timer: s.timerSeconds ? num(s.timerSeconds / 60, 1) : '',
        }))
      : [{ id: uid(), text: '', timer: '' }],
  };
}

function ingredientLabel(g: Ingredient, item?: Item) {
  if (g.amount !== undefined && g.unit)
    return `${isStockUnit(g.unit) ? fmtQty(g.amount, g.unit) : `${num(g.amount)} ${g.unit}`} ${g.name}`;
  if (g.amount !== undefined && item) return `${fmtQty(g.amount, item.unit)} ${g.name}`;
  return g.name;
}

/**
 * Full-screen recipe editor (6.2). Used for "Write a recipe", "Edit recipe",
 * reviewing an import, and Settings › Recipes.
 */
export function RecipeEditor({
  recipeId,
  initial,
  heading,
  onClose,
  onSaved,
}: {
  recipeId?: string;
  /** prefilled draft (e.g. from an import) */
  initial?: Partial<Recipe>;
  heading?: string;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const toast = useToast();
  const existing = recipeId ? snap?.recipes.recipes.find((r) => r.id === recipeId) : undefined;
  const [d, setD] = useState<Draft>(() => toDraft(existing ?? initial));
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Item | null>(null);
  const [amount, setAmount] = useState('');
  const [replacing, setReplacing] = useState<string | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [creatingItem, setCreatingItem] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // "Track exact amounts of X?" for ingredients linked to simple items
  const [keptSimple, setKeptSimple] = useState<Set<string>>(new Set());
  const [tracking, setTracking] = useState<{ itemId: string; unit: Unit; qty: string } | null>(null);
  const upd = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const items = useMemo(() => snap?.items.items.filter((i) => !i.archived) ?? [], [snap]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const cats = [...new Set([...(snap?.household.recipeCategories ?? []), ...d.categories])];

  const q = normalise(query);
  const sugg = useMemo(
    () =>
      !picked && q
        ? items
            .filter((i) => normalise(i.name).includes(q) || i.aliases.some((a) => normalise(a).includes(q)))
            .sort((a, b) => Number(normalise(b.name).startsWith(q)) - Number(normalise(a.name).startsWith(q)))
            .slice(0, 6)
        : [],
    [items, q, picked],
  );

  const servings = parseInt(d.servings, 10);
  const minutes = d.minutes.trim() ? parseInt(d.minutes, 10) : 0;
  const filledSteps = d.steps.filter((s) => s.text.trim());
  const problem = !d.title.trim()
    ? 'Add a title'
    : !d.ingredients.length
      ? 'Add at least one ingredient'
      : !filledSteps.length
        ? 'Write at least one step'
        : !(servings > 0)
          ? 'Enter how many it serves'
          : Number.isNaN(minutes) || minutes < 0
            ? 'Enter the minutes as a number'
            : d.steps.some((s) => s.timer.trim() && !(parseDecimal(s.timer) > 0))
              ? 'Timers are in minutes, e.g. 10'
              : null;

  const putIngredient = (g: Ingredient) => {
    upd({
      ingredients: replacing
        ? d.ingredients.map((x) => (x.id === replacing ? { ...g, id: x.id } : x))
        : [...d.ingredients, g],
    });
    setQuery('');
    setPicked(null);
    setAmount('');
    setReplacing(null);
  };

  const addPicked = () => {
    if (!picked) return;
    const a = amount.trim() ? parseDecimal(amount) : NaN;
    if (amount.trim() && !(a > 0)) {
      toast.show(`Enter how much ${picked.name.toLowerCase()} the recipe uses`);
      return;
    }
    const old = replacing ? d.ingredients.find((g) => g.id === replacing) : undefined;
    putIngredient({
      id: uid(),
      itemId: picked.id,
      name: old?.name ?? picked.name.toLowerCase(),
      ...(a > 0 ? { amount: a, unit: picked.unit } : {}),
      ...(old?.optional ? { optional: true } : {}),
    });
  };

  /** Unit to suggest when switching a simple item to amounts: the recipe's unit if stock can hold it. */
  const suggestUnit = (g: Ingredient, item: Item): Unit =>
    g.unit && isStockUnit(g.unit) ? g.unit : item.unit === 'pcs' && g.amount === undefined ? 'g' : item.unit;

  const trackAmounts = async () => {
    if (!tracking) return;
    const item = byId.get(tracking.itemId);
    const q = parseDecimal(tracking.qty);
    if (!item || !(q >= 0) || !tracking.qty.trim()) {
      toast.show('Enter how much is in the house now');
      return;
    }
    const res = await run(
      'upsertItem',
      { ...item, tracking: 'amount', unit: tracking.unit, quantity: q },
      { toast: `${item.name} is now tracked in ${tracking.unit}` },
    );
    if (res) setTracking(null);
  };

  const save = async () => {
    setTried(true);
    if (problem) return;
    const res = await run(
      'upsertRecipe',
      {
        id: existing?.id,
        title: d.title.trim(),
        servings,
        favourite: d.favourite,
        categories: d.categories,
        ...(d.sourceUrl ? { sourceUrl: d.sourceUrl } : {}),
        ...(d.notes ? { notes: d.notes } : {}),
        ...(minutes ? { cookMinutes: minutes } : {}),
        ingredients: d.ingredients,
        steps: filledSteps.map((s) => {
          const t = parseDecimal(s.timer);
          return { id: s.id, text: s.text.trim(), ...(t > 0 ? { timerSeconds: Math.round(t * 60) } : {}) };
        }),
      },
      { toast: existing ? `${d.title.trim()} saved` : `${d.title.trim()} added to your recipes` },
    );
    if (res) {
      onSaved?.(res.plan.result as string);
      onClose();
    }
  };

  return (
    <FullScreen z={45} label={existing ? 'Edit recipe' : 'New recipe'}>
      <div className="full-head">
        <h1 className="h1-sm">{heading ?? (existing ? 'Edit recipe' : 'New recipe')}</h1>
        <button type="button" className="icon-btn" aria-label="Close without saving" onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <div className="full-body">
        <div className="card card-pad stack-lg" style={{ gap: 12 }}>
          <Field label="Title">
            <input
              className="input"
              placeholder="e.g. Ciorbă de perișoare"
              value={d.title}
              onChange={(e) => upd({ title: e.target.value })}
            />
          </Field>
          <div className="grid-2" style={{ gap: 10 }}>
            <Field label="Minutes">
              <input
                className="input"
                inputMode="numeric"
                placeholder="30"
                value={d.minutes}
                onChange={(e) => upd({ minutes: e.target.value })}
              />
            </Field>
            <Field label="Serves">
              <input
                className="input"
                inputMode="numeric"
                value={d.servings}
                onChange={(e) => upd({ servings: e.target.value })}
              />
            </Field>
          </div>
          <div className="stack-sm">
            <span className="bold" style={{ fontSize: 15 }}>
              Categories
            </span>
            <div className="wrap">
              {cats.map((c) => {
                const on = d.categories.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() =>
                      upd({ categories: on ? d.categories.filter((x) => x !== c) : [...d.categories, c] })
                    }
                  >
                    {c}
                  </button>
                );
              })}
              {newCat === null ? (
                <button type="button" className="chip chip-dashed" onClick={() => setNewCat('')}>
                  New category
                </button>
              ) : (
                <form
                  className="row"
                  style={{ width: '100%' }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = newCat.trim();
                    if (n && !d.categories.includes(n)) upd({ categories: [...d.categories, n] });
                    setNewCat(null);
                  }}
                >
                  <input
                    className="input grow"
                    autoFocus
                    aria-label="New category name"
                    placeholder="New category, e.g. Mexican"
                    value={newCat}
                    onChange={(e) => setNewCat(e.target.value)}
                  />
                  <button type="submit" className="btn btn-outline btn-md">
                    Add
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>

        <h2 className="h2" style={{ margin: '4px 0 0' }}>
          Ingredients
        </h2>
        {d.ingredients.length > 0 && (
          <div className="list">
            {d.ingredients.map((g) => {
              const item = g.itemId ? byId.get(g.itemId) : undefined;
              const untracked = !g.pantryStaple && !item;
              return (
                <div
                  key={g.id}
                  className="stack"
                  style={{
                    gap: 6,
                    padding: '10px 6px 10px 16px',
                    background: replacing === g.id ? 'var(--cobalt-wash)' : undefined,
                  }}
                >
                  <div className="row">
                    <span className="grow stack" style={{ gap: 0 }}>
                      <span className="bold">{ingredientLabel(g, item)}</span>
                      <span className="small muted">
                        {g.pantryStaple
                          ? 'Pantry staple, not checked against stock'
                          : item
                            ? `Linked to ${item.name}`
                            : g.itemId
                              ? 'Linked to a deleted item. Match it again.'
                              : 'Not tracked'}
                        {g.optional ? ', optional' : ''}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="icon-btn muted"
                      aria-label={`Remove ${g.name}`}
                      onClick={() => upd({ ingredients: d.ingredients.filter((x) => x.id !== g.id) })}
                    >
                      <IconClose size={18} />
                    </button>
                  </div>
                  {item && item.tracking === 'simple' && !keptSimple.has(item.id) && (
                    <div className="track-ask stack" style={{ gap: 8 }}>
                      {tracking?.itemId === item.id ? (
                        <>
                          <span className="small bold">
                            How much {item.name.toLowerCase()} is in the house now?
                          </span>
                          <div className="row" style={{ gap: 8 }}>
                            <DecimalInput
                              className="input input-sm"
                              aria-label={`${item.name} in the house, in ${tracking.unit}`}
                              style={{ width: 96 }}
                              autoFocus
                              value={tracking.qty}
                              onChange={(e) => setTracking({ ...tracking, qty: e.target.value })}
                            />
                            <span className="small muted">{tracking.unit}</span>
                            <span className="grow" />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => setTracking(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => void trackAmounts()}
                            >
                              Save
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="small">
                            Track exact amounts of {item.name.toLowerCase()}? Then cooking takes it out of
                            stock. Simple items count as there when Have or Low.
                          </span>
                          <div className="wrap" style={{ gap: 6 }}>
                            <button
                              type="button"
                              className="chip chip-sm chip-soft"
                              onClick={() =>
                                setTracking({ itemId: item.id, unit: suggestUnit(g, item), qty: '' })
                              }
                            >
                              Track in {suggestUnit(g, item)}
                            </button>
                            <button
                              type="button"
                              className="chip chip-sm"
                              onClick={() => setKeptSimple((x) => new Set(x).add(item.id))}
                            >
                              Keep simple
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {untracked && (
                    <div className="wrap" style={{ gap: 6 }}>
                      <button
                        type="button"
                        className="chip chip-sm chip-soft"
                        onClick={() => {
                          setReplacing(g.id);
                          setQuery(g.name);
                          setPicked(null);
                        }}
                      >
                        Match to an item
                      </button>
                      <button type="button" className="chip chip-sm" onClick={() => setCreatingItem(g.name)}>
                        Create new item
                      </button>
                      <button
                        type="button"
                        className="chip chip-sm"
                        onClick={() =>
                          upd({
                            ingredients: d.ingredients.map((x) =>
                              x.id === g.id ? { ...x, pantryStaple: true, itemId: undefined } : x,
                            ),
                          })
                        }
                      >
                        Mark as staple
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="dashed stack" style={{ gap: 10 }}>
          <span className="bold">
            {replacing
              ? `Match “${d.ingredients.find((g) => g.id === replacing)?.name}” to one of your items`
              : 'Add an ingredient'}
          </span>
          <input
            className="input"
            aria-label="Find an item"
            placeholder="Start typing, e.g. flour"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
          />
          {sugg.length > 0 && (
            <div className="wrap" style={{ gap: 6 }}>
              {sugg.map((i) => (
                <button
                  key={i.id}
                  type="button"
                  className="chip chip-soft"
                  onClick={() => {
                    setPicked(i);
                    setQuery(i.name);
                  }}
                >
                  {i.name} ({i.unit})
                </button>
              ))}
            </div>
          )}
          {picked && (
            <form
              className="row"
              style={{ alignItems: 'flex-end' }}
              onSubmit={(e) => {
                e.preventDefault();
                addPicked();
              }}
            >
              <label className="field grow">
                How much {picked.name.toLowerCase()}, in {picked.unit}
                <DecimalInput
                  autoFocus
                  placeholder={picked.unit === 'pcs' ? '2' : '250'}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
              <button type="submit" className="btn btn-ink btn-md">
                Add
              </button>
            </form>
          )}
          {!!q && !picked && (
            <div className="stack-sm">
              <button
                type="button"
                className="note"
                style={{ textAlign: 'left', border: '1px solid var(--line)', fontWeight: 700, minHeight: 44 }}
                onClick={() => putIngredient({ id: uid(), name: query.trim(), pantryStaple: true })}
              >
                Add “{query.trim()}” as a pantry staple (not tracked)
              </button>
              <button
                type="button"
                className="link-btn"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setCreatingItem(query.trim())}
              >
                Create “{query.trim()}” as a new item
              </button>
            </div>
          )}
          {replacing && (
            <button
              type="button"
              className="link-btn"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setReplacing(null);
                setQuery('');
                setPicked(null);
              }}
            >
              Cancel matching
            </button>
          )}
          <span className="small muted">
            Ingredients linked to your items are checked against stock. Staples like salt and oil aren't.
          </span>
        </div>

        <h2 className="h2" style={{ margin: '4px 0 0' }}>
          Steps
        </h2>
        {d.steps.map((s, i) => (
          <div key={s.id} className="card step-edit">
            <span className="step-num-sm">{i + 1}</span>
            <div className="grow stack-sm" style={{ gap: 8 }}>
              <textarea
                className="textarea"
                rows={3}
                aria-label={`Step ${i + 1}`}
                placeholder="What to do in this step"
                value={s.text}
                onChange={(e) =>
                  upd({ steps: d.steps.map((x) => (x.id === s.id ? { ...x, text: e.target.value } : x)) })
                }
                onBlur={() => {
                  // suggest a timer from times written in the text
                  if (s.timer.trim()) return;
                  const secs = detectTimerSeconds(s.text);
                  if (secs)
                    upd({
                      steps: d.steps.map((x) => (x.id === s.id ? { ...x, timer: num(secs / 60, 1) } : x)),
                    });
                }}
              />
              <label className="row small muted" style={{ fontSize: 15 }}>
                Timer, minutes
                <DecimalInput
                  className="input input-sm"
                  style={{ width: 90 }}
                  placeholder="none"
                  value={s.timer}
                  onChange={(e) =>
                    upd({ steps: d.steps.map((x) => (x.id === s.id ? { ...x, timer: e.target.value } : x)) })
                  }
                />
              </label>
            </div>
            <button
              type="button"
              className="icon-btn muted"
              aria-label={`Remove step ${i + 1}`}
              onClick={() => upd({ steps: d.steps.filter((x) => x.id !== s.id) })}
            >
              <IconClose size={18} />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-dashed btn-md"
          onClick={() => upd({ steps: [...d.steps, { id: uid(), text: '', timer: '' }] })}
        >
          Add a step
        </button>
        {existing && (
          <DeleteButton
            label="Delete recipe"
            onDelete={async () => {
              if (await run('deleteRecipe', { id: existing.id }, { toast: `${existing.title} deleted` })) {
                onClose();
                onSaved?.('');
              }
            }}
          />
        )}
      </div>
      <div className="full-foot">
        {problem && (tried || d.title.trim()) && <span className="problem">{problem}</span>}
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          disabled={!!problem && tried}
          onClick={() => void save()}
        >
          {existing ? 'Save recipe' : 'Add recipe'}
        </button>
      </div>

      {creatingItem !== null && (
        <ItemEditor
          preset={{ name: creatingItem }}
          onClose={() => setCreatingItem(null)}
          onSaved={(id) => {
            // the new item isn't in the snapshot yet; link it by id, the unit comes with it on save
            setCreatingItem(null);
            const old = replacing ? d.ingredients.find((g) => g.id === replacing) : undefined;
            putIngredient({ id: uid(), itemId: id, name: old?.name ?? creatingItem.toLowerCase() });
            toast.show('Item created and linked. Add an amount by matching it again if you like.');
          }}
        />
      )}
    </FullScreen>
  );
}
