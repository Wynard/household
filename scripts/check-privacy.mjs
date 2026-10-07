#!/usr/bin/env node
// Privacy gate. Runs as the pre-commit hook (--staged), in CI, and by hand
// (`npm run check:privacy`). Fails on:
//   1. anything gitleaks recognises as a secret (working tree + history, or staged changes),
//   2. any email address that is not @example.com or a GitHub no-reply address,
//   3. key-shaped Google strings (AIza…, OAuth client IDs) in committed files,
//   4. commits whose author/committer is not the repo-local neutral identity, or not in UTC.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const staged = process.argv.includes('--staged');
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error(`\u2716 ${msg}`);
};
const ok = (msg) => console.log(`\u2714 ${msg}`);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function findGitleaks() {
  if (process.env.GITLEAKS_BIN && existsSync(process.env.GITLEAKS_BIN)) return process.env.GITLEAKS_BIN;
  const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' });
  if (probe.status === 0) return 'gitleaks';
  // winget installs outside the PATH of already-open shells
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const pkgs = join(local, 'Microsoft', 'WinGet', 'Packages');
    if (existsSync(pkgs)) {
      for (const d of readdirSync(pkgs)) {
        const exe = join(pkgs, d, 'gitleaks.exe');
        if (d.toLowerCase().startsWith('gitleaks') && existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

// ---------- 1. gitleaks ----------
const gitleaks = findGitleaks();
if (!gitleaks) {
  fail(
    'gitleaks is not installed. Install it (winget install Gitleaks.Gitleaks, or brew install gitleaks) and retry.',
  );
} else {
  const hasCommits = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).status === 0;
  const runs = staged
    ? [['git', '--pre-commit', '--staged', '--redact', '--no-banner', '--config', '.gitleaks.toml', '.']]
    : [
        ['dir', '--redact', '--no-banner', '--config', '.gitleaks.toml', '.'],
        ...(hasCommits ? [['git', '--redact', '--no-banner', '--config', '.gitleaks.toml', '.']] : []),
      ];
  for (const args of runs) {
    const r = spawnSync(gitleaks, args, { encoding: 'utf8' });
    if (r.status === 0) ok(`gitleaks ${args[0]}${staged ? ' (staged)' : ''}: no leaks`);
    else fail(`gitleaks ${args[0]} found possible secrets:\n${r.stdout}${r.stderr}`);
  }
}

// ---------- 2 + 3. emails and key-shaped strings in files ----------
const files = (
  staged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR'])
    : git(['ls-files', '--cached', '--others', '--exclude-standard'])
)
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !/(^|\/)package-lock\.json$/.test(f) && !f.startsWith('public/licenses/'));

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const ALLOWED_EMAIL = /(@example\.com$|@users\.noreply\.github\.com$)/i;
const KEY_SHAPES = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { name: 'Google OAuth client ID', re: /\d{6,}-[0-9a-z]{20,}\.apps\.googleusercontent\.com/ },
  { name: 'Google OAuth access token', re: /ya29\.[0-9A-Za-z_-]{20,}/ },
];

let scanned = 0;
for (const f of files) {
  if (!existsSync(f)) continue;
  let text;
  try {
    const buf = readFileSync(f);
    if (buf.includes(0)) continue; // binary
    text = buf.toString('utf8');
  } catch {
    continue;
  }
  scanned++;
  for (const m of text.matchAll(EMAIL)) {
    const addr = m[0].replace(/\.+$/, '');
    // ignore things like "font@2x.png" or npm scopes such as @fontsource/x
    if (/\.(png|jpe?g|svg|webp|css|js|ts|tsx)$/i.test(addr)) continue;
    if (!ALLOWED_EMAIL.test(addr)) fail(`${f}: email address not allowed: ${addr}`);
  }
  for (const k of KEY_SHAPES) if (k.re.test(text)) fail(`${f}: looks like a ${k.name}`);
}
ok(`scanned ${scanned} ${staged ? 'staged' : 'tracked/untracked'} files for emails and key-shaped strings`);

// ---------- 4. commit identities ----------
if (!staged) {
  const hasCommits = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).status === 0;
  if (hasCommits) {
    const log = git(['log', '--format=%an <%ae> %ad | %cn <%ce> %cd', '--date=iso-strict'])
      .trim()
      .split('\n');
    console.log('\nCommit identities (author | committer):');
    const seen = new Set();
    for (const line of log) {
      const ident = line.replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/g, '<time>');
      if (!seen.has(ident)) {
        seen.add(ident);
        console.log('  ' + ident);
      }
      const emails = line.match(EMAIL) || [];
      for (const e of emails) {
        if (!/@users\.noreply\.github\.com$/i.test(e)) {
          fail(`commit identity uses a non-noreply email: ${e}`);
        }
      }
      const zones = line.match(/[+-]\d\d:\d\d(?= |$)|Z(?= |$)/g) || [];
      for (const z of zones) if (z !== '+00:00' && z !== 'Z') fail(`commit not in UTC (${z}): ${line}`);
    }
  } else {
    ok('no commits yet');
  }
}

if (failed) {
  console.error('\nPrivacy check FAILED. Fix the issues above before committing or pushing.');
  process.exit(1);
}
console.log('\nPrivacy check passed.');
