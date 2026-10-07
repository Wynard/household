import { createContext, useContext, type ReactNode } from 'react';

export interface Session {
  mode: 'mock' | 'google';
  /** signed-in member's email */
  email: string;
  signOut: () => void;
  /** mock mode: switch to the other sample person */
  switchUser?: (email: string) => void;
  /** Google mode: true while the token needs a reconnect */
  needsReconnect?: boolean;
  reconnect?: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
