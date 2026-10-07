import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useRun, useSnapshot } from '../../app/data';
import { useScreenContext } from '../../app/assistantUi';
import { BackButton, EmptyState, Loading, Stepper } from '../../ui/controls';
import { IconBang, IconCheck } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { availability, totalMinutes, type IngredientRow } from '../../domain/recipes';
import { num, plural, qty as fmtQty } from '../../domain/format';
import { isStockUnit } from '../../domain/units';
import type { Recipe } from '../../domain/schemas';
import { StarButton } from './RecipesScreen';
import { RecipeEditor } from './RecipeEditor';
import { CookingMode } from './CookingMode';
import { AddToPlanSheet } from '../plan/AddToPlanSheet';

export function amountText(r: IngredientRow): string {
  if (r.need === undefined) return '';
  if (r.unit && isStockUnit(r.unit)) return fmtQty(r.need, r.unit);
  if (r.unit) return `${num(r.need)} ${r.unit}`;
  return r.item ? fmtQty(r.need, r.item.unit) : num(r.need);
}

function statusText(r: IngredientRow): { text: string; tone: 'ok' | 'warn' | 'bad' | 'muted' } {
  if (r.simple) {
    if (r.status === 'missing') return { text: 'Out, not in the house', tone: 'bad' };
    if (r.low) return { text: 'Running low, check there is enough', tone: 'warn' };
    return { text: 'You have it', tone: 'ok' };
  }
  switch (r.status) {
    case 'staple':
      return { text: 'Pantry staple, not tracked', tone: 'muted' };
    case 'untracked':
      return {
        text: r.item ? `Not tracked (can't compare with ${r.item.unit})` : 'Not tracked',
        tone: 'muted',
      };
    case 'have':
      return { text: `You have ${r.item ? fmtQty(r.have ?? 0, r.item.unit) : 'it'}`, tone: 'ok' };
    case 'partly':
      return {
        text: `You have ${fmtQty(r.have ?? 0, r.item!.unit)}, need ${fmtQty(r.short ?? 0, r.item!.unit)} more`,
        tone: 'bad',
      };
    case 'missing':
      return { text: r.short ? `Need ${fmtQty(r.short, r.item!.unit)}` : 'None in the house', tone: 'bad' };
  }
}

