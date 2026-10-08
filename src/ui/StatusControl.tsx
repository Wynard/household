import { useRef } from 'react';
import type { StockStatus } from '../domain/stock';

const OPTIONS: [StockStatus, string][] = [
  ['out', 'Out'],
  ['low', 'Low'],
  ['have', '✓ Have'],
];
const WORD: Record<StockStatus, string> = { out: 'Out', low: 'Low', have: 'Have' };

/** Shared polite announcer ("Lapte: Low"), so status changes are heard, not only seen. */
function announce(text: string) {
  let el = document.getElementById('status-announcer');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-announcer';
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'polite');
    document.body.appendChild(el);
  }
  el.textContent = '';
  // a fresh text node makes screen readers repeat the same words
  window.setTimeout(() => (el!.textContent = text), 30);
}

/**
 * Out · Low · Have for simple items (DESIGN.md 6.4): one solid segment at a
 * time, a radio group with arrow keys, and the status always as a word.
 */
export function StatusControl({
  name,
  value,
  onChange,
}: {
  name: string;
  value: StockStatus;
  onChange: (s: StockStatus) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const pick = (s: StockStatus) => {
    if (s === value) return;
    onChange(s);
    announce(`${name}: ${WORD[s]}`);
  };
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const j = (i + d + OPTIONS.length) % OPTIONS.length;
    refs.current[j]?.focus();
    pick(OPTIONS[j][0]);
  };
  return (
    <div className="status-seg" role="radiogroup" aria-label={`Status of ${name}`}>
      {OPTIONS.map(([v, l], i) => (
        <button
          key={v}
          ref={(el) => (refs.current[i] = el)}
          type="button"
          role="radio"
          data-s={v}
          aria-checked={value === v}
          aria-label={WORD[v]}
          tabIndex={value === v ? 0 : -1}
          onClick={() => pick(v)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
