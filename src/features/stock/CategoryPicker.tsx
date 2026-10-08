import { useState } from 'react';
import { Sheet } from '../../ui/Sheet';
import { BackButton } from '../../ui/controls';
import { useRun, useSnapshot } from '../../app/data';

/**
 * Two steps: category, then subcategory (optional: "No subcategory" keeps just
 * the category). Each step can create a new one on the spot.
 */
export function CategoryPicker({
  onPick,
  onClose,
  initialCategory,
}: {
  onPick: (category: string, subcategory: string) => void;
  onClose: () => void;
  initialCategory?: string;
}) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const [cat, setCat] = useState<string | null>(initialCategory ?? null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const tree = snap?.household.categories ?? [];
  const node = cat ? tree.find((c) => c.name === cat) : undefined;

  const create = async () => {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    if (node) {
      const existing = node.subcategories.find((s) => s.toLowerCase() === n.toLowerCase());
      if (existing) onPick(node.name, existing);
      else if (
        await run(
          'addSubcategory',
          { category: node.name, name: n },
          { toast: `Created ${node.name} › ${n}`, undo: false },
        )
      )
        onPick(node.name, n);
    } else {
      const existing = tree.find((c) => c.name.toLowerCase() === n.toLowerCase());
      if (existing) setCat(existing.name);
      else if (
        await run('addCategory', { name: n, subcategories: [] }, { toast: `Created ${n}`, undo: false })
      )
        setCat(n);
    }
    setNewName('');
    setBusy(false);
  };

  return (
    <Sheet onClose={onClose} z={50} labelledBy="cp-title">
      {node && <BackButton label="All categories" onClick={() => setCat(null)} />}
      <div className="stack-sm" style={{ gap: 2 }}>
        <h2 className="h-sheet" id="cp-title">
          {node ? node.name : 'Pick a category'}
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 'var(--fs-secondary)' }}>
          {node
            ? 'Now pick a subcategory, or keep just the category.'
            : 'The app remembers this for next time.'}
        </p>
      </div>
      <div className="grid-2">
        {node
          ? [
              <button key="" type="button" className="cat-opt" onClick={() => onPick(node.name, '')}>
                No subcategory
              </button>,
              ...node.subcategories.map((s) => (
                <button key={s} type="button" className="cat-opt" onClick={() => onPick(node.name, s)}>
                  {s}
                </button>
              )),
            ]
          : tree.map((c) => (
              <button key={c.name} type="button" className="cat-opt" onClick={() => setCat(c.name)}>
                {c.name}
              </button>
            ))}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          className="input grow"
          aria-label={node ? 'New subcategory' : 'New category'}
          placeholder={node ? 'New subcategory' : 'New category'}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="btn btn-outline btn-md" disabled={!newName.trim() || busy}>
          Create
        </button>
      </form>
    </Sheet>
  );
}
