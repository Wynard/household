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

describe('reading a budget spreadsheet from Drive', () => {
  const CSV = 'Date,Amount\n7/2/2026,"RON2,000.00"\n';
  /** Sheets export as CSV, Excel files are copied into Sheets first, CSV files download. */
  function fakeSheets(opts: { failExport?: boolean } = {}) {
    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
      const u = new URL(url);
      const method = init.method ?? 'GET';
      calls.push(`${method} ${u.pathname}${u.search}`);
      if (u.pathname.endsWith('/export')) {
        expect(u.searchParams.get('mimeType')).toBe('text/csv');
        return opts.failExport ? new Response('{}', { status: 500 }) : new Response(CSV);
      }
      if (u.pathname.endsWith('/copy')) {
        expect(JSON.parse(String(init.body))).toMatchObject({
          mimeType: 'application/vnd.google-apps.spreadsheet',
        });
        return new Response(JSON.stringify({ id: 'tmp' }), { status: 200 });
      }
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (u.searchParams.get('alt') === 'media') return new Response('Data;Suma\n02.07.2026;12,50');
      return new Response('{}', { status: 404 });
    });
    return { fetchMock, calls };
  }

  it('exports a Google Sheet as CSV', async () => {
    const { fetchMock, calls } = fakeSheets();
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    const text = await d.readSheetAsCsv({ id: 's1', mimeType: 'application/vnd.google-apps.spreadsheet' });
    expect(text).toBe(CSV);
    expect(calls).toEqual(['GET /drive/v3/files/s1/export?mimeType=text%2Fcsv']);
  });

  it('turns an Excel file into a temporary Google Sheet, exports it, and deletes the copy', async () => {
    const { fetchMock, calls } = fakeSheets();
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    expect(await d.readSheetAsCsv({ id: 'x1', mimeType: xlsx })).toBe(CSV);
    expect(calls).toEqual([
      'POST /drive/v3/files/x1/copy?fields=id',
      'GET /drive/v3/files/tmp/export?mimeType=text%2Fcsv',
      'DELETE /drive/v3/files/tmp',
    ]);
  });

  it('deletes the temporary copy even when the export fails', async () => {
    const { fetchMock, calls } = fakeSheets({ failExport: true });
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    await expect(d.readSheetAsCsv({ id: 'x1', mimeType: 'application/vnd.ms-excel' })).rejects.toThrow(
      /Google Drive error 500/,
    );
    expect(calls.at(-1)).toBe('DELETE /drive/v3/files/tmp');
  });

  it('reads a CSV file as it is', async () => {
    const { fetchMock } = fakeSheets();
    vi.stubGlobal('fetch', fetchMock);
    const d = new DriveAdapter(auth, 'folder');
    expect(await d.readSheetAsCsv({ id: 'c1', mimeType: 'text/csv' })).toBe('Data;Suma\n02.07.2026;12,50');
  });
});
