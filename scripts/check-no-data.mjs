#!/usr/bin/env node
/**
 * Blocks real financial data from ever being committed.
 *   --staged : check files staged for commit (used by the pre-commit hook)
 *   --all    : check every tracked file (used by GitHub Actions)
 * Exit code 1 (and a clear message) when something is blocked.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const mode = process.argv.includes('--all') ? 'all' : 'staged';

/**
 * Fake fixtures live here, so data-looking NAMES (.csv) are allowed. A real SQLite database is blocked
 * even here (audit F-07): the header check below runs before this exemption.
 */
const ALLOWED_PREFIXES = ['tests/fixtures/'];

const BLOCKED_DIRS = ['data/', 'demo-data/', 'backups/', 'exports/', 'imports/'];
const BLOCKED_EXT = [
  '.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm', '.db-journal',
  '.csv', '.tsv', '.ofx', '.qfx', '.qif', '.xlsx', '.xls', '.zip',
  '.pdf', // bank and brokerage statements
];
/** Arc40's own export: arc40.json (every table) and an unzipped export folder (arc40-export-...). */
const EXPORT_JSON = /^arc40[^/]*\.json$/;
const EXPORT_DIR = /^arc40-export-/;
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0');

function listFiles() {
  const args =
    mode === 'all'
      ? ['ls-files', '-z']
      : ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'];
  return execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
}

function readHead(file) {
  try {
    if (mode === 'staged') {
      return execFileSync('git', ['show', `:${file}`], { maxBuffer: 64 * 1024 * 1024 }).subarray(0, 16);
    }
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf;
  } catch {
    return Buffer.alloc(0);
  }
}

export function reasonToBlock(file, head) {
  const lower = file.toLowerCase();
  if (head && head.length >= 16 && head.subarray(0, 16).equals(SQLITE_MAGIC)) return 'is a SQLite database';
  if (ALLOWED_PREFIXES.some((p) => lower.startsWith(p))) return null;
  const parts = lower.split('/');
  if (parts.slice(0, -1).some((part) => EXPORT_DIR.test(part))) return 'is inside an unzipped Arc40 export';
  if (EXPORT_JSON.test(parts.at(-1) ?? '')) return 'is an Arc40 export (arc40.json holds every table)';
  if (lower.split('/').some((part, i, parts) => i < parts.length - 1 && BLOCKED_DIRS.includes(`${part}/`))) {
    return 'is inside a private data folder';
  }
  const ext = BLOCKED_EXT.find((e) => lower.endsWith(e));
  if (ext) return `has a data file extension (${ext})`;
  return null;
}

function main() {
  const blocked = [];
  for (const file of listFiles()) {
    const reason = reasonToBlock(file, readHead(file));
    if (reason) blocked.push(`  ${file}  (${reason})`);
  }

  if (blocked.length) {
    console.error('\n  Arc40 blocked this commit to protect your financial data:\n');
    console.error(blocked.join('\n'));
    console.error('\n  These files may contain real money data and must never go to GitHub.');
    console.error('  Unstage them with:  git restore --staged <file>\n');
    process.exit(1);
  }
}

// Run only when started as a script, so scripts/check-public.mjs can import reasonToBlock.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
