import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './overlay';

/**
 * Closing with unsaved changes asks first ("Discard changes?"), so a stray tap
 * on the backdrop, Escape or a close button never throws away what was typed.
 */
export function useGuardedClose(dirty: boolean, onClose: () => void) {
  const [confirming, setConfirming] = useState(false);
  return {
    confirming,
    requestClose: () => (dirty ? setConfirming(true) : onClose()),
    keep: () => setConfirming(false),
    discard: () => {
      setConfirming(false);
      onClose();
    },
  };
}

export function DiscardBar({
  onKeep,
  onDiscard,
  text = 'Discard your changes?',
  keepLabel = 'Keep editing',
  discardLabel = 'Discard',
}: {
  onKeep: () => void;
  onDiscard: () => void;
  text?: string;
  keepLabel?: string;
  discardLabel?: string;
}) {
  return (
    <div className="discard-bar" role="alertdialog" aria-label={text}>
      <span className="bold grow">{text}</span>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onKeep} autoFocus>
        {keepLabel}
      </button>
      <button type="button" className="btn btn-danger btn-sm" data-armed="true" onClick={onDiscard}>
        {discardLabel}
      </button>
    </div>
  );
}

/**
 * Bottom sheet over the current screen. Closes on scrim tap or Escape (asking
 * first when `dirty`). The main action goes in `footer`, pinned at the bottom
 * where the thumb is, however long the sheet gets.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  dirty = false,
  z = 30,
  labelledBy,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  dirty?: boolean;
  z?: number;
  labelledBy?: string;
}) {
  useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  const guard = useGuardedClose(dirty, onClose);
  // the latest close handler, without re-running the focus effect on every render
  // (re-running it stole focus from the field being typed in, closing the keyboard)
  const close = useRef(guard.requestClose);
  close.current = guard.requestClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, []);
  return createPortal(
    <div className="overlay" style={{ zIndex: z }}>
      <button type="button" className="overlay-close" aria-label="Close" onClick={guard.requestClose} />
      <div
        className={`sheet${footer ? ' has-foot' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        ref={ref}
      >
        {title && (
          <h2 className="h-sheet" id={labelledBy}>
            {title}
          </h2>
        )}
        {children}
        {(footer || guard.confirming) && (
          <div className="sheet-foot">
            {guard.confirming ? <DiscardBar onKeep={guard.keep} onDiscard={guard.discard} /> : footer}
          </div>
        )}
      </div>
    </div>,
    document.getElementById('app-frame') ?? document.body,
  );
}

/** Full-screen flow (editors, cooking mode, review screens). */
export function FullScreen({
  children,
  z = 40,
  rim = true,
  bg,
  label,
}: {
  children: ReactNode;
  z?: number;
  rim?: boolean;
  bg?: string;
  label: string;
}) {
  useOverlay();
  return createPortal(
    <div
      className="full"
      style={{ zIndex: z, background: bg }}
      role="dialog"
      aria-modal="true"
      aria-label={label}
    >
      {rim && <div className="rim" />}
      {children}
    </div>,
    document.getElementById('app-frame') ?? document.body,
  );
}
