// Drive API v3 over fetch, with the signed-in person's token (4.1, 4.4).
//
// Scope is drive.file only: the app can open files it created for this person
// or that this person picked in the Google Picker. Files the *other* person's
// phone created may not be visible here until picked, so household.json keeps
// the Drive ID of every data file (fileIds). A file that is listed there but
// can't be opened raises AccessNeededError (never a duplicate file).
import { fileNameOnDisk, type DataFile } from '../domain/files';
import { AuthError, ConflictError, NotFoundError, type StorageAdapter } from './adapter';
import type { GoogleAuth } from '../auth/google';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export class AccessNeededError extends Error {
  constructor(public files: string[]) {
    super("Some household files aren't shared with this phone yet.");
    this.name = 'AccessNeededError';
  }
}

export class DriveError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  version?: string;
}

export interface Permission {
  id: string;
  type: 'user' | 'group' | 'domain' | 'anyone';
  role: string;
  emailAddress?: string;
  domain?: string;
}

export class DriveAdapter implements StorageAdapter {
  /** data file name -> Drive ID, for files this phone can open */
  private index = new Map<string, string>();
  /** data file name -> Drive ID from household.fileIds (may not be openable yet) */
  private known = new Map<string, string>();
  private indexed: Promise<void> | null = null;
  private subfolders = new Map<string, string>();
  /** Called after this phone creates a data file, so its ID is recorded in household.fileIds. */
  onFileCreated?: (name: DataFile, id: string) => void;
  /** Called when a known file can't be opened (to show "give this phone access"). */
  onAccessNeeded?: (files: string[]) => void;

  constructor(
    private auth: GoogleAuth,
    public folderId: string,
  ) {}

  // ---------- low-level ----------
  async req(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.auth.getToken();
    const res = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 && retry) {
      const t = await this.auth.invalidate();
      if (!t) throw new AuthError('Tap to reconnect to Google.');
      return this.req(url, init, false);
    }
    if (res.status === 429 || res.status === 503)
      throw new DriveError('Google Drive is busy. Try again in a moment.', res.status);
    return res;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await this.req(url, init);
    if (!res.ok) throw await driveError(res);
    return (await res.json()) as T;
  }

  /** Lists every file this phone can see in a folder. */
  async listFolder(folderId = this.folderId): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
      const r = await this.json<{ files: DriveFile[]; nextPageToken?: string }>(
        `${API}/files?q=${q}&fields=nextPageToken,files(id,name,mimeType,version)&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      out.push(...r.files);
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** Re-reads which data files this phone can open (after a Picker grant). */
  refreshIndex() {
    this.indexed = (async () => {
      const files = await this.listFolder();
      this.index.clear();
      for (const f of files)
        if (f.name.endsWith('.json') && f.mimeType !== FOLDER_MIME)
          this.index.set(f.name.replace(/\.json$/, ''), f.id);
    })();
    return this.indexed;
  }

  private async ensureIndex() {
    if (!this.indexed) await this.refreshIndex();
    else await this.indexed;
  }

  setKnownIds(ids: Record<string, string> | undefined) {
    this.known = new Map(Object.entries(ids ?? {}));
  }

  /** Names listed in household.fileIds that this phone can't open yet. */
  async missingAccess(): Promise<string[]> {
    await this.ensureIndex();
    return [...this.known.keys()].filter((n) => !this.index.has(n));
  }

  // ---------- StorageAdapter ----------
  async readJson<T>(name: DataFile): Promise<{ data: T; version: string }> {
    await this.ensureIndex();
    const id = this.index.get(name) ?? this.known.get(name);
    if (!id) throw new NotFoundError(name);
    const meta = await this.req(`${API}/files/${id}?fields=id,version,trashed`);
    if (meta.status === 404 || meta.status === 403) {
      if (this.known.has(name)) {
        this.onAccessNeeded?.([name]);
        throw new AccessNeededError([name]);
      }
      throw new NotFoundError(name);
    }
    if (!meta.ok) throw await driveError(meta);
    const m = (await meta.json()) as { version: string; trashed?: boolean };
    if (m.trashed)
      throw new DriveError(`${fileNameOnDisk(name)} is in the Drive bin. Restore it in Google Drive.`, 410);
    this.index.set(name, id);
    const body = await this.req(`${API}/files/${id}?alt=media`);
    if (!body.ok) throw await driveError(body);
    const text = await body.text();
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new DriveError(
        `${fileNameOnDisk(name)} in Drive isn't valid JSON. Restore it from a backup.`,
        422,
      );
    }
    return { data, version: m.version };
  }

  async writeJson<T>(name: DataFile, data: T, expectedVersion: string | null): Promise<{ version: string }> {
    await this.ensureIndex();
    const body = JSON.stringify(data);
    const id = this.index.get(name);
    if (!id) {
      if (this.known.has(name)) {
        // it exists, the other phone made it: don't create a duplicate
        this.onAccessNeeded?.([name]);
        throw new AccessNeededError([name]);
      }
      if (expectedVersion !== null) throw new ConflictError(name);
      const created = await this.createFile(
        `${name}.json`,
        'application/json',
        new Blob([body], { type: 'application/json' }),
        this.folderId,
      );
      this.index.set(name, created.id);
      this.onFileCreated?.(name, created.id);
      return { version: created.version ?? '1' };
    }
    // 4.3: check the current version right before writing
    const cur = await this.json<{ version: string }>(`${API}/files/${id}?fields=version`);
    if (cur.version !== expectedVersion) throw new ConflictError(name);
    const res = await this.json<{ version: string }>(
      `${UPLOAD}/files/${id}?uploadType=media&fields=version`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body,
      },
    );
    return { version: res.version };
  }

  async uploadImage(path: string, blob: Blob): Promise<{ fileId: string }> {
    // path like "receipts/2026/2026-10-07-lidl-1.jpg"
    const parts = path.split('/');
    const fileName = parts.pop()!;
    let parent = this.folderId;
    for (const p of parts) parent = await this.subfolder(parent, p);
    const f = await this.createFile(fileName, blob.type || 'image/jpeg', blob, parent);
    return { fileId: f.id };
  }

  async getImageUrl(fileId: string): Promise<string> {
    const res = await this.req(`${API}/files/${fileId}?alt=media`);
    if (res.status === 403 || res.status === 404) throw new PhotoNotSharedError(fileId);
    if (!res.ok) throw await driveError(res);
    return URL.createObjectURL(await res.blob());
  }

  async deleteImage(fileId: string): Promise<void> {
    const res = await this.req(`${API}/files/${fileId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw await driveError(res);
  }

  // ---------- setup and sharing ----------
  private async subfolder(parent: string, name: string): Promise<string> {
    const key = `${parent}/${name}`;
    const cached = this.subfolders.get(key);
    if (cached) return cached;
    const q = encodeURIComponent(
      `'${parent}' in parents and name = '${name.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    );
    const r = await this.json<{ files: DriveFile[] }>(`${API}/files?q=${q}&fields=files(id)`);
    const id = r.files[0]?.id ?? (await createFolder(this, name, parent)).id;
    this.subfolders.set(key, id);
    return id;
  }

  async createFile(name: string, mimeType: string, blob: Blob, parent: string): Promise<DriveFile> {
    const meta = { name, mimeType, parents: [parent] };
    const boundary = `hh-${crypto.randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ]);
    return this.json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=id,name,version`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async permissions(fileId = this.folderId): Promise<Permission[]> {
    const r = await this.json<{ permissions: Permission[] }>(
      `${API}/files/${fileId}/permissions?fields=permissions(id,type,role,emailAddress,domain)`,
    );
    return r.permissions;
  }

  async removePermission(permissionId: string, fileId = this.folderId) {
    const res = await this.req(`${API}/files/${fileId}/permissions/${permissionId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw await driveError(res);
  }

  /** Shares the household folder with the partner as an editor. */
  async shareWith(email: string, fileId = this.folderId) {
    await this.json(`${API}/files/${fileId}/permissions?sendNotificationEmail=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    });
  }
}

