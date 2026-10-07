import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sheet } from '../../ui/Sheet';
import { BackButton, DeleteButton, Field } from '../../ui/controls';
import { IconNext, IconPlus } from '../../ui/icons';

/** Full-page settings screen frame: back link, optional add button, title and hint. */
export function SettingsPage({
  title,
  hint,
  back = '/settings',
  backLabel = 'Settings',
  add,
  children,
}: {
  title: string;
  hint?: string;
  back?: string | (() => void);
  backLabel?: string;
  add?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  const nav = useNavigate();
  return (
    <div className="page" style={{ paddingBottom: 40 }}>
      <div className="row-between" style={{ margin: '-14px -8px 0', minHeight: 50 }}>
        <BackButton label={backLabel} onClick={() => (typeof back === 'function' ? back() : nav(back))} />
        {add && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            style={{ paddingLeft: 10 }}
            onClick={add.onClick}
          >
            <IconPlus />
            {add.label}
          </button>
        )}
      </div>
      <h1 className="h1" style={{ marginTop: 6 }}>
        {title}
      </h1>
      {hint && <p className="summary">{hint}</p>}
      {children}
    </div>
  );
}

export function ChevronRow({
  title,
  sub,
  onClick,
  badge,
}: {
  title: string;
  sub?: string;
  onClick: () => void;
  badge?: ReactNode;
}) {
  return (
    <button type="button" className="list-row" onClick={onClick} style={{ padding: '14px 12px 14px 16px' }}>
      <span className="grow stack" style={{ gap: 0 }}>
        <span className="title">{title}</span>
        {sub && <span className="sub">{sub}</span>}
      </span>
      {badge}
      <IconNext size={20} className="chev" />
    </button>
  );
}

/**
 * Add / rename / delete one name (place, category, subcategory, store...).
 * `guard` explains why it can't be deleted; `onDelete` is omitted for "add".
 */
export function NameEditor({
  title,
  initial = '',
  hint,
  existing,
  guard,
  saveLabel,
  onSave,
  onDelete,
  onClose,
}: {
  title: string;
  initial?: string;
  hint?: string;
  /** names that already exist (case-insensitive duplicate check) */
  existing: string[];
  guard?: string | null;
  saveLabel?: string;
  onSave: (name: string) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const v = value.trim();
  const dup =
    !!v &&
    v.toLowerCase() !== initial.toLowerCase() &&
    existing.some((x) => x.toLowerCase() === v.toLowerCase());
  const can = !!v && v !== initial && !dup;
  return (
    <Sheet onClose={onClose} title={title} z={47} labelledBy="ne-title">
      {hint && (
        <p className="muted" style={{ margin: 0, fontSize: 15 }}>
          {hint}
        </p>
      )}
      <form
        className="stack-lg"
        onSubmit={async (e) => {
          e.preventDefault();
          if (can && (await onSave(v))) onClose();
        }}
      >
        <Field label="Name">
          <input className="input" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </Field>
        {dup && <span className="problem">That name already exists</span>}
        <button type="submit" className="btn btn-primary btn-block" disabled={!can}>
          {saveLabel ?? (initial ? 'Rename' : 'Create')}
        </button>
      </form>
      {onDelete &&
        (guard ? (
          <p className="note" style={{ margin: 0 }}>
            {guard}
          </p>
        ) : (
          <DeleteButton
            label="Delete"
            onDelete={async () => {
              if (await onDelete()) onClose();
            }}
          />
        ))}
    </Sheet>
  );
}
