import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay } from './overlay';

/** Bottom sheet over the current screen. Closes on scrim tap or Escape. */
export function Sheet({
  title,
  onClose,
  children,
  z = 30,
  labelledBy,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  z?: number;
  labelledBy?: string;
}) {
  useOverlay();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return createPortal(
    <div className="overlay" style={{ zIndex: z }}>
      <button type="button" className="overlay-close" aria-label="Close" onClick={onClose} />
      <div
        className="sheet"
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
