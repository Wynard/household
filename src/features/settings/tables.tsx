import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRun, useSnapshot } from '../../app/data';
import { Chip, Loading } from '../../ui/controls';
import { IconGrip } from '../../ui/icons';
import { useToast } from '../../ui/Toast';
import { normalise } from '../../domain/categorise';
import { catLabel, plural } from '../../domain/format';
import { categoryUse, placeUse, recipeCategoryUse, storeUse, unitUse } from '../../domain/actions/settings';
import { UNITS } from '../../domain/schemas';
import type { Snapshot } from '../../domain/actions';
import { ItemEditor } from '../stock/ItemEditor';
import { RecipeEditor } from '../recipes/RecipeEditor';
import { ChevronRow, NameEditor, SettingsPage } from './common';

const ctxOf = (snap: Snapshot) => ({ snap });

// ---------- Items ----------
export function ItemsTable() {
  const { snap } = useSnapshot();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'shown' | 'hidden'>('all');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const nav = useNavigate();
  if (!snap) return <Loading />;
  const items = snap.items.items;
  const shown = items.filter((i) => i.showInStock).length;
  const nq = normalise(q);
  const list = items
    .filter((i) => f === 'all' || (f === 'shown' ? i.showInStock : !i.showInStock))
    .filter(
      (i) =>
        !nq ||
        normalise(`${i.name} ${i.category} ${i.subcategory} ${i.place} ${i.aliases.join(' ')}`).includes(nq),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <SettingsPage
      title="Items"
      hint="Every item you keep at home, food or not. Hidden items don't show in Stock but still work for the budget, recipes and receipts."
      add={{ label: 'New item', onClick: () => setEditing(null) }}
    >
      <input
        type="search"
        className="input search"
        aria-label="Search items"
        placeholder="Search all items"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-outline btn-block"
        style={{ marginTop: 12 }}
        onClick={() => nav('/settings/items/import')}
      >
        Import a list
      </button>
      <div className="wrap" style={{ margin: '12px 0' }}>
        <Chip pressed={f === 'all'} onClick={() => setF('all')}>
          All {items.length}
        </Chip>
        <Chip pressed={f === 'shown'} onClick={() => setF('shown')}>
          In Stock {shown}
        </Chip>
        <Chip pressed={f === 'hidden'} onClick={() => setF('hidden')}>
          Hidden {items.length - shown}
        </Chip>
      </div>
      <div className="list">
        {list.map((i) => (
          <ChevronRow
            key={i.id}
            title={i.name}
            sub={`${catLabel(i.category, i.subcategory)}, ${i.place}`}
            onClick={() => setEditing(i.id)}
            badge={!i.showInStock ? <span className="tag tag-grey">Hidden</span> : undefined}
          />
        ))}
        {list.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: '18px 16px' }}>
            No items match.
          </p>
        )}
      </div>
      {editing !== undefined && <ItemEditor itemId={editing} onClose={() => setEditing(undefined)} />}
    </SettingsPage>
  );
}

// ---------- Item categories ----------
type CatEdit = { kind: 'cat'; old?: string } | { kind: 'sub'; parent: string; old?: string };

