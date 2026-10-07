// The only things this app keeps in localStorage (security rule 2b):
// the household folder ID, the Gemini key and model, UI preferences and the
// assistant conversation. Sign out wipes all of it (see wipeLocalData).
import { MockAdapter } from '../storage/mock';

const KEYS = {
  folderId: 'hh-folder-id',
  geminiKey: 'hh-gemini-key',
  geminiModel: 'hh-gemini-model',
  ui: 'hh-ui',
  chat: 'hh-chat',
} as const;

export interface UiPrefs {
  stockGroup: 'place' | 'category';
  voiceLang: 'ro-RO' | 'en-US';
  assistantOff: boolean;
  /** mock mode only: which sample person you are */
  mockUser?: string;
}
const DEFAULT_UI: UiPrefs = { stockGroup: 'place', voiceLang: 'ro-RO', assistantOff: false };

function get(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    /* storage blocked */
  }
}

export const prefs = {
  folderId: () => get(KEYS.folderId),
  setFolderId: (v: string | null) => set(KEYS.folderId, v),
  geminiKey: () => get(KEYS.geminiKey) ?? '',
  setGeminiKey: (v: string) => set(KEYS.geminiKey, v || null),
  geminiModel: () => get(KEYS.geminiModel) ?? '',
  setGeminiModel: (v: string) => set(KEYS.geminiModel, v || null),
  ui: (): UiPrefs => {
    try {
      return { ...DEFAULT_UI, ...(JSON.parse(get(KEYS.ui) ?? '{}') as Partial<UiPrefs>) };
    } catch {
      return DEFAULT_UI;
    }
  },
  setUi: (patch: Partial<UiPrefs>) => set(KEYS.ui, JSON.stringify({ ...prefs.ui(), ...patch })),
  chatRaw: () => get(KEYS.chat),
  setChatRaw: (v: string | null) => set(KEYS.chat, v),
};

/** Sign out: wipe localStorage, IndexedDB and any cached API data. */
export async function wipeLocalData() {
  for (const k of Object.values(KEYS)) set(k, null);
  MockAdapter.clearPersisted();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
  try {
    const dbs = (await indexedDB.databases?.()) ?? [];
    await Promise.all(
      dbs.map((d) =>
        d.name
          ? new Promise((r) => {
              const req = indexedDB.deleteDatabase(d.name!);
              req.onsuccess = req.onerror = req.onblocked = r;
            })
          : null,
      ),
    );
  } catch {
    /* ignore */
  }
  try {
    // The service worker only caches the app's own files; drop anything else anyway.
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !n.startsWith('workbox-precache')).map((n) => caches.delete(n)));
  } catch {
    /* ignore */
  }
}
