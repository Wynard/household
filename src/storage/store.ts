// The DataStore owns the cached copy of every data file and is the only thing
// that writes. Writes are per-operation and immediate; concurrency follows 4.3:
// write with the version we last read; if the other person changed the file
// meanwhile, re-read it, re-apply our ops on top of their version, and retry.
//
// Updates are optimistic: the screen shows the confirmed server copy with every
// in-flight op applied on top, so steppers respond instantly. If a write fails,
// its ops drop out of the view again and the caller shows "Try again".
import type { QueryClient } from '@tanstack/react-query';
import {
  emptyFile,
  fileNameOnDisk,
  parseFile,
  schemaFor,
  type DataFile,
  type FileData,
} from '../domain/files';
import { SCHEMA_VERSION } from '../domain/schemas';
import { applyOne, groupByFile, type Op } from '../domain/ops';
import { ConflictError, NotFoundError, type StorageAdapter } from './adapter';

export interface Loaded<T> {
  data: T;
  /** null = the file doesn't exist in storage yet */
  version: string | null;
}

export const fileKey = (f: DataFile) => ['file', f] as const;
const MAX_ATTEMPTS = 4;

export class CommitError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'CommitError';
  }
}

type Rec = Record<string, unknown>;

/** Applies ops to a file; a missing file with an `init` op starts from that. */
function applyBatch(base: Loaded<unknown>, ops: Op[]) {
  const hasInit = ops.some((o) => o.t === 'init');
  let data = (base.version === null && hasInit ? {} : base.data) as Rec;
  const inverse: Op[] = [];
  const skipped: Op[] = [];
  for (const op of ops) {
    const r = applyOne(data, op);
    data = r.data;
    inverse.unshift(...r.inverse);
    if (!r.applied) skipped.push(op);
  }
  return { data, inverse, skipped };
}

export class DataStore {
  private queue: Promise<unknown> = Promise.resolve();
  /** Last version read from or written to storage, per file. */
  private confirmed = new Map<DataFile, Loaded<unknown>>();
  /** Op batches applied optimistically but not written yet, per file. */
  private inFlight = new Map<DataFile, Op[][]>();

  constructor(
    public adapter: StorageAdapter,
    private qc: QueryClient,
    private whoAmI: () => string,
  ) {}

  /** True while any change is still being saved. */
  get saving(): boolean {
    return [...this.inFlight.values()].some((l) => l.length > 0);
  }

  /** What the screens see: confirmed data + in-flight ops. */
  private view(f: DataFile): Loaded<unknown> | undefined {
    const c = this.confirmed.get(f);
    if (!c) return undefined;
    const batches = this.inFlight.get(f) ?? [];
    if (!batches.length) return c;
    return { data: applyBatch(c, batches.flat()).data, version: c.version };
  }

  private publish(f: DataFile) {
    const v = this.view(f);
    if (v) this.qc.setQueryData(fileKey(f), v);
  }

  private async read<F extends DataFile>(f: F): Promise<Loaded<FileData<F>>> {
    try {
      const { data, version } = await this.adapter.readJson<unknown>(f);
      return { data: parseFile(f, data), version };
    } catch (e) {
      if (e instanceof NotFoundError)
        return { data: emptyFile(f, this.whoAmI()) as FileData<F>, version: null };
      throw e;
    }
  }

  /** Query function: reads from storage and returns the optimistic view. */
  async load<F extends DataFile>(f: F): Promise<Loaded<FileData<F>>> {
    const fresh = await this.read(f);
    this.confirmed.set(f, fresh);
    return this.view(f) as Loaded<FileData<F>>;
  }

  cached<F extends DataFile>(f: F): Loaded<FileData<F>> | undefined {
    return this.qc.getQueryData<Loaded<FileData<F>>>(fileKey(f));
  }

  /** Returns the (optimistic) cached file, loading it first if needed. */
  async ensure<F extends DataFile>(f: F): Promise<Loaded<FileData<F>>> {
    return this.qc.ensureQueryData({ queryKey: fileKey(f), queryFn: () => this.load(f) });
  }

  /**
   * Applies ops: shows them immediately, then writes them. Resolves with the
   * inverse ops (for undo), computed against the exact versions written.
   * Commits are serialised so our own rapid taps never conflict.
   */
  commit(ops: Op[]): Promise<{ inverse: Op[]; skipped: Op[] }> {
    const groups = groupByFile(ops);
    const batches = new Map<DataFile, Op[]>();
    for (const [f, fileOps] of groups) {
      batches.set(f, fileOps);
      if (this.confirmed.has(f)) {
        this.inFlight.set(f, [...(this.inFlight.get(f) ?? []), fileOps]);
        this.publish(f);
      }
    }
    const run = this.queue.then(() => this.doCommit(batches));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private settle(f: DataFile, batch: Op[]) {
    const list = this.inFlight.get(f);
    if (list) {
      const i = list.indexOf(batch);
      if (i >= 0) list.splice(i, 1);
    }
    this.publish(f);
  }

  private async doCommit(batches: Map<DataFile, Op[]>): Promise<{ inverse: Op[]; skipped: Op[] }> {
    const inverse: Op[] = [];
    const skipped: Op[] = [];
    const remaining = new Map(batches);
    try {
      for (const [file, fileOps] of batches) {
        const r = await this.commitFile(file, fileOps);
        remaining.delete(file);
        this.settle(file, fileOps);
        inverse.unshift(...r.inverse);
        skipped.push(...r.skipped);
      }
      return { inverse, skipped };
    } catch (e) {
      // roll back what didn't make it; files already written stay written
      for (const [f, b] of remaining) this.settle(f, b);
      throw new CommitError(e instanceof Error ? e.message : "Couldn't save the change.", e);
    }
  }

  private async commitFile(file: DataFile, ops: Op[]) {
    let base = this.confirmed.get(file) ?? (await this.read(file));
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const { data, inverse, skipped } = applyBatch(base, ops);
      const next = {
        ...data,
        schemaVersion: SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        updatedBy: this.whoAmI(),
      };
      // Never write something we couldn't read back.
      const check = schemaFor(file).safeParse(next);
      if (!check.success) {
        const issue = check.error.issues[0];
        throw new Error(`Refused to save ${fileNameOnDisk(file)}: ${issue.path.join('.')} ${issue.message}`);
      }
      try {
        const { version } = await this.adapter.writeJson(file, check.data, base.version);
        this.confirmed.set(file, { data: check.data, version });
        return { inverse, skipped };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        // the other person saved first: take their version and re-apply our ops on top
        base = await this.read(file);
        this.confirmed.set(file, base);
      }
    }
    throw new Error(`${fileNameOnDisk(file)} keeps changing. Try again in a moment.`);
  }

  /**
   * Live updates: asks for every file's version in one call and re-reads only
   * the files the other person changed. Returns the names that changed.
   */
  async syncChanges(): Promise<DataFile[]> {
    if (!this.adapter.versions) return [];
    const remote = await this.adapter.versions();
    const changed: DataFile[] = [];
    for (const [file, local] of this.confirmed) {
      const v = remote[file];
      if (v !== undefined && v !== local.version && !this.inFlight.get(file)?.length) changed.push(file);
    }
    await Promise.all(changed.map((f) => this.qc.refetchQueries({ queryKey: fileKey(f) })));
    return changed;
  }

  /** Re-reads every cached file (used on focus so you see your partner's changes). */
  refreshAll() {
    return this.qc.invalidateQueries({ queryKey: ['file'] });
  }
}
