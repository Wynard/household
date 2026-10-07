#!/usr/bin/env node
// `npm run commit -- -m "message"`: commits with UTC timestamps so commit times
// don't reveal the local timezone. Equivalent to the repo-local alias `git c`.
import { spawnSync } from 'node:child_process';

const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+0000');
const r = spawnSync('git', ['commit', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, TZ: 'UTC', GIT_AUTHOR_DATE: now, GIT_COMMITTER_DATE: now },
});
process.exit(r.status ?? 1);
