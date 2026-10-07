import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAnyOverlayOpen } from './overlay';

export interface ToastOpts {
  /** Shows an Undo button */
  undo?: () => void;
  /** Error toast with a "Try again" button */
  retry?: () => void;
  error?: boolean;
  ms?: number;
}
interface ToastState extends ToastOpts {
  id: number;
  text: string;
}
interface ToastApi {
  show: (text: string, opts?: ToastOpts) => void;
  error: (text: string, retry?: () => void) => void;
  hide: () => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<ToastState | null>(null);
  // with a sheet or full-screen flow open, show toasts at the top so they don't cover the form
  const overlay = useAnyOverlayOpen();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hide = useCallback(() => setT(null), []);
  const show = useCallback((text: string, opts: ToastOpts = {}) => {
    setT({ id: Date.now(), text, ...opts });
  }, []);
  const error = useCallback((text: string, retry?: () => void) => show(text, { error: true, retry }), [show]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!t) return;
    // errors with "Try again" stay until dismissed or retried
    const ms = t.ms ?? (t.retry ? 0 : t.undo ? 6000 : 2800);
    if (ms > 0) timer.current = setTimeout(() => setT(null), ms);
    return () => clearTimeout(timer.current);
  }, [t]);

  const api = useMemo(() => ({ show, error, hide }), [show, error, hide]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {t && (
        <div
          className={`toast${t.error ? ' error' : ''}${overlay ? ' top' : ''}`}
          role={t.error ? 'alert' : 'status'}
          key={t.id}
        >
          <span className="grow">{t.text}</span>
          {t.undo && (
            <button
              type="button"
              onClick={() => {
                setT(null);
                t.undo?.();
              }}
            >
              Undo
            </button>
          )}
          {t.retry && (
            <button
              type="button"
              onClick={() => {
                setT(null);
                t.retry?.();
              }}
            >
              Try again
            </button>
          )}
          {(t.retry || t.error) && (
            <button type="button" aria-label="Dismiss" onClick={() => setT(null)}>
              ×
            </button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
