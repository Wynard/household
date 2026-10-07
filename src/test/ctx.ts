// Test helpers: a Ctx built from the seed data.
import { buildSeed, SEED_MEMBERS } from '../storage/seed';
import { filesToSnapshot } from '../domain/actions/run';
import type { Ctx, Snapshot } from '../domain/actions/types';
import type { FileMap } from '../domain/ops';
import { parseFile, type DataFile } from '../domain/files';

export const TODAY = '2026-10-07';

export function seedSnapshot(today = TODAY): Snapshot {
  const raw = buildSeed(today);
  const files: FileMap = {};
  for (const [k, v] of Object.entries(raw)) files[k as DataFile] = parseFile(k as DataFile, v);
  return filesToSnapshot(files);
}

export function makeCtx(snap: Snapshot = seedSnapshot(), opts: { actor?: string; me?: number } = {}): Ctx {
  let n = 0;
  const me = SEED_MEMBERS[opts.me ?? 0];
  return {
    snap,
    me,
    actor: opts.actor ?? me.name,
    today: TODAY,
    now: `${TODAY}T12:00:00.000Z`,
    newId: () => `new-${++n}`,
  };
}
