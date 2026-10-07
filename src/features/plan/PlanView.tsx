import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { useRun, useSnapshot } from '../../app/data';
import { Loading, Stepper } from '../../ui/controls';
import { IconBack, IconNext, IconStar } from '../../ui/icons';
import { Sheet } from '../../ui/Sheet';
import { shiftDays, todayISO, weekDates, weekStart } from '../../domain/dates';
import { mealStatus, planAvailability, shortfall, uncovered, type PlannedMeal } from '../../domain/plan';
import { normalise } from '../../domain/categorise';
import { plural } from '../../domain/format';
import { totalMinutes } from '../../domain/recipes';
import type { PlanEntry, Slot } from '../../domain/schemas';
import { FinishCooking } from '../recipes/CookingMode';

const TONE: Record<string, string> = {
  ready: 'tag tag-cobalt',
  missing: 'tag tag-saffron',
  muted: 'tag tag-grey',
  cooked: 'tag tag-grey',
};

function weekLabel(mon: string) {
  const sun = shiftDays(mon, 6);
  const a = parseISO(mon);
  const b = parseISO(sun);
  return a.getMonth() === b.getMonth()
    ? `${format(a, 'd')} to ${format(b, 'd MMMM')}`
    : `${format(a, 'd MMMM')} to ${format(b, 'd MMMM')}`;
}

