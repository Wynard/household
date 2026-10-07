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
import { ShoppingScreen } from '../features/shopping/ShoppingScreen';
import { SettingsRoutes } from '../features/settings/SettingsRoutes';
import { BudgetScreen } from '../features/budget/BudgetScreen';
import { InsightsScreen } from '../features/insights/InsightsScreen';

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Refetch when the app regains focus/visibility so you see your partner's changes.
        refetchOnWindowFocus: true,
        staleTime: 5_000,
        retry: (count, e) => count < 1 && !(e instanceof Error && /Access|Auth/.test(e.name)),
      },
    },
  });
}

/** Frame with the cobalt rim, shared by every screen. */
export function Frame({ children }: { children: ReactNode }) {
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
        <Route path="/shopping" element={<ShoppingScreen />} />
        <Route path="/budget" element={<BudgetScreen />} />
        <Route path="/insights" element={<InsightsScreen />} />
      </Route>
      <Route path="/settings/*" element={<SettingsRoutes />} />
      <Route path="*" element={<Navigate to="/stock" replace />} />
    </Routes>
  );
}

/** Everything inside the data layer: router, assistant state, frame, toasts, screens. */
export function AppShell({
  qc,
  store,
  session,
  banners,
}: {
  qc: QueryClient;
  store: DataStore;
  session: Session;
  /** status banners shown above every screen (reconnect, file access, sharing) */
  banners?: ReactNode;
}) {
  return (
    <QueryClientProvider client={qc}>
      <SessionProvider value={session}>
        <DataProvider store={store}>
          <HashRouter>
            <AssistantUiProvider>
              <Frame>
                <ToastProvider>
                  {banners}
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
  return <AppShell qc={qc} store={store} session={session} />;
}