export function CategoriesTable() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [edit, setEdit] = useState<CatEdit | null>(null);
  if (!snap) return <Loading />;
  const ctx = ctxOf(snap);
  const tree = snap.household.categories;

  const editor = () => {
    if (!edit) return null;
    if (edit.kind === 'cat') {
      const use = edit.old ? categoryUse(ctx, edit.old) : null;
      return (
        <NameEditor
          title={edit.old ? 'Edit category' : 'New category'}
          initial={edit.old}
          hint={
            use
              ? `${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. Renaming updates it everywhere.`
              : 'It starts with one subcategory, General. Add more after.'
          }
          existing={tree.map((c) => c.name)}
          guard={
            use && (use.items || use.lines)
              ? `Used by ${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. You can rename it, or move those to another category before deleting.`
              : null
          }
          onSave={async (n) =>
            !!(edit.old
              ? await run('renameCategory', { from: edit.old, to: n }, { toast: `Renamed to ${n}` })
              : await run('addCategory', { name: n }, { toast: `${n} created` }))
          }
          onDelete={
            edit.old
              ? async () =>
                  !!(await run('deleteCategory', { name: edit.old! }, { toast: `${edit.old} deleted` }))
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      );
    }
    const node = tree.find((c) => c.name === edit.parent);
    const use = edit.old ? categoryUse(ctx, edit.parent, edit.old) : null;
    return (
      <NameEditor
        title={edit.old ? `Edit subcategory in ${edit.parent}` : `New subcategory in ${edit.parent}`}
        initial={edit.old}
        hint={
          use
            ? `${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. Renaming updates it everywhere.`
            : undefined
        }
        existing={node?.subcategories ?? []}
        guard={
          use && (use.items || use.lines)
            ? `Used by ${plural(use.items, 'item')} and ${plural(use.lines, 'purchase line')}. You can rename it, or move those first.`
            : node && node.subcategories.length <= 1
              ? 'A category needs at least one subcategory. Delete the category instead.'
              : null
        }
        onSave={async (n) =>
          !!(edit.old
            ? await run(
                'renameSubcategory',
                { category: edit.parent, from: edit.old, to: n },
                { toast: `Renamed to ${n}` },
              )
            : await run('addSubcategory', { category: edit.parent, name: n }, { toast: `${n} created` }))
        }
        onDelete={
          edit.old
            ? async () =>
                !!(await run(
                  'deleteSubcategory',
                  { category: edit.parent, name: edit.old! },
                  { toast: `${edit.old} deleted` },
                ))
            : undefined
        }
        onClose={() => setEdit(null)}
      />
    );
  };

  return (
    <SettingsPage
      title="Item categories"
      hint="Two levels: category and subcategory. Tap a subcategory to rename or delete it. Renaming updates everything that uses it."
      add={{ label: 'New category', onClick: () => setEdit({ kind: 'cat' }) }}
    >
      <div className="stack">
        {tree.map((c) => (
          <div key={c.name} className="card stack" style={{ padding: '12px 12px 14px 16px' }}>
            <div className="row-between">
              <span className="stack" style={{ gap: 0 }}>
                <span className="bold" style={{ fontSize: 17 }}>
                  {c.name}
                </span>
                <span className="small muted">
                  {plural(categoryUse(ctx, c.name).items, 'item')},{' '}
                  {plural(c.subcategories.length, 'subcategory', 'subcategories')}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ borderWidth: 1 }}
                onClick={() => setEdit({ kind: 'cat', old: c.name })}
              >
                Edit
              </button>
            </div>
            <div className="wrap" style={{ gap: 6 }}>
              {c.subcategories.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="sub-chip"
                  onClick={() => setEdit({ kind: 'sub', parent: c.name, old: s })}
                >
                  {s} ({categoryUse(ctx, c.name, s).items})
                </button>
              ))}
              <button
                type="button"
                className="sub-chip dashed-chip"
                onClick={() => setEdit({ kind: 'sub', parent: c.name })}
              >
                Add subcategory
              </button>
            </div>
          </div>
        ))}
      </div>
      {editor()}
    </SettingsPage>
  );
}

// ---------- Storage places (drag to reorder) ----------
export function PlacesTable() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [edit, setEdit] = useState<{ old?: string } | null>(null);
  const [drag, setDrag] = useState<{ name: string; over: number } | null>(null);
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  if (!snap) return <Loading />;
  const places = snap.household.places;
  const ctx = ctxOf(snap);

  const indexAt = (y: number) => {
    let idx = places.length - 1;
    for (let i = 0; i < places.length; i++) {
      const r = rows.current[i]?.getBoundingClientRect();
      if (r && y < r.top + r.height / 2) {
        idx = i;
        break;
      }
    }
    return idx;
  };

  return (
    <SettingsPage
      title="Storage places"
      hint="Where things are kept at home. Stock is grouped in this order: drag the handle to reorder."
      add={{ label: 'New place', onClick: () => setEdit({}) }}
    >
      <div className="list" style={{ touchAction: drag ? 'none' : undefined }}>
        {places.map((p, i) => {
          const n = placeUse(ctx, p);
          return (
            <div
              key={p}
              ref={(el) => {
                rows.current[i] = el;
              }}
              className="row"
              style={{
                gap: 0,
                background: drag?.name === p ? 'var(--cobalt-soft)' : undefined,
                boxShadow:
                  drag && drag.over === i && drag.name !== p ? 'inset 0 3px 0 var(--cobalt)' : undefined,
              }}
            >
              <span
                className="icon-btn grip"
                role="button"
                tabIndex={0}
                aria-label={`Move ${p}. Use the arrow keys, or drag.`}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture(e.pointerId);
                  setDrag({ name: p, over: i });
                }}
                onPointerMove={(e) => drag && setDrag({ ...drag, over: indexAt(e.clientY) })}
                onPointerUp={() => {
                  if (drag && drag.over !== places.indexOf(drag.name))
                    void run('movePlace', { name: drag.name, index: drag.over }, { toast: 'Order saved' });
                  setDrag(null);
                }}
                onPointerCancel={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' && i > 0)
                    void run('movePlace', { name: p, index: i - 1 }, { toast: false });
                  if (e.key === 'ArrowDown' && i < places.length - 1)
                    void run('movePlace', { name: p, index: i + 1 }, { toast: false });
                }}
              >
                <IconGrip />
              </span>
              <div className="grow">
                <ChevronRow title={p} sub={plural(n, 'item')} onClick={() => setEdit({ old: p })} />
              </div>
            </div>
          );
        })}
      </div>
      {edit && (
        <NameEditor
          title={edit.old ? 'Edit storage place' : 'New storage place'}
          initial={edit.old}
          hint={
            edit.old
              ? `${plural(placeUse(ctx, edit.old), 'item')}. Renaming updates it everywhere.`
              : undefined
          }
          existing={places}
          guard={
            edit.old && placeUse(ctx, edit.old)
              ? `Holds ${plural(placeUse(ctx, edit.old), 'item')}. Move them to another place first (Settings, Items).`
              : null
          }
          onSave={async (n) =>
            !!(edit.old
              ? await run('renamePlace', { from: edit.old, to: n }, { toast: `Renamed to ${n}` })
              : await run('addPlace', { name: n }, { toast: `${n} added` }))
          }
          onDelete={
            edit.old
              ? async () =>
                  !!(await run('deletePlace', { name: edit.old! }, { toast: `${edit.old} deleted` }))
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      )}
    </SettingsPage>
  );
}