export function RecipeDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { snap } = useSnapshot();
  const recipe = snap?.recipes.recipes.find((r) => r.id === id);
  useScreenContext('recipe', `Looking at ${recipe?.title ?? 'a recipe'}`, recipe?.id);
  const [servings, setServings] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [cats, setCats] = useState(false);
  const [cooking, setCooking] = useState(false);
  const [planning, setPlanning] = useState(false);
  const { run } = useRun();

  const s = servings ?? recipe?.servings ?? 2;
  const av = useMemo(
    () => (recipe && snap ? availability(recipe, s, snap.items.items) : null),
    [recipe, snap, s],
  );

  if (!snap) return <Loading />;
  if (!recipe || !av)
    return (
      <>
        <BackButton label="Recipes" onClick={() => nav('/recipes')} />
        <EmptyState>This recipe isn't here any more. It may have been deleted.</EmptyState>
      </>
    );

  const missingRows = av.rows.filter(
    (r) => (r.status === 'missing' || r.status === 'partly') && !r.ingredient.optional && r.item,
  );
  const mins = totalMinutes(recipe);

  const addMissing = () =>
    void run(
      'addToShoppingList',
      {
        entries: missingRows.map((r) => ({
          itemId: r.item!.id,
          name: r.item!.name,
          ...(r.short ? { amount: r.short, unit: r.item!.unit } : {}),
        })),
        source: 'recipe',
        sourceRef: recipe.id,
      },
      { toast: (p) => String(p.result) },
    );

  return (
    <>
      <div className="row-between">
        <BackButton label="Recipes" onClick={() => nav('/recipes')} />
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setEditing(true)}>
            Edit recipe
          </button>
          <StarButton recipe={recipe} />
        </div>
      </div>
      <h1 className="h1" style={{ fontSize: 30, marginTop: 4 }}>
        {recipe.title}
      </h1>
      <p className="muted" style={{ margin: '6px 0 10px', fontSize: 15 }}>
        {mins ? `${mins} min, serves ${recipe.servings} as written` : `Serves ${recipe.servings} as written`}
      </p>
      <div className="wrap" style={{ gap: 6, marginBottom: 16, alignItems: 'center' }}>
        {recipe.categories.map((c) => (
          <span
            key={c}
            className="tag tag-cobalt"
            style={{ padding: '4px 10px', borderRadius: 8, fontSize: 14 }}
          >
            {c}
          </span>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          style={{
            height: 36,
            border: '1px dashed var(--line-strong)',
            background: 'transparent',
            color: 'var(--cobalt)',
            fontSize: 14,
          }}
          onClick={() => setCats(true)}
        >
          Edit categories
        </button>
      </div>
      {recipe.sourceUrl && (
        <p className="small muted" style={{ marginTop: -6 }}>
          From {safeHost(recipe.sourceUrl)}
        </p>
      )}

      <div className="card row-between" style={{ padding: '8px 8px 8px 16px' }}>
        <span className="bold">Servings</span>
        <Stepper
          value={s}
          wide={40}
          decLabel="Fewer servings"
          incLabel="More servings"
          decDisabled={s <= 1}
          onDec={() => setServings(Math.max(1, s - 1))}
          onInc={() => setServings(s + 1)}
        />
      </div>

      <h2 className="h2">Ingredients</h2>
      <div className="list">
        {av.rows.map((r) => {
          const st = statusText(r);
          const amt = amountText(r);
          const mark =
            r.status === 'have' ? 'ok' : r.status === 'partly' || r.status === 'missing' ? 'bad' : 'muted';
          return (
            <div key={r.ingredient.id} className="row" style={{ gap: 12, padding: '12px 16px' }}>
              <span className={`ing-mark ${mark}`} aria-hidden>
                {mark === 'ok' && <IconCheck />}
                {mark === 'bad' && <IconBang />}
              </span>
              <div className="grow">
                <div style={{ fontSize: 17 }}>
                  {amt && <>{amt} </>}
                  {r.ingredient.name}
                  {r.ingredient.optional && <span className="muted">, optional</span>}
                </div>
                <div
                  className={`small bold ${st.tone === 'ok' ? 'text-cobalt' : st.tone === 'warn' ? 'warn-text' : st.tone === 'bad' ? 'danger-text' : 'muted'}`}
                >
                  {st.text}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="stack" style={{ marginTop: 20 }}>
        {missingRows.length > 0 && (
          <button type="button" className="btn btn-outline" onClick={addMissing}>
            Add {plural(missingRows.length, 'missing item')} to the list
          </button>
        )}
        <button type="button" className="btn btn-outline" onClick={() => setPlanning(true)}>
          Add to plan
        </button>
        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ fontSize: 18 }}
          onClick={() => setCooking(true)}
          disabled={!recipe.steps.length}
        >
          Start cooking
        </button>
      </div>
      {recipe.notes && (
        <>
          <h2 className="h2">Notes</h2>
          <p style={{ whiteSpace: 'pre-wrap' }}>{recipe.notes}</p>
        </>
      )}

      {editing && (
        <RecipeEditor
          recipeId={recipe.id}
          onClose={() => setEditing(false)}
          onSaved={(nid) => !nid && nav('/recipes')}
        />
      )}
      {cats && <RecipeCategoriesSheet recipe={recipe} onClose={() => setCats(false)} />}
      {cooking && <CookingMode recipe={recipe} servings={s} onClose={() => setCooking(false)} />}
      {planning && <AddToPlanSheet recipe={recipe} servings={s} onClose={() => setPlanning(false)} />}
    </>
  );
}

function safeHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'the web';
  }
}

export function RecipeCategoriesSheet({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [newName, setNewName] = useState('');
  const all = snap?.household.recipeCategories ?? [];
  const set = (categories: string[]) =>
    void run('setRecipeCategories', { recipeId: recipe.id, categories }, { toast: false });
  return (
    <Sheet onClose={onClose} title="Recipe categories" labelledBy="rc-title">
      <p className="muted" style={{ margin: '-6px 0 0', fontSize: 15 }}>
        Pick as many as fit.
      </p>
      {all.map((c) => {
        const on = recipe.categories.includes(c);
        return (
          <button
            key={c}
            type="button"
            className="cat-opt row"
            style={{
              gap: 12,
              borderColor: on ? 'var(--cobalt)' : undefined,
              background: on ? 'var(--cobalt-soft)' : undefined,
              fontSize: 17,
            }}
            aria-pressed={on}
            onClick={() => set(on ? recipe.categories.filter((x) => x !== c) : [...recipe.categories, c])}
          >
            <span className={`checkbox${on ? ' on' : ''}`} aria-hidden />
            {c}
          </button>
        );
      })}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = newName.trim();
          if (!n) return;
          const existing = all.find((c) => c.toLowerCase() === n.toLowerCase()) ?? n;
          if (!recipe.categories.includes(existing)) set([...recipe.categories, existing]);
          setNewName('');
        }}
      >
        <input
          className="input grow"
          aria-label="New category name"
          placeholder="New category, e.g. Mexican"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-outline btn-md" disabled={!newName.trim()}>
          Create
        </button>
      </form>
      <button type="button" className="btn btn-primary btn-block" onClick={onClose}>
        Done
      </button>
    </Sheet>
  );
}
