import { useMemo, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DataProvider } from './data';
import { TabLayout } from './Layout';
import { AssistantUiProvider } from './assistantUi';
import { prefs } from './prefs';
import { ToastProvider } from '../ui/Toast';
import { SessionProvider, type Session } from '../auth/session';
import { DataStore } from '../storage/store';
import { MockAdapter } from '../storage/mock';
import { buildSeed, SEED_MEMBERS } from '../storage/seed';
import { StockScreen } from '../features/stock/StockScreen';
import { RecipesScreen } from '../features/recipes/RecipesScreen';
import { RecipeDetail } from '../features/recipes/RecipeDetail';
import { Placeholder } from '../features/Placeholder';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Refetch when the app regains focus/visibility so you see your partner's changes.
        refetchOnWindowFocus: true,
        staleTime: 5_000,
        retry: 1,
      },
    },
  });
}

/** Frame with the cobalt rim, shared by every screen. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="app" id="app-frame">
      <div className="rim" />
      {children}
    </div>
  );
}

function Routed() {
  return (
    <Routes>
      <Route element={<TabLayout />}>
        <Route path="/stock" element={<StockScreen />} />
        <Route path="/recipes" element={<RecipesScreen />} />
        <Route path="/recipes/:id" element={<RecipeDetail />} />
        <Route path="/shopping" element={<Placeholder title="Shopping" />} />
        <Route path="/budget/*" element={<Placeholder title="Budget" />} />
        <Route path="/insights" element={<Placeholder title="Insights" />} />
      </Route>
      <Route path="/settings/*" element={<Placeholder title="Settings" />} />
      <Route path="*" element={<Navigate to="/stock" replace />} />
    </Routes>
  );
}

/** Sample-data app: no Google setup needed (VITE_USE_MOCK=true). */
export function MockApp() {
  const [email, setEmail] = useState(() => prefs.ui().mockUser ?? SEED_MEMBERS[0].email);
  const emailRef = useRef(email);
  emailRef.current = email;
  const qc = useMemo(makeQueryClient, []);
  const store = useMemo(
    () => new DataStore(new MockAdapter(() => buildSeed()), qc, () => emailRef.current),
    [qc],
  );
  const session: Session = useMemo(
    () => ({
      mode: 'mock',
      email,
      signOut: () => {
        MockAdapter.clearPersisted();
        location.reload();
      },
      switchUser: (e: string) => {
        prefs.setUi({ mockUser: e });
        setEmail(e);
      },
    }),
    [email],
  );

  return (
    <QueryClientProvider client={qc}>
      <SessionProvider value={session}>
        <DataProvider store={store}>
          <HashRouter>
            <AssistantUiProvider>
              <Frame>
                <ToastProvider>
                  <Routed />
                </ToastProvider>
              </Frame>
            </AssistantUiProvider>
          </HashRouter>
        </DataProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
