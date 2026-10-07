import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRun, useSnapshot } from '../../app/data';
import { takePendingList } from '../../app/importHandoff';
import { Loading, Switch } from '../../ui/controls';
import { plural } from '../../domain/format';
import { parseList, planImport, type ParsedSection } from '../../domain/listImport';
import { SettingsPage } from './common';

const EXAMPLE = `**PANTRY**
- [x] Rice
- [ ] Olive oil
### CLEANING
- [ ] Dish soap`;

/** Settings › Items › Import a list (5.2): paste or open a Markdown list, check the preview, import. */
export function ImportList() {
  const { snap } = useSnapshot();
  const { run } = useRun();
  const nav = useNavigate();
  // a list pasted into the Assistant arrives here, already parsed
  const [text, setText] = useState(() => takePendingList() ?? '');
  const [sections, setSections] = useState<ParsedSection[] | null>(() => {
    const parsed = text ? parseList(text) : [];
    return parsed.length ? parsed : null;
  });
  const [places, setPlaces] = useState<Record<string, string>>({});
  const [addMissing, setAddMissing] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const plan = useMemo(
    () => (snap && sections ? planImport(sections, snap.items.items, snap.household, places) : null),
    [snap, sections, places],
  );
  if (!snap) return <Loading />;

  const preview = () => {
    const parsed = parseList(text);
    if (!parsed.length) {
      setProblem('No items found. Each item needs its own line, like "- [x] Rice" or "- [ ] Dish soap".');
      return;
    }
    setProblem('');
    setSections(parsed);
  };

  const openFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 1_000_000) {
      setProblem('That file is too big for a list. Pick the Markdown (.md) or text file with your list.');
      return;
    }
    setText(await f.text());
    setProblem('');
  };

  const doImport = async () => {
    if (!sections || !plan) return;
    setBusy(true);
    const res = await run(
      'importList',
      { sections, places, addMissingToList: addMissing },
      { toast: (p) => `${p.title.replace('Import', 'Imported')}`, undo: true },
    );
    setBusy(false);
    if (res) nav('/stock');
  };

  if (!sections || !plan)
    return (
      <SettingsPage title="Import a list" back="/settings/items" backLabel="Items">
        <p className="muted" style={{ marginTop: 0 }}>
          Paste your list or open the file. Headings become categories, each line becomes an item. A ticked
          box means you have it at home, an empty one means you don't. Nothing is saved until you check the
          preview and tap Import.
        </p>
        <label className="btn btn-outline btn-block">
          Open a file
          <input
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            className="sr-only"
            onChange={(e) => void openFile(e.target.files?.[0])}
          />
        </label>
        <textarea
          className="input"
          aria-label="Your list"
          rows={10}
          style={{ marginTop: 12, width: '100%', fontFamily: 'var(--font-mono)', fontSize: 14 }}
          placeholder={EXAMPLE}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        {problem && <p className="problem">{problem}</p>}
        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ marginTop: 12 }}
          disabled={!text.trim()}
          onClick={preview}
        >
          Preview
        </button>
      </SettingsPage>
    );

  const placeOptions = [
    ...new Set([
      ...snap.household.places,
      ...plan.sections.map((s) => s.place),
      'Medicine cabinet',
      'Pet corner',
    ]),
  ];
  const missing = plan.rows.filter((r) => !r.have).length;

  return (
    <SettingsPage title="Import a list" back={() => setSections(null)} backLabel="Edit the list">
      <div className="card card-pad stack" style={{ gap: 2 }}>
        <span className="big-num">{plural(plan.rows.length, 'item')}</span>
        <span className="muted">
          in {plural(plan.sections.filter((s) => s.count).length, 'section')}
          {plan.existing.length ? `, ${plan.existing.length} already in your items` : ''}
        </span>
      </div>

      <h2 className="h2">Where each section is kept</h2>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        Sections become categories with the same name. Change a place if it's wrong.
        {plan.newPlaces.length ? ` New places: ${plan.newPlaces.join(', ')}.` : ''}
      </p>
      <div className="list">
        {plan.sections.map((s) => (
          <div key={s.category} className="row" style={{ gap: 10, padding: '10px 12px 10px 16px' }}>
            <span className="grow stack" style={{ gap: 0 }}>
              <span className="bold">{s.category}</span>
              <span className="small muted">{s.count ? plural(s.count, 'new item') : 'Nothing new'}</span>
            </span>
            <select
              className="input input-sm"
              aria-label={`Place for ${s.category}`}
              style={{ width: 150 }}
              value={s.place}
              onChange={(e) => setPlaces((p) => ({ ...p, [s.category]: e.target.value }))}
            >
              {placeOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {plan.renamed.length > 0 && (
        <>
          <h2 className="h2">Renamed to keep them apart</h2>
          <div className="list">
            {plan.renamed.map((r) => (
              <div key={r.name} className="stack" style={{ gap: 0, padding: '10px 16px' }}>
                <span className="bold">{r.name}</span>
                <span className="small muted">
                  {r.renamedFrom} is in two sections. This one is in {r.category}.
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {plan.existing.length > 0 && (
        <details className="card card-pad" style={{ marginTop: 16 }}>
          <summary className="bold">{plural(plan.existing.length, 'item')} already there, skipped</summary>
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {plan.existing.map((e) => e.name).join(', ')}
          </p>
        </details>
      )}

      <div style={{ marginTop: 16 }}>
        <Switch
          on={addMissing}
          onToggle={() => setAddMissing((x) => !x)}
          title={`Add the ${plural(missing, 'item')} we don't have to the shopping list`}
          sub="The unticked ones. They come off the list when you mark them Have."
        />
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        style={{ marginTop: 16 }}
        disabled={busy || !plan.rows.length}
        onClick={() => void doImport()}
      >
        {plan.rows.length ? `Import ${plural(plan.rows.length, 'item')}` : 'Everything is already imported'}
      </button>
    </SettingsPage>
  );
}