// ---------- Recipes ----------
export function RecipesTable() {
  const { snap } = useSnapshot();
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  if (!snap) return <Loading />;
  const list = snap.recipes.recipes.slice().sort((a, b) => a.title.localeCompare(b.title));
  return (
    <SettingsPage
      title="Recipes"
      hint="All your recipes. Tap one to edit it."
      add={{ label: 'New recipe', onClick: () => setEditing(null) }}
    >
      <div className="list">
        {list.map((r) => (
          <ChevronRow
            key={r.id}
            title={`${r.favourite ? '★ ' : ''}${r.title}`}
            sub={`${r.categories.join(', ') || 'No category'}. ${plural(r.ingredients.length, 'ingredient')}, ${plural(r.steps.length, 'step')}`}
            onClick={() => setEditing(r.id)}
          />
        ))}
        {list.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: '18px 16px' }}>
            No recipes yet.
          </p>
        )}
      </div>
      {editing !== undefined && (
        <RecipeEditor recipeId={editing ?? undefined} onClose={() => setEditing(undefined)} />
      )}
    </SettingsPage>
  );
}

// ---------- Recipe categories ----------
export function RecipeCategoriesTable() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [edit, setEdit] = useState<{ old?: string } | null>(null);
  if (!snap) return <Loading />;
  const ctx = ctxOf(snap);
  const cats = snap.household.recipeCategories;
  return (
    <SettingsPage
      title="Recipe categories"
      hint="Used to filter recipes. A recipe can be in several."
      add={{ label: 'New category', onClick: () => setEdit({}) }}
    >
      <div className="list">
        {cats.map((c) => (
          <ChevronRow
            key={c}
            title={c}
            sub={plural(recipeCategoryUse(ctx, c), 'recipe')}
            onClick={() => setEdit({ old: c })}
          />
        ))}
      </div>
      {edit && (
        <NameEditor
          title={edit.old ? 'Edit recipe category' : 'New recipe category'}
          initial={edit.old}
          hint={
            edit.old
              ? `${plural(recipeCategoryUse(ctx, edit.old), 'recipe')}. Deleting removes it from those recipes; the recipes stay.`
              : undefined
          }
          existing={cats}
          onSave={async (n) =>
            !!(edit.old
              ? await run('renameRecipeCategory', { from: edit.old, to: n }, { toast: `Renamed to ${n}` })
              : await run('addRecipeCategory', { name: n }, { toast: `${n} created` }))
          }
          onDelete={
            edit.old
              ? async () =>
                  !!(await run('deleteRecipeCategory', { name: edit.old! }, { toast: `${edit.old} deleted` }))
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      )}
    </SettingsPage>
  );
}

