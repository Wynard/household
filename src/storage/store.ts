// The DataStore owns the cached copy of every data file and is the only thing
// that writes. Writes are per-operation and immediate; concurrency follows 4.3:
// write with the version we last read; if the other person changed the file
// meanwhile, re-read it, re-apply our ops on top of their version, and retry.
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

export class DataStore {
  private queue: Promise<unknown> = Promise.resolve();
  /** Files whose last write failed; ops are kept so "Try again" can resend them. */
  pending: Op[] | null = null;

  constructor(
    public adapter: StorageAdapter,
    private qc: QueryClient,
    private whoAmI: () => string,
  ) {}

  async load<F extends DataFile>(f: F): Promise<Loaded<FileData<F>>> {
    try {
      const { data, version } = await this.adapter.readJson<unknown>(f);
      return { data: parseFile(f, data), version };
    } catch (e) {
      if (e instanceof NotFoundError)
        return { data: emptyFile(f, this.whoAmI()) as FileData<F>, version: null };
      throw e;
    }
  }

  cached<F extends DataFile>(f: F): Loaded<FileData<F>> | undefined {
    return this.qc.getQueryData<Loaded<FileData<F>>>(fileKey(f));
  }

  /** Returns the cached file, loading it first if needed. */
  async ensure<F extends DataFile>(f: F): Promise<Loaded<FileData<F>>> {
    return this.qc.ensureQueryData({ queryKey: fileKey(f), queryFn: () => this.load(f) });
  }

  /**
   * Applies ops to storage. Resolves with the inverse ops (for undo), computed
   * against the exact versions that were written. Commits are serialised so
   * our own rapid taps never conflict with each other.
   */
  commit(ops: Op[]): Promise<{ inverse: Op[]; skipped: Op[] }> {
    const run = this.queue.then(() => this.doCommit(ops));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async doCommit(ops: Op[]): Promise<{ inverse: Op[]; skipped: Op[] }> {
    const inverse: Op[] = [];
    const skipped: Op[] = [];
    const groups = groupByFile(ops);
    const done: Op[] = [];
    try {
      for (const [file, fileOps] of groups) {
        const r = await this.commitFile(file, fileOps);
        inverse.unshift(...r.inverse);
        skipped.push(...r.skipped);
        done.push(...fileOps);
      }
      this.pending = null;
      return { inverse, skipped };
    } catch (e) {
      this.pending = ops.filter((o) => !done.includes(o));
      throw new CommitError(e instanceof Error ? e.message : "Couldn't save the change.", e);
    }
  }

  private async commitFile(file: DataFile, ops: Op[]) {
    let base = this.cached(file) ?? (await this.load(file));
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // A file that doesn't exist yet starts from its `init` op when there is one
      // (e.g. a new year's budget with the carried-over balance), else from defaults.
      const hasInit = ops.some((o) => o.t === 'init');
      let data = (base.version === null && hasInit ? {} : base.data) as unknown as Record<string, unknown>;
      const inverse: Op[] = [];
      const skipped: Op[] = [];
      for (const op of ops) {
        const r = applyOne(data, op);
        data = r.data;
        inverse.unshift(...r.inverse);
        if (!r.applied) skipped.push(op);
      }
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
        this.qc.setQueryData(fileKey(file), { data: check.data, version } satisfies Loaded<unknown>);
        return { inverse, skipped };
      } catch (e) {
        if (!(e instanceof ConflictError)) throw e;
        base = await this.load(file);
        this.qc.setQueryData(fileKey(file), base);
      }
    }
    throw new Error(`${fileNameOnDisk(file)} keeps changing. Try again in a moment.`);
  }

  /** Re-reads every cached file (used on focus so you see your partner's changes). */
  refreshAll() {
    return this.qc.invalidateQueries({ queryKey: ['file'] });
  }
}
