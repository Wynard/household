// Google Identity Services, token model (4.4). The access token lives in
// memory only: never localStorage or sessionStorage. It's refreshed silently
// shortly before it expires or after a 401; if that fails (popup blocked,
// session ended) listeners are told so the UI can show "Tap to reconnect".
import { config } from '../config';
import { AuthError } from '../storage/adapter';

export const SCOPES = 'https://www.googleapis.com/auth/drive.file openid email profile';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const EARLY_REFRESH_MS = 5 * 60 * 1000;

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleGlobal {
  accounts: {
    oauth2: {
      initTokenClient(c: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
        login_hint?: string;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: GoogleGlobal;
  }
}

const scripts = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        reject(new Error("Couldn't load Google sign-in. Check your connection."));
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

export interface Profile {
  email: string;
  name: string;
}

type Listener = (state: { needsReconnect: boolean }) => void;

export class GoogleAuth {
  private token: string | null = null;
  private expiresAt = 0;
  private client: TokenClient | null = null;
  private pending: { resolve: (t: string) => void; reject: (e: Error) => void }[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<Listener>();
  profile: Profile | null = null;
  needsReconnect = false;

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }
  private emit() {
    this.listeners.forEach((l) => l({ needsReconnect: this.needsReconnect }));
  }

  private async ensureClient(): Promise<TokenClient> {
    if (this.client) return this.client;
    if (!config.googleClientId) throw new Error('Google sign-in is not set up yet. See SETUP.md.');
    await loadScript(GIS_SRC);
    const g = window.google;
    if (!g) throw new Error("Couldn't load Google sign-in.");
    this.client = g.accounts.oauth2.initTokenClient({
      client_id: config.googleClientId,
      scope: SCOPES,
      callback: (r) => this.onToken(r),
      error_callback: (e) =>
        this.fail(
          new AuthError(
            e.type === 'popup_closed'
              ? 'Sign-in was closed before it finished.'
              : "Couldn't open Google sign-in. Allow pop-ups and try again.",
          ),
        ),
    });
    return this.client;
  }

  private onToken(r: TokenResponse) {
    if (!r.access_token) {
      this.fail(new AuthError(r.error_description || "Google didn't sign you in. Try again."));
      return;
    }
    this.token = r.access_token;
    this.expiresAt = Date.now() + Number(r.expires_in ?? 3600) * 1000;
    this.needsReconnect = false;
    clearTimeout(this.timer);
    this.timer = setTimeout(
      () => void this.refreshSilently(),
      Math.max(10_000, this.expiresAt - Date.now() - EARLY_REFRESH_MS),
    );
    const p = this.pending;
    this.pending = [];
    p.forEach((x) => x.resolve(r.access_token!));
    this.emit();
  }

  private fail(e: Error) {
    const p = this.pending;
    this.pending = [];
    p.forEach((x) => x.reject(e));
  }

  /**
   * Interactive sign-in (must be called from a tap). Returning users (this
   * phone already joined a household) skip the account chooser.
   */
  async signIn(opts: { returning?: boolean } = {}): Promise<Profile> {
    const client = await this.ensureClient();
    const token = await new Promise<string>((resolve, reject) => {
      this.pending.push({ resolve, reject });
      client.requestAccessToken({
        prompt: opts.returning || this.profile ? '' : 'select_account',
        login_hint: this.profile?.email,
      });
    });
    this.profile = await fetchProfile(token);
    return this.profile;
  }

  /** Tries to get a new token without a full sign-in. Marks "needs reconnect" if it can't. */
  async refreshSilently(): Promise<string | null> {
    try {
      const client = await this.ensureClient();
      return await new Promise<string>((resolve, reject) => {
        this.pending.push({ resolve, reject });
        client.requestAccessToken({ prompt: '', login_hint: this.profile?.email });
        // popups opened without a tap are often blocked; don't wait forever
        setTimeout(() => reject(new AuthError('Reconnect needed')), 15_000);
      });
    } catch {
      this.needsReconnect = true;
      this.emit();
      return null;
    }
  }

  /** A valid token, refreshing first if it's about to expire. Throws AuthError when reconnect is needed. */
  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    const t = await this.refreshSilently();
    if (!t) throw new AuthError('Tap to reconnect to Google.');
    return t;
  }

  /** Called after a 401: drop the token and try once to get a new one. */
  async invalidate(): Promise<string | null> {
    this.token = null;
    return this.refreshSilently();
  }

  signOut() {
    clearTimeout(this.timer);
    const t = this.token;
    this.token = null;
    this.profile = null;
    if (t) window.google?.accounts.oauth2.revoke(t);
  }
}

async function fetchProfile(token: string): Promise<Profile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new AuthError("Couldn't read your Google profile.");
  const j = (await res.json()) as { email?: string; name?: string; given_name?: string };
  if (!j.email) throw new AuthError('Google did not share your email address.');
  return { email: j.email.toLowerCase(), name: j.given_name || j.name || j.email.split('@')[0] };
}