// ---------- Stores ----------
export function StoresTable() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const toast = useToast();
  const [edit, setEdit] = useState<{ old?: string } | null>(null);
  const ctx = useMemo(() => (snap ? ctxOf(snap) : null), [snap]);
  if (!snap || !ctx) return <Loading />;
  const stores = snap.household.stores;
  return (
    <SettingsPage
      title="Stores"
      hint="Stores you buy from. Renaming one updates all its purchases; renaming it to a store you already have merges them."
      add={{ label: 'New store', onClick: () => setEdit({}) }}
    >
      <div className="list">
        {stores.map((s) => (
          <ChevronRow
            key={s}
            title={s}
            sub={plural(storeUse(ctx, s), 'purchase')}
            onClick={() => setEdit({ old: s })}
          />
        ))}
      </div>
      {edit && (
        <NameEditor
          title={edit.old ? 'Edit store' : 'New store'}
          initial={edit.old}
          hint={
            edit.old
              ? `${plural(storeUse(ctx, edit.old), 'purchase')}. Renaming updates them all.`
              : undefined
          }
          existing={edit.old ? [] : stores}
          guard={
            edit.old && storeUse(ctx, edit.old)
              ? `Has ${plural(storeUse(ctx, edit.old), 'purchase')} in your history, so it can only be renamed.`
              : null
          }
          saveLabel={undefined}
          onSave={async (n) => {
            if (edit.old) {
              const r = await run(
                'renameStore',
                { from: edit.old, to: n },
                { toast: (p) => (p.title.startsWith('Merge') ? `Merged into ${n}` : `Renamed to ${n}`) },
              );
              return !!r;
            }
            if (stores.some((x) => x.toLowerCase() === n.toLowerCase())) {
              toast.show('That store already exists.');
              return false;
            }
            return !!(await run('addStore', { name: n }, { toast: `${n} added` }));
          }}
          onDelete={
            edit.old
              ? async () =>
                  !!(await run('deleteStore', { name: edit.old! }, { toast: `${edit.old} deleted` }))
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      )}
    </SettingsPage>
  );
}

// ---------- Units ----------
const BUILT_IN_HINT: Record<string, string> = {
  g: 'grams',
  kg: 'kilograms',
  ml: 'millilitres',
  l: 'litres',
  pcs: 'pieces',
};

export function UnitsTable() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [edit, setEdit] = useState<{ old?: string } | null>(null);
  const ctx = useMemo(() => (snap ? ctxOf(snap) : null), [snap]);
  if (!snap || !ctx) return <Loading />;
  const units = snap.household.units;
  return (
    <SettingsPage
      title="Units"
      hint="Your own units are counted one at a time, like pieces: a can, a jar, a pack. Give an item a weight per can to let recipes in grams use it."
      add={{ label: 'New unit', onClick: () => setEdit({}) }}
    >
      <h2 className="group-title">Your units</h2>
      <div className="list">
        {units.map((u) => (
          <ChevronRow
            key={u}
            title={u}
            sub={unitUse(ctx, u) ? `Used ${plural(unitUse(ctx, u), 'time')}` : 'Not used yet'}
            onClick={() => setEdit({ old: u })}
          />
        ))}
        {units.length === 0 && (
          <p className="muted" style={{ margin: 0, padding: '18px 16px' }}>
            None yet. Tap New unit to add one, for example can or jar.
          </p>
        )}
      </div>
      <h2 className="group-title">Built in</h2>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        These can't be changed: the app converts between them (1 kg = 1000 g).
      </p>
      <div className="list">
        {UNITS.map((u) => (
          <div key={u} className="row-between" style={{ padding: '12px 16px' }}>
            <span className="bold">{u}</span>
            <span className="small muted">{BUILT_IN_HINT[u]}</span>
          </div>
        ))}
      </div>
      {edit && (
        <NameEditor
          title={edit.old ? 'Edit unit' : 'New unit'}
          initial={edit.old}
          hint={edit.old ? undefined : 'One word, as it reads after a number: "2 cans" is written can.'}
          existing={edit.old ? [] : units}
          guard={
            edit.old && unitUse(ctx, edit.old)
              ? `Used ${plural(unitUse(ctx, edit.old), 'time')} in your items, lists, recipes or history, so it can't be renamed or deleted.`
              : null
          }
          saveLabel={undefined}
          onSave={async (n) =>
            edit.old
              ? !!(await run(
                  'renameUnit',
                  { from: edit.old, to: n },
                  { toast: `Renamed to ${n.toLowerCase()}` },
                ))
              : !!(await run('addUnit', { name: n }, { toast: `${n.toLowerCase()} added` }))
          }
          onDelete={
            edit.old
              ? async () => !!(await run('deleteUnit', { name: edit.old! }, { toast: `${edit.old} deleted` }))
              : undefined
          }
          onClose={() => setEdit(null)}
        />
      )}
    </SettingsPage>
  );
}
