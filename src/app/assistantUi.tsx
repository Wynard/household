// Open/close state of the Assistant panel, plus the "what am I looking at"
// context that screens publish for it (6.10). The panel itself arrives in 7b.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { prefs } from './prefs';

export interface ScreenContext {
  /** stock | recipes | recipe | plan | shopping | budget | insights */
  key: string;
  /** "Looking at Telemea omelette" */
  label: string;
  recordId?: string;
}

interface AssistantUi {
  isOpen: boolean;
  open: (opts?: { prompt?: string; draft?: string }) => void;
  close: () => void;
  disabled: boolean;
  setDisabled: (v: boolean) => void;
  context: ScreenContext;
  setContext: (c: ScreenContext) => void;
  /** a message the panel should show when it opens (e.g. "Paste the link…") */
  pendingPrompt: { prompt?: string; draft?: string } | null;
  takePrompt: () => { prompt?: string; draft?: string } | null;
}

const Ctx = createContext<AssistantUi | null>(null);

export function AssistantUiProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [disabled, setDisabledState] = useState(() => prefs.ui().assistantOff);
  const [context, setContext] = useState<ScreenContext>({ key: 'stock', label: 'Looking at Stock' });
  const [pendingPrompt, setPending] = useState<AssistantUi['pendingPrompt']>(null);

  const open = useCallback((opts?: { prompt?: string; draft?: string }) => {
    setPending(opts ?? null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const setDisabled = useCallback((v: boolean) => {
    prefs.setUi({ assistantOff: v });
    setDisabledState(v);
    if (v) setOpen(false);
  }, []);
  const takePrompt = useCallback(() => {
    const p = pendingPrompt;
    setPending(null);
    return p;
  }, [pendingPrompt]);

  const value = useMemo(
    () => ({ isOpen, open, close, disabled, setDisabled, context, setContext, pendingPrompt, takePrompt }),
    [isOpen, open, close, disabled, setDisabled, context, pendingPrompt, takePrompt],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistantUi(): AssistantUi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAssistantUi outside provider');
  return c;
}

/** Screens call this to tell the Assistant what's on screen. */
export function useScreenContext(key: string, label: string, recordId?: string) {
  const { setContext } = useAssistantUi();
  useEffect(() => {
    setContext({ key, label, recordId });
  }, [key, label, recordId, setContext]);
}
