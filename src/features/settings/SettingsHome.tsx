import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRun, useSnapshot, useStore } from '../../app/data';
import { Loading } from '../../ui/controls';
import { Sheet } from '../../ui/Sheet';
import { useToast } from '../../ui/Toast';
import { money, plural } from '../../domain/format';
import { describeCounts } from '../../domain/actions/settings';
import { parseFile, type DataFile } from '../../domain/files';
import { todayISO } from '../../domain/dates';
import { ChevronRow, SettingsPage } from './common';
import { snapshotToFiles } from '../../domain/actions';

export function SettingsHome() {
  const { snap } = useSnapshot();
  const nav = useNavigate();
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  if (!snap) return <Loading />;
  const h = snap.household;
  const items = snap.items.items;
  const subs = h.categories.reduce((t, c) => t + c.subcategories.length, 0);

  const exportAll = () => {
    const files = snapshotToFiles(snap);
    const blob = new Blob(
      [JSON.stringify({ app: 'household', exportedAt: new Date().toISOString(), files }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `household-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast.show('Backup downloaded. Keep it somewhere private.');
  };

  return (
    <SettingsPage
      title="Settings"
      hint="Everything the app knows lives here. Add, rename, edit or delete anything."
      back="/stock"
      backLabel="Close"
    >
      <h2 className="group-title">Your data</h2>
      <div className="list">
        <ChevronRow
          title="Items"
          sub={`${plural(items.length, 'item')}, ${items.filter((i) => i.showInStock).length} shown in Stock`}
          onClick={() => nav('/settings/items')}
        />
        <ChevronRow
          title="Item categories"
          sub={`${plural(h.categories.length, 'category', 'categories')}, ${plural(subs, 'subcategory', 'subcategories')}`}
          onClick={() => nav('/settings/categories')}
        />
        <ChevronRow
          title="Storage places"
          sub={`${plural(h.places.length, 'place')}: ${h.places.slice(0, 3).join(', ')}${h.places.length > 3 ? '…' : ''}`}
          onClick={() => nav('/settings/places')}
        />
        <ChevronRow
          title="Units"
          sub={
            h.units.length
              ? `Your own: ${h.units.slice(0, 3).join(', ')}${h.units.length > 3 ? '…' : ''}`
              : 'g, kg, ml, l, pcs. Add your own, like can or jar'
          }
          onClick={() => nav('/settings/units')}
        />
        <ChevronRow
          title="Recipes"
          sub={plural(snap.recipes.recipes.length, 'recipe')}
          onClick={() => nav('/settings/recipes')}
        />
        <ChevronRow
          title="Recipe categories"
          sub={plural(h.recipeCategories.length, 'category', 'categories')}
          onClick={() => nav('/settings/recipe-categories')}
        />
        <ChevronRow
          title="Stores"
          sub={plural(h.stores.length, 'store')}
          onClick={() => nav('/settings/stores')}
        />
      </div>
      <h2 className="group-title">Household</h2>
      <div className="list">
        <ChevronRow
          title="People and budget"
          sub={`${h.members.map((m) => m.name).join(' and ') || 'No people yet'}, target ${money(h.monthlyTarget)} a month`}
          onClick={() => nav('/settings/household')}
        />
        <ChevronRow
          title="This phone"
          sub="Gemini key, voice language, sign out"
          onClick={() => nav('/settings/device')}
        />
        <ChevronRow
          title="Assistant"
          sub="What it sends to Gemini, turn it off on this phone"
          onClick={() => nav('/settings/assistant')}
        />
      </div>
      <h2 className="group-title">Backup</h2>
      <div className="list">
        <ChevronRow title="Export everything" sub="One file with all of your data" onClick={exportAll} />
        <ChevronRow
          title="Import from a backup"
          sub="Shows what will change before replacing anything"
          onClick={() => setImporting(true)}
        />
      </div>
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </SettingsPage>
  );
}

function ImportSheet({ onClose }: { onClose: () => void }) {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const store = useStore();
  const [parsed, setParsed] = useState<Record<string, Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = snap ? (snapshotToFiles(snap) as Record<string, Record<string, unknown>>) : {};

  const read = async (file: File) => {
    setError(null);
    setParsed(null);
    try {
      const raw = JSON.parse(await file.text()) as { app?: string; files?: Record<string, unknown> };
      if (raw.app !== 'household' || !raw.files) throw new Error("This isn't a Household backup file.");
      const out: Record<string, Record<string, unknown>> = {};
      for (const [name, data] of Object.entries(raw.files)) {
        if (!/^(household|items|recipes|plan|shopping|budget-\d{4}|usage-\d{4})$/.test(name)) continue;
        out[name] = parseFile(name as DataFile, data) as unknown as Record<string, unknown>;
      }
      if (!Object.keys(out).length) throw new Error('The backup has no data in it.');
      setParsed(out);
    } catch (e) {
      setError(
        e instanceof SyntaxError
          ? "That file isn't valid JSON."
          : e instanceof Error
            ? e.message
            : "Couldn't read that file.",
      );
    }
  };

  return (
    <Sheet onClose={onClose} title="Import from a backup" labelledBy="imp-title">
      <p className="muted" style={{ margin: 0, fontSize: 15 }}>
        Pick a household-backup file. Nothing is replaced until you confirm, and you can undo right after.
      </p>
      <label className="btn btn-outline btn-md" style={{ cursor: 'pointer' }}>
        Choose a backup file
        <input
          type="file"
          accept="application/json,.json"
          className="sr-only"
          onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])}
        />
      </label>
      {error && <p className="problem">{error}</p>}
      {parsed && (
        <>
          <div className="list">
            {Object.entries(parsed).map(([name, d]) => (
              <div key={name} className="stack" style={{ gap: 0, padding: '10px 16px' }}>
                <span className="bold">{name}</span>
                <span className="small muted">
                  {current[name]
                    ? `${describeCounts(current[name])} now → ${describeCounts(d)}`
                    : `New: ${describeCounts(d)}`}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-danger btn-block"
            data-armed="true"
            onClick={async () => {
              const ok = await run('restoreBackup', { files: parsed }, { toast: 'Backup restored' });
              if (ok) {
                await store.refreshAll();
                onClose();
              }
            }}
          >
            Replace my data with this backup
          </button>
        </>
      )}
    </Sheet>
  );
}
