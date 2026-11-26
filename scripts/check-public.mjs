#!/usr/bin/env node
/**
 * Checks a folder before it is published: no denied words anywhere, and no data files.
 *
 *   node scripts/check-public.mjs <folder> --denylist <file>
 *
 * Every file under <folder> is checked, except the `.git` and `node_modules` folders:
 *   1. Text files are searched for every denied term (ignoring upper and lower case). Each hit is printed as
 *      `path:line: "term"`.
 *   2. Every file, text or not, goes through the data guard's rule (reasonToBlock from check-no-data.mjs). A file
 *      the guard would block from a commit (a database, a CSV outside tests/fixtures/, an export...) is a hit too.
 * Exit code 0 = clean, 1 = at least one hit, 2 = the command was used wrongly.
 *
 * Denylist format (plain text, one entry per line):
 *   # a comment
 *   Some Term                      a denied term: matched anywhere, ignoring case
 *
 *   [allow]
 *   Some Term => path/one.ts, path/two.md
 *                                  below [allow]: that exact term may appear in those exact files
 *                                  (paths relative to <folder>, with / as the separator)
 *
 * The denylist itself is private: keep it outside the folder you check, and never commit it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reasonToBlock } from './check-no-data.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Parses denylist text into { terms: string[], allow: Map<lowercase term, Set<path>> }. */
export function parseDenylist(text) {
  const terms = [];
  const allow = new Map();
  let inAllow = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.toLowerCase() === '[allow]') {
      inAllow = true;
      continue;
    }
    if (!inAllow) {
      terms.push(line);
      continue;
    }
    const at = line.indexOf('=>');
    if (at < 0) throw new Error(`Allow line needs "term => file, file": ${line}`);
    const term = line.slice(0, at).trim().toLowerCase();
    const files = line
      .slice(at + 2)
      .split(',')
      .map((f) => f.trim().replace(/\\/g, '/'))
      .filter(Boolean);
    if (!term || files.length === 0) throw new Error(`Allow line needs "term => file, file": ${line}`);
    const set = allow.get(term) ?? new Set();
    for (const f of files) set.add(f);
    allow.set(term, set);
  }
  return { terms, allow };
}

/** Every file under `root` (relative paths with /), skipping .git and node_modules. */
export function listAllFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        out.push(path.relative(root, path.join(dir, entry.name)).split(path.sep).join('/'));
      }
    }
  };
  walk(root);
  return out.sort();
}

const isText = (buf) => !buf.subarray(0, 8192).includes(0);

/** Returns every hit in `root`: { file, line?, term?, reason? }. */
export function scanFolder(root, denylist) {
  const hits = [];
  const terms = denylist.terms.map((t) => ({ term: t, lower: t.toLowerCase() }));
  for (const file of listAllFiles(root)) {
    const buf = fs.readFileSync(path.join(root, file));
    const reason = reasonToBlock(file, buf.subarray(0, 16));
    if (reason) hits.push({ file, reason });
    if (!isText(buf)) continue;
    const lines = buf.toString('utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      const lower = text.toLowerCase();
      for (const { term, lower: t } of terms) {
        if (!lower.includes(t)) continue;
        if (denylist.allow.get(t)?.has(file)) continue;
        hits.push({ file, line: i + 1, term });
      }
    });
  }
  return hits;
}

function main(argv) {
  const at = argv.indexOf('--denylist');
  const listFile = at >= 0 ? argv[at + 1] : undefined;
  const folder = argv.find((a, i) => !a.startsWith('--') && i !== at + 1);
  if (!folder || !listFile) {
    console.error('Usage: node scripts/check-public.mjs <folder> --denylist <file>');
    return 2;
  }
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    console.error(`Not a folder: ${folder}`);
    return 2;
  }
  if (!fs.existsSync(listFile)) {
    console.error(`Denylist not found: ${listFile}`);
    return 2;
  }
  let denylist;
  try {
    denylist = parseDenylist(fs.readFileSync(listFile, 'utf8'));
  } catch (e) {
    console.error(e.message);
    return 2;
  }
  const root = path.resolve(folder);
  const hits = scanFolder(root, denylist);
  const files = listAllFiles(root).length;
  if (hits.length === 0) {
    console.log(`check-public: ${files} files checked, ${denylist.terms.length} denied terms, 0 hits.`);
    return 0;
  }
  for (const h of hits) {
    console.log(h.reason ? `${h.file}: ${h.reason}` : `${h.file}:${h.line}: "${h.term}"`);
  }
  console.log(`\ncheck-public: ${hits.length} hit(s) in ${files} files. Fix them before publishing.`);
  return 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
