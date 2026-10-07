import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useRun, useSnapshot } from '../../app/data';
import { useAssistantUi, useScreenContext } from '../../app/assistantUi';
import { Chip, EmptyState, Loading, PageHeader, Seg } from '../../ui/controls';
import { IconLink, IconPen, IconStar } from '../../ui/icons';
import { availability, badgeLabel, totalMinutes, type Availability } from '../../domain/recipes';
import { normalise } from '../../domain/categorise';
import type { Recipe } from '../../domain/schemas';
import { RecipeEditor } from './RecipeEditor';
import { PlanView } from '../plan/PlanView';

export const IMPORT_PROMPT =
  'Paste the link to a recipe page. I’ll read it, match the ingredients to your items and write clear steps, then you decide whether to save it.';

export function badgeClass(a: Availability) {
  return a.badge === 'ready'
    ? 'badge tag-cobalt'
    : a.badge === 'missing'
      ? 'badge tag-saffron'
      : 'badge tag-grey';
}

export function recipeMeta(r: Recipe) {
  const m = totalMinutes(r);
  return [r.categories.join(', '), [m ? `${m} min` : '', `serves ${r.servings}`].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join('. ');
}

export function StarButton({ recipe, size = 24 }: { recipe: Recipe; size?: number }) {
  const { run } = useRun();
  return (
    <button
      type="button"
      className="icon-btn star-btn"
      aria-pressed={recipe.favourite}
      aria-label={
        recipe.favourite ? `Remove ${recipe.title} from favourites` : `Add ${recipe.title} to favourites`
      }
      style={{ color: recipe.favourite ? 'var(--saffron-deep)' : 'var(--muted)' }}
      onClick={() =>
        void run(
          'toggleFavourite',
          { recipeId: recipe.id },
          { toast: recipe.favourite ? 'Removed from favourites' : 'Added to favourites' },
        )
      }
    >
      <IconStar size={size} filled={recipe.favourite} />
    </button>
  );
}

export function RecipesScreen() {
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'plan' ? 'plan' : 'list';
  useScreenContext(
    view === 'plan' ? 'plan' : 'recipes',
    view === 'plan' ? 'Looking at the week plan' : 'Looking at Recipes',
  );
  const { snap } = useSnapshot();
  const nav = useNavigate();
  const assistant = useAssistantUi();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [writing, setWriting] = useState(false);

  const withAv = useMemo(() => {
    if (!snap) return [];
    const items = new Map(snap.items.items.map((i) => [i.id, i]));
    return snap.recipes.recipes.map((r) => ({ r, av: availability(r, r.servings, items) }));
  }, [snap]);

  if (!snap) return <Loading text="Loading recipes…" />;

  const cats = snap.household.recipeCategories;
  const q = normalise(query);
  const shown = withAv
    .filter(
      ({ r, av }) =>
        filter === 'all' ||
        (filter === 'fav' && r.favourite) ||
        (filter === 'ready' && av.badge === 'ready') ||
        r.categories.includes(filter),
    )
    .filter(
      ({ r }) =>
        !q ||
        normalise(
          `${r.title} ${r.categories.join(' ')} ${r.ingredients.map((g) => g.name).join(' ')}`,
        ).includes(q),
    )
    .sort((a, b) => Number(b.r.favourite) - Number(a.r.favourite) || a.r.title.localeCompare(b.r.title));
  const readyN = withAv.filter((x) => x.av.badge === 'ready').length;

  return (
    <>
      <PageHeader title="Recipes" />
      <div className="grid-2" style={{ margin: '14px 0 12px' }}>
        <button
          type="button"
          className="btn btn-primary"
          style={{ fontSize: 15, padding: '0 10px' }}
          onClick={() => assistant.open({ prompt: IMPORT_PROMPT })}
        >
          <IconLink />
          Import from a link
        </button>
        <button
          type="button"
          className="btn btn-outline"
          style={{ fontSize: 15, padding: '0 10px' }}
          onClick={() => setWriting(true)}
        >
          <IconPen />
          Write a recipe
        </button>
      </div>
      <div style={{ marginBottom: 16 }}>
        <Seg
          label="Recipes or week plan"
          value={view}
          onChange={(v) => setParams(v === 'plan' ? { view: 'plan' } : {}, { replace: true })}
          options={[
            ['list', 'Recipes'],
            ['plan', 'Week plan'],
          ]}
        />
      </div>

      {view === 'plan' ? (
        <PlanView />
      ) : (
        <>
          <p className="summary" style={{ marginTop: 0 }}>
            {readyN} of {withAv.length} ready to cook with what you have
          </p>
          <input
            type="search"
            className="input search"
            aria-label="Search recipes"
            placeholder="Search recipes or ingredients"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="hscroll bleed" style={{ marginTop: 12 }}>
            <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </Chip>
            <Chip pressed={filter === 'fav'} onClick={() => setFilter('fav')}>
              Favourites {snap.recipes.recipes.filter((r) => r.favourite).length}
            </Chip>
            <Chip pressed={filter === 'ready'} onClick={() => setFilter('ready')}>
              Ready to cook
            </Chip>
            {cats.map((c) => (
              <Chip key={c} pressed={filter === c} onClick={() => setFilter(c)}>
                {c} {snap.recipes.recipes.filter((r) => r.categories.includes(c)).length}
              </Chip>
            ))}
          </div>
          <div className="stack" style={{ marginTop: 12 }}>
            {shown.map(({ r, av }) => (
              <div key={r.id} className="card recipe-card">
                <button type="button" className="recipe-open" onClick={() => nav(`/recipes/${r.id}`)}>
                  <span className="recipe-title">{r.title}</span>
                  <span className="small muted">{recipeMeta(r)}</span>
                  <span className={badgeClass(av)}>{badgeLabel(av)}</span>
                </button>
                <StarButton recipe={r} />
              </div>
            ))}
            {shown.length === 0 && (
              <EmptyState>
                {withAv.length === 0
                  ? 'No recipes yet. Import one from a link or write your own.'
                  : filter === 'fav'
                    ? 'No favourites yet. Tap the star on a recipe to add it.'
                    : filter === 'ready'
                      ? 'Nothing can be cooked fully from stock right now.'
                      : q
                        ? 'No recipe matches. Try another word.'
                        : 'No recipes in this category yet.'}
              </EmptyState>
            )}
          </div>
        </>
      )}
      {writing && <RecipeEditor onClose={() => setWriting(false)} onSaved={(id) => nav(`/recipes/${id}`)} />}
    </>
  );
}