export function PlanView() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const today = todayISO();
  const [mon, setMon] = useState(() => weekStart(today));
  const [slot, setSlot] = useState<{ date: string; slot: Slot } | null>(null);
  const [cooking, setCooking] = useState<PlanEntry | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const meals = useMemo(
    () =>
      snap
        ? planAvailability(snap.plan.entries, snap.recipes.recipes, snap.items.items, today)
        : new Map<string, PlannedMeal>(),
    [snap, today],
  );
  if (!snap) return <Loading />;

  const days = weekDates(mon);
  const weekMeals = [...meals.values()].filter((m) => m.entry.date >= mon && m.entry.date <= days[6]);
  const short = shortfall(weekMeals);
  const itemsById = new Map(snap.items.items.map((i) => [i.id, i]));
  // what's still missing after counting what's already on the shopping list
  const open = uncovered(short, snap.shopping.items, itemsById);

  const addWeek = () =>
    void run(
      'addToShoppingList',
      {
        entries: [...short].map(([itemId, amount]) => {
          const it = itemsById.get(itemId)!;
          return { itemId, name: it.name, amount, unit: it.unit };
        }),
        source: 'plan',
        sourceRef: mon,
      },
      { toast: (p) => String(p.result) },
    );

  const cookingRecipe = cooking ? snap.recipes.recipes.find((r) => r.id === cooking.recipeId) : undefined;

  return (
    <div
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) setMon(shiftDays(mon, dx < 0 ? 7 : -7));
      }}
    >
      <div className="row-between" style={{ margin: '-4px -8px 6px' }}>
        <button
          type="button"
          className="icon-btn"
          style={{ color: 'var(--cobalt)' }}
          aria-label="Previous week"
          onClick={() => setMon(shiftDays(mon, -7))}
        >
          <IconBack />
        </button>
        <div className="stack" style={{ gap: 0, alignItems: 'center' }}>
          <span className="display bold" style={{ fontSize: 18 }} aria-live="polite">
            {weekLabel(mon)}
          </span>
          {mon !== weekStart(today) && (
            <button
              type="button"
              className="link-btn small"
              style={{ minHeight: 28 }}
              onClick={() => setMon(weekStart(today))}
            >
              Back to this week
            </button>
          )}
        </div>
        <button
          type="button"
          className="icon-btn"
          style={{ color: 'var(--cobalt)' }}
          aria-label="Next week"
          onClick={() => setMon(shiftDays(mon, 7))}
        >
          <IconNext />
        </button>
      </div>
      {open.size > 0 ? (
        <div className="callout callout-saffron stack" style={{ gap: 12 }}>
          <div className="bold" style={{ fontSize: 17 }}>
            This week's meals need {plural(open.size, 'more thing')} than you have.
            <div style={{ fontWeight: 400, fontSize: 15, marginTop: 2 }}>
              Earlier meals get first pick of the stock.
            </div>
          </div>
          <button type="button" className="btn btn-ink btn-md" onClick={addWeek}>
            Add them to the shopping list
          </button>
        </div>
      ) : (
        short.size > 0 && (
          <div className="callout callout-cobalt bold">
            Everything missing this week is on the shopping list.
          </div>
        )
      )}
      <div style={{ marginTop: 8 }}>
        {days.map((d) => (
          <div key={d} className="plan-day" style={{ opacity: d < today ? 0.7 : 1 }}>
            <div style={{ paddingTop: 6 }}>
              <div className="display bold" style={{ fontSize: 18 }}>
                {format(parseISO(d), 'EEE')}
              </div>
              <div className="small muted">{d === today ? 'Today' : format(parseISO(d), 'd MMM')}</div>
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {(['lunch', 'dinner'] as const).map((sl) => {
                const entry = snap.plan.entries.find((x) => x.date === d && x.slot === sl);
                const m = entry ? meals.get(entry.id) : undefined;
                const st = m ? mealStatus(m) : null;
                const name = sl === 'lunch' ? 'Lunch' : 'Dinner';
                return (
                  <button
                    key={sl}
                    type="button"
                    className={`plan-slot${entry ? ' filled' : ''}`}
                    aria-label={
                      m?.recipe
                        ? `${format(parseISO(d), 'EEEE')} ${name}: ${m.recipe.title}`
                        : `Add ${name.toLowerCase()} on ${format(parseISO(d), 'EEEE')}`
                    }
                    onClick={() => setSlot({ date: d, slot: sl })}
                  >
                    <span className="stack" style={{ gap: 0, minWidth: 0 }}>
                      <span className="tiny muted">
                        {name}
                        {entry && m?.recipe && entry.servings !== m.recipe.servings
                          ? `, for ${entry.servings}`
                          : ''}
                      </span>
                      <span className="bold" style={{ color: entry ? 'var(--ink)' : 'var(--muted)' }}>
                        {entry ? (m?.recipe?.title ?? 'Recipe deleted') : 'Add a meal'}
                      </span>
                    </span>
                    {st && (
                      <span className={TONE[st.tone]} style={{ flexShrink: 0 }}>
                        {st.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {slot && (
        <SlotSheet
          date={slot.date}
          slot={slot.slot}
          onClose={() => setSlot(null)}
          onCook={(e) => {
            setSlot(null);
            setCooking(e);
          }}
        />
      )}
      {cooking && cookingRecipe && (
        <FinishCooking
          recipe={cookingRecipe}
          servings={cooking.servings}
          planEntryId={cooking.id}
          onClose={() => setCooking(null)}
        />
      )}
    </div>
  );
}

function SlotSheet({
  date,
  slot,
  onClose,
  onCook,
}: {
  date: string;
  slot: Slot;
  onClose: () => void;
  onCook: (e: PlanEntry) => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const nav = useNavigate();
  const [query, setQuery] = useState('');
  const entry = snap?.plan.entries.find((x) => x.date === date && x.slot === slot);
  const current = entry ? snap?.recipes.recipes.find((r) => r.id === entry.recipeId) : undefined;
  const [servings, setServings] = useState(entry?.servings ?? 0);
  const title = `${format(parseISO(date), 'EEEE')} ${slot}`;
  const q = normalise(query);
  const options = (snap?.recipes.recipes ?? [])
    .filter((r) => !q || normalise(r.title).includes(q))
    .sort((a, b) => Number(b.favourite) - Number(a.favourite) || a.title.localeCompare(b.title));

  const choose = async (recipeId: string, serv: number) => {
    if (
      await run(
        'setPlanEntries',
        { entries: [{ date, slot, recipeId, servings: serv }] },
        { toast: 'Plan updated' },
      )
    )
      onClose();
  };

  return (
    <Sheet onClose={onClose} title={title} labelledBy="slot-title">
      {entry && current && (
        <div
          className="card card-pad stack"
          style={{ gap: 10, background: 'var(--cobalt-soft)', borderColor: 'var(--cobalt)' }}
        >
          <span className="bold" style={{ fontSize: 17 }}>
            {current.title}
          </span>
          {!entry.cooked && (
            <div className="row-between">
              <span>Servings</span>
              <Stepper
                value={servings}
                wide={36}
                decLabel="Fewer servings"
                incLabel="More servings"
                decDisabled={servings <= 1}
                onDec={() => setServings(Math.max(1, servings - 1))}
                onInc={() => setServings(servings + 1)}
              />
            </div>
          )}
          <div className="wrap" style={{ gap: 8 }}>
            {!entry.cooked && servings !== entry.servings && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void choose(current.id, servings)}
              >
                Save servings
              </button>
            )}
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => nav(`/recipes/${current.id}`)}
            >
              Open recipe
            </button>
            {!entry.cooked && (
              <button
                type="button"
                className="btn btn-outline btn-sm"
                onClick={() => onCook({ ...entry, servings })}
              >
                Mark as cooked
              </button>
            )}
          </div>
        </div>
      )}
      <input
        type="search"
        className="input"
        aria-label="Search recipes"
        placeholder={entry ? 'Pick another recipe' : 'Search recipes'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="stack" style={{ gap: 8 }}>
        {options.map((r) => (
          <button
            key={r.id}
            type="button"
            className="cat-opt row"
            style={{
              gap: 8,
              fontSize: 16,
              borderColor: r.id === entry?.recipeId ? 'var(--cobalt)' : undefined,
            }}
            onClick={() => void choose(r.id, r.id === entry?.recipeId ? servings || r.servings : r.servings)}
          >
            {r.favourite && <IconStar size={18} filled style={{ color: 'var(--saffron-deep)' }} />}
            <span className="grow">{r.title}</span>
            <span className="small muted" style={{ fontWeight: 400 }}>
              {totalMinutes(r) ? `${totalMinutes(r)} min, ` : ''}serves {r.servings}
            </span>
          </button>
        ))}
        {options.length === 0 && <p className="muted">No recipe matches.</p>}
      </div>
      {entry && (
        <button
          type="button"
          className="btn btn-ghost btn-md"
          style={{ color: 'var(--red)' }}
          onClick={async () => {
            if (await run('removePlanEntry', { id: entry.id }, { toast: 'Removed from the plan' })) onClose();
          }}
        >
          Remove from the plan
        </button>
      )}
    </Sheet>
  );
}
