import { useEffect, useId, useState, type ReactNode, type InputHTMLAttributes } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconBack, IconGear, IconMinus, IconNext, IconPlus } from './icons';

export function GearButton() {
  const nav = useNavigate();
  return (
    <button type="button" className="icon-btn gear" aria-label="Settings" onClick={() => nav('/settings')}>
      <IconGear />
    </button>
  );
}

/** Title row with the Settings gear at the right (8). */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="row-between">
      <h1 className="h1">{title}</h1>
      <div className="row">
        {children}
        <GearButton />
      </div>
    </div>
  );
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="back-link" onClick={onClick}>
      <IconBack />
      {label}
    </button>
  );
}

export function Chip({
  pressed,
  onClick,
  children,
  className = '',
  ...rest
}: {
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button type="button" className={`chip ${className}`} aria-pressed={pressed} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
  small,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  small?: boolean;
  label: string;
}) {
  return (
    <div className={`seg${small ? ' seg-sm' : ''}`} role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button type="button" key={v} aria-pressed={value === v} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Choice<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="stack-sm">
      <span className="bold" style={{ fontSize: 15 }}>
        {label}
      </span>
      <div className="grid-2" role="group" aria-label={label}>
        {options.map(([v, l]) => (
          <button
            type="button"
            key={v}
            className="choice"
            aria-pressed={value === v}
            onClick={() => onChange(v)}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Stepper({
  value,
  onDec,
  onInc,
  decLabel,
  incLabel,
  decDisabled,
  wide = 66,
}: {
  value: ReactNode;
  onDec: () => void;
  onInc: () => void;
  decLabel: string;
  incLabel: string;
  decDisabled?: boolean;
  wide?: number;
}) {
  return (
    <div className="stepper">
      <button type="button" className="step-btn" aria-label={decLabel} onClick={onDec} disabled={decDisabled}>
        <IconMinus />
      </button>
      <span className="step-val" style={{ minWidth: wide }}>
        {value}
      </span>
      <button type="button" className="step-btn plus" aria-label={incLabel} onClick={onInc}>
        <IconPlus />
      </button>
    </div>
  );
}

export function Switch({
  on,
  onToggle,
  title,
  sub,
}: {
  on: boolean;
  onToggle: () => void;
  title: string;
  sub?: string;
}) {
  return (
    <button type="button" className="switch-row" role="switch" aria-checked={on} onClick={onToggle}>
      <span className="grow stack" style={{ gap: 0 }}>
        <span className="bold">{title}</span>
        {sub && <span className="small muted">{sub}</span>}
      </span>
      <span className="switch" data-on={on} />
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children}
      {hint && (
        <span className="small muted" style={{ fontWeight: 400 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/** Text input that accepts both "," and "." as decimal separators. */
export function DecimalInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input inputMode="decimal" autoComplete="off" className="input" {...props} />;
}

/** Two-tap delete: first tap arms ("Tap again to delete"), second tap deletes. */
export function DeleteButton({
  label,
  onDelete,
  blockedReason,
  onBlocked,
  className = 'btn btn-danger btn-md btn-block',
}: {
  label: string;
  onDelete: () => void;
  blockedReason?: string | null;
  onBlocked?: (reason: string) => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className={className}
      data-armed={armed}
      onClick={() => {
        if (blockedReason) {
          onBlocked?.(blockedReason);
          return;
        }
        if (!armed) setArmed(true);
        else {
          setArmed(false);
          onDelete();
        }
      }}
    >
      {armed ? 'Tap again to delete' : label}
    </button>
  );
}

export function MonthSwitcher({
  label,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: {
  label: string;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <div className="row-between" style={{ margin: '4px -8px 10px' }}>
      <button
        type="button"
        className="icon-btn"
        style={{ color: prevDisabled ? 'var(--off)' : 'var(--cobalt)' }}
        aria-label="Previous month"
        onClick={onPrev}
        disabled={prevDisabled}
      >
        <IconBack />
      </button>
      <h2 className="display bold" style={{ margin: 0, fontSize: 20 }} aria-live="polite">
        {label}
      </h2>
      <button
        type="button"
        className="icon-btn"
        style={{ color: nextDisabled ? 'var(--off)' : 'var(--cobalt)' }}
        aria-label="Next month"
        onClick={onNext}
        disabled={nextDisabled}
      >
        <IconNext />
      </button>
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function useStableId(prefix: string) {
  return `${prefix}-${useId().replace(/:/g, '')}`;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return (
    <p className="empty" role="status">
      {text}
    </p>
  );
}
