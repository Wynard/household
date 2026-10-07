// In-memory + localStorage adapter so the whole app runs with sample data and
// no Google setup (VITE_USE_MOCK=true). Only fictional seed data ever lives here.
import { fileNameOnDisk, type DataFile } from '../domain/files';
import { ConflictError, NotFoundError, type StorageAdapter } from './adapter';

const PREFIX = 'hh-mock-v1:';
const LATENCY_MS = 120;
const wait = () => new Promise((r) => setTimeout(r, LATENCY_MS));

interface Stored {
  data: unknown;
  version: string;
}

export class MockAdapter implements StorageAdapter {
  private mem = new Map<string, Stored>();
  private images = new Map<string, Blob>();
  private persist: boolean;
  private latency: boolean;
  /** Test hook: makes the next write of this file fail as if the network dropped. */
  failNextWrite: DataFile | null = null;

  constructor(
    seed: Partial<Record<DataFile, unknown>> | (() => Partial<Record<DataFile, unknown>>),
    opts: { persist?: boolean; latency?: boolean } = {},
  ) {
    this.persist = opts.persist ?? typeof localStorage !== 'undefined';
    this.latency = opts.latency ?? true;
    let loaded = false;
    if (this.persist) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(PREFIX)) {
            this.mem.set(k.slice(PREFIX.length), JSON.parse(localStorage.getItem(k) ?? 'null') as Stored);
            loaded = true;
          }
        }
      } catch {
        /* storage blocked: stay in memory */
      }
    }
    if (!loaded) {
      const s = typeof seed === 'function' ? seed() : seed;
      for (const [k, v] of Object.entries(s)) this.save(k, { data: v, version: '1' });
    }
  }

  private save(name: string, s: Stored) {
    this.mem.set(name, s);
    if (this.persist) {
      try {
        localStorage.setItem(PREFIX + name, JSON.stringify(s));
      } catch {
        /* quota or blocked: memory still has it */
      }
    }
  }

  /** Picks up writes from another tab (so two tabs act like two phones). */
  private refresh(name: string) {
    if (!this.persist) return;
    try {
      const raw = localStorage.getItem(PREFIX + name);
      if (raw) this.mem.set(name, JSON.parse(raw) as Stored);
    } catch {
      /* keep memory */
    }
  }

  async readJson<T>(name: DataFile): Promise<{ data: T; version: string }> {
    if (this.latency) await wait();
    this.refresh(name);
    const s = this.mem.get(name);
    if (!s) throw new NotFoundError(name);
    return { data: structuredClone(s.data) as T, version: s.version };
  }

  async writeJson<T>(name: DataFile, data: T, expectedVersion: string | null): Promise<{ version: string }> {
    if (this.latency) await wait();
    if (this.failNextWrite === name) {
      this.failNextWrite = null;
      throw new Error(`Couldn't save ${fileNameOnDisk(name)}. Check your connection.`);
    }
    this.refresh(name);
    const cur = this.mem.get(name);
    const curVersion = cur?.version ?? null;
    if (curVersion !== expectedVersion) throw new ConflictError(name);
    const version = String(Number(curVersion ?? '0') + 1);
    this.save(name, { data: structuredClone(data), version });
    return { version };
  }

  async versions(): Promise<Partial<Record<DataFile, string>>> {
    if (this.latency) await wait();
    for (const k of [...this.mem.keys()]) this.refresh(k);
    return Object.fromEntries([...this.mem].map(([k, v]) => [k, v.version])) as Partial<
      Record<DataFile, string>
    >;
  }

  /** Simulates the partner editing a file (used by tests and the dev tools). */
  externalEdit(name: DataFile, fn: (data: unknown) => unknown) {
    const cur = this.mem.get(name);
    if (!cur) return;
    this.save(name, { data: fn(structuredClone(cur.data)), version: String(Number(cur.version) + 1) });
  }

  async uploadImage(path: string, blob: Blob): Promise<{ fileId: string }> {
    if (this.latency) await wait();
    const fileId = `mock-img-${crypto.randomUUID()}`;
    this.images.set(fileId, blob);
    void path;
    return { fileId };
  }

  async getImageUrl(fileId: string): Promise<string> {
    const b = this.images.get(fileId);
    if (!b) throw new Error('This receipt photo is only kept until the sample app reloads.');
    return URL.createObjectURL(b);
  }

  async deleteImage(fileId: string): Promise<void> {
    this.images.delete(fileId);
  }

  /** Wipes persisted mock data (Sign out / reset sample data). */
  static clearPersisted() {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX)) keys.push(k);
      }
      keys.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
  }
}
