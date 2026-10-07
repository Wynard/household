// Live updates: while the app is open and visible, check every 5 seconds
// whether the other person changed any file, and re-read only those.
// (Drive can't push changes to a static site, so a cheap version check is the
// way: one request lists the version of every file.)
import { useEffect } from 'react';
import type { DataStore } from '../storage/store';

// 5 s feels instant; 1 s would mostly cost battery and Drive quota (a save takes ~1 s to land anyway).
export const LIVE_SYNC_MS = 5_000;

export function useLiveSync(store: DataStore, ms = LIVE_SYNC_MS) {
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      if (busy || document.visibilityState !== 'visible' || !navigator.onLine) return;
      busy = true;
      try {
        await store.syncChanges();
      } catch {
        /* offline or signed out: the next tick or focus refetch catches up */
      } finally {
        busy = false;
      }
    };
    const h = setInterval(() => void tick(), ms);
    const onVisible = () => document.visibilityState === 'visible' && void tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(h);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, ms]);
}
