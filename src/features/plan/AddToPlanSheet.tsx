import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Sheet } from '../../ui/Sheet';
import { Seg, Stepper } from '../../ui/controls';
import { useRun, useSnapshot } from '../../app/data';
import { shiftDays, todayISO, weekDates, weekStart } from '../../domain/dates';
import type { Recipe, Slot } from '../../domain/schemas';

/** Pick a day (this week or next), lunch or dinner, and servings. */
export function AddToPlanSheet({
  recipe,
  servings: initial,
  onClose,
}: {
  recipe: Recipe;
  servings: number;
  onClose: () => void;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const today = todayISO();
  const mon = weekStart(today);
  const days = [...weekDates(mon), ...weekDates(shiftDays(mon, 7))].filter((d) => d >= today);
  const [date, setDate] = useState(days[0]);
  const [slot, setSlot] = useState<Slot>('dinner');
  const [servings, setServings] = useState(initial);
  const cur = snap?.plan.entries.find((e) => e.date === date && e.slot === slot);
  const curR = cur ? snap?.recipes.recipes.find((r) => r.id === cur.recipeId) : undefined;

  return (
    <Sheet onClose={onClose} title={`Plan ${recipe.title}`} labelledBy="atp-title">
      <div className="stack-sm">
        <span className="bold" style={{ fontSize: 'var(--fs-secondary)' }}>
          Day
        </span>
        <div className="wrap" style={{ gap: 6 }}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              className="chip chip-sm"
              aria-pressed={d === date}
              onClick={() => setDate(d)}
            >
              {d === today ? 'Today' : format(parseISO(d), 'EEE d')}
            </button>
          ))}
        </div>
      </div>
      <Seg
        label="Meal"
        value={slot}
        onChange={setSlot}
        options={[
          ['lunch', 'Lunch'],
          ['dinner', 'Dinner'],
        ]}
      />
      <div className="row-between">
        <span className="bold">Servings</span>
        <Stepper
          value={servings}
          wide={40}
          decLabel="Fewer servings"
          incLabel="More servings"
          decDisabled={servings <= 1}
          onDec={() => setServings(Math.max(1, servings - 1))}
          onInc={() => setServings(servings + 1)}
        />
      </div>
      {curR && curR.id !== recipe.id && (
        <p className="note" style={{ margin: 0 }}>
          Replaces {curR.title}.
        </p>
      )}
      <button
        type="button"
        className="btn btn-primary btn-block"
        onClick={async () => {
          const ok = await run(
            'setPlanEntries',
            { entries: [{ date, slot, recipeId: recipe.id, servings }] },
            { toast: `Planned for ${date === today ? 'today' : format(parseISO(date), 'EEEE')} ${slot}` },
          );
          if (ok) onClose();
        }}
      >
        Add to the plan
      </button>
    </Sheet>
  );
}
