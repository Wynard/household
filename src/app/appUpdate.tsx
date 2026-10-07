// New versions for an installed app that stays open. Starting the app always
// loads the latest version (index.html is never cached), but phones often just
// resume a home-screen app for days. So when the app comes back to the
// foreground (and every 30 minutes while it's open) it compares its build with
// version.json:
// - away for more than a minute and nothing being saved: reload right away
//   (it feels like a fresh start, and the screen you were on is kept);
// - otherwise: a banner offers the reload, so nothing being typed is lost.
import { useEffect, useState } from 'react';
import type { DataStore } from '../storage/store';

const CHECK_MS = 30 * 60_000;
const AWAY_MS = 60_000;

export async function reloadApp() {
  try {
    await (await navigator.serviceWorker?.getRegistration())?.update();
  } catch {
    /* no service worker */
  }
  location.reload();
}

async function latestBuild(): Promise<string | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const j = (await r.json()) as { build?: unknown };
    return typeof j.build === 'string' ? j.build : null;
  } catch {
    return null; // offline: try again next time
  }
}

/** Returns true when a newer version is ready and the banner should show. */
export function useAppUpdate(store: DataStore): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (import.meta.env.DEV) return; // the dev server has no version.json
    let hiddenAt = 0;
    const check = async (resumed: boolean) => {
      const build = await latestBuild();
      if (!build || build === __BUILD_ID__) return;
      if (resumed && !store.saving) void reloadApp();
      else setReady(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else void check(hiddenAt > 0 && Date.now() - hiddenAt > AWAY_MS);
    };
    document.addEventListener('visibilitychange', onVisibility);
    const h = setInterval(() => document.visibilityState === 'visible' && void check(false), CHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(h);
    };
  }, [store]);
  return ready;
}

export function AppUpdateBanner({ store }: { store: DataStore }) {
  const ready = useAppUpdate(store);
  if (!ready) return null;
  return (
    <button type="button" className="banner banner-cobalt" onClick={() => void reloadApp()}>
      A new version of Household is ready. Tap to reload.
    </button>
  );
}
