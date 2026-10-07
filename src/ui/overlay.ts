// Tracks open sheets / full-screen flows so the Assistant button hides while
// one is open (6.10).
import { useEffect, useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function useOverlay(active = true) {
  useEffect(() => {
    if (!active) return;
    count++;
    emit();
    return () => {
      count--;
      emit();
    };
  }, [active]);
}

export function useAnyOverlayOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => count > 0,
  );
}