export class PhotoNotSharedError extends Error {
  constructor(public fileId: string) {
    super(
      "This photo was added from the other phone and isn't shared with this one. Open it in Google Drive.",
    );
    this.name = 'PhotoNotSharedError';
  }
}

export const driveFileLink = (id: string) => `https://drive.google.com/file/d/${encodeURIComponent(id)}/view`;
export const driveFolderLink = (id: string) =>
  `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`;

export async function createFolder(
  d: DriveAdapter | { req: DriveAdapter['req'] },
  name: string,
  parent?: string,
): Promise<DriveFile> {
  const res = await d.req(`${API}/files?fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parent ? { parents: [parent] } : {}) }),
  });
  if (!res.ok) throw await driveError(res);
  return (await res.json()) as DriveFile;
}

async function driveError(res: Response): Promise<Error> {
  let msg = '';
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    msg = j.error?.message ?? '';
  } catch {
    /* not json */
  }
  if (res.status === 401) return new AuthError('Tap to reconnect to Google.');
  if (res.status === 403)
    return new DriveError(
      `Google Drive refused this${msg ? `: ${msg}` : '.'} Check that the folder is shared with you.`,
      403,
    );
  if (res.status === 404) return new DriveError("That file isn't in Google Drive any more.", 404);
  return new DriveError(`Google Drive error ${res.status}${msg ? `: ${msg}` : ''}`, res.status);
}

/**
 * Sharing check (2b): the household folder must be shared only with the two
 * members. Returns the permissions that shouldn't be there.
 */
export function unsafePermissions(perms: Permission[], memberEmails: string[]): Permission[] {
  const ok = new Set(memberEmails.map((e) => e.toLowerCase()));
  return perms.filter(
    (p) =>
      p.type === 'anyone' ||
      p.type === 'domain' ||
      p.type === 'group' ||
      (p.type === 'user' && !ok.has((p.emailAddress ?? '').toLowerCase())),
  );
}
