import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessNeededError, DriveAdapter } from './drive';
import { ConflictError } from './adapter';
import type { GoogleAuth } from '../auth/google';

/** A tiny in-memory Drive that understands the calls the adapter makes. */
function fakeDrive(opts: { visible?: Set<string>; failFirstAuth?: boolean } = {}) {
  const files = new Map<string, { name: string; parent: string; body: string; version: number }>();
  let n = 0;
  let authFails = opts.failFirstAuth ? 1 : 0;
  const visible = (id: string) => !opts.visible || opts.visible.has(id);
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    if (authFails > 0) {
      authFails--;
      return new Response('{}', { status: 401 });
    }
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const parent = /'([^']+)' in parents/.exec(u.searchParams.get('q') ?? '')?.[1];
      return json({
        files: [...files]
          .filter(([id, f]) => f.parent === parent && visible(id))
          .map(([id, f]) => ({ id, name: f.name, version: String(f.version) })),
      });
    }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const text = await new Response(init.body as BodyInit).text();
      const meta = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n')[0]) as {
        name: string;
        parents: string[];
      };
      const body = text.split('\r\n\r\n')[2].split('\r\n--')[0];
      const id = `f${++n}`;
      files.set(id, { name: meta.name, parent: meta.parents[0], body, version: 1 });
      return json({ id, name: meta.name, version: '1' });
    }
    const m = /\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const f = files.get(m[1]);
      if (!f || !visible(m[1])) return json({ error: { message: 'File not found' } }, 404);
      if (method === 'PATCH') {
        f.body = await new Response(init.body as BodyInit).text();
        f.version++;
        return json({ version: String(f.version) });
      }
      if (u.searchParams.get('alt') === 'media') return new Response(f.body);
      return json({ id: m[1], version: String(f.version) });
    }
    return json({}, 404);
  });
  return { files, fetchMock };
}

const auth = { getToken: async () => 't', invalidate: async () => 't2' } as unknown as GoogleAuth;

afterEach(() => vi.unstubAllGlobals());

describe('DriveAdapter', () => {
  it('creates, reads and writes with a version check', async () => {
    const { fetchMock } = fakeDrive();
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    const created: string[] = [];
    d.onFileCreated = (name) => created.push(name);
    const v1 = await d.writeJson('items', { items: [] }, null);
    expect(created).toEqual(['items']);
    const r = await d.readJson<{ items: unknown[] }>('items');
    expect(r).toEqual({ data: { items: [] }, version: v1.version });
    const v2 = await d.writeJson('items', { items: [1] }, r.version);
    expect(Number(v2.version)).toBeGreaterThan(Number(v1.version));
    // a stale version is a conflict, not an overwrite
    await expect(d.writeJson('items', { items: [2] }, r.version)).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses to create a duplicate of a file the other phone made but this phone can't open", async () => {
    const { fetchMock, files } = fakeDrive({ visible: new Set() });
    files.set('other', { name: 'budget-2027.json', parent: 'folder', body: '{}', version: 3 });
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    d.setKnownIds({ 'budget-2027': 'other' });
    const asked: string[][] = [];
    d.onAccessNeeded = (f) => asked.push(f);
    await expect(d.writeJson('budget-2027', {}, null)).rejects.toBeInstanceOf(AccessNeededError);
    await expect(d.readJson('budget-2027')).rejects.toBeInstanceOf(AccessNeededError);
    expect(asked).toEqual([['budget-2027'], ['budget-2027']]);
    expect([...files.values()].filter((f) => f.name === 'budget-2027.json')).toHaveLength(1);
    expect(await d.missingAccess()).toEqual(['budget-2027']);
  });

  it('retries once with a fresh token after a 401', async () => {
    const { fetchMock } = fakeDrive({ failFirstAuth: true });
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    await expect(d.writeJson('plan', { entries: [] }, null)).resolves.toBeDefined();
  });
});
