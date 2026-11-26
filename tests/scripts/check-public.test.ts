/**
 * scripts/check-public.mjs: the check run on a folder before it is published. Made-up terms only.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs script without type declarations
import { parseDenylist, scanFolder } from '../../scripts/check-public.mjs';

const SCRIPT = path.resolve('scripts/check-public.mjs');
let dir: string;
let folder: string;
let listFile: string;

const write = (rel: string, content: string | Buffer) => {
  const p = path.join(folder, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const denylist = (text: string) => fs.writeFileSync(listFile, text);
const run = (...args: string[]) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });
const check = () => run(folder, '--denylist', listFile);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-public-'));
  folder = path.join(dir, 'repo');
  fs.mkdirSync(folder);
  listFile = path.join(dir, 'denylist.txt'); // outside the folder, like the real one
  denylist('# made-up terms\nExampleBank\nJane Placeholder\n');
});

describe('check-public', () => {
  it('passes on a clean folder', () => {
    write('README.md', '# Demo app\nNothing personal here.\n');
    write('src/app.ts', 'export const x = 1;\n');
    const r = check();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('0 hits');
  });

  it('catches a planted term and prints the file and line', () => {
    write('docs/notes.md', 'line one\nmoney at ExampleBank today\n');
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('docs/notes.md:2: "ExampleBank"');
  });

  it('ignores upper and lower case, and finds every hit', () => {
    write('a.ts', '// EXAMPLEBANK\n');
    write('b.ts', 'const s = "examplebank and jane placeholder";\n');
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('a.ts:1: "ExampleBank"');
    expect(r.stdout).toContain('b.ts:1: "ExampleBank"');
    expect(r.stdout).toContain('b.ts:1: "Jane Placeholder"');
  });

  it('respects an allowed term in exactly the listed files, and nowhere else', () => {
    denylist('ExampleBank\n\n[allow]\nexamplebank => src/presets.ts, tests/presets.test.ts\n');
    write('src/presets.ts', "export const NAME = 'ExampleBank';\n");
    write('tests/presets.test.ts', "expect(name).toBe('ExampleBank');\n");
    expect(check().status).toBe(0);
    write('docs/about.md', 'Built for ExampleBank users.\n');
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('docs/about.md:1: "ExampleBank"');
    expect(r.stdout).not.toContain('src/presets.ts');
  });

  it('fails when a file the data guard would block is present', () => {
    write('statement.csv', 'Date,Amount\n');
    write('data/notes.txt', 'private folder\n');
    write('tests/fixtures/csv/sample.csv', 'Date,Amount\n'); // fake fixtures are allowed
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('statement.csv: has a data file extension (.csv)');
    expect(r.stdout).toContain('data/notes.txt: is inside a private data folder');
    expect(r.stdout).not.toContain('tests/fixtures/csv/sample.csv');
  });

  it('catches a database by its header even with an innocent name, and skips the text search of binary files', () => {
    write('img/picture.png', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from([0, 1, 2])]));
    write('img/logo.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]), Buffer.from('ExampleBank')]));
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('img/picture.png: is a SQLite database');
    expect(r.stdout).not.toContain('img/logo.png');
  });

  it('skips .git and node_modules', () => {
    write('.git/config', 'ExampleBank\n');
    write('node_modules/pkg/index.js', 'ExampleBank\n');
    expect(check().status).toBe(0);
  });

  it('refuses to run without a folder or a denylist (exit 2)', () => {
    expect(run(folder).status).toBe(2);
    expect(run('--denylist', listFile).status).toBe(2);
    expect(run(folder, '--denylist', path.join(dir, 'missing.txt')).status).toBe(2);
    denylist('ExampleBank\n[allow]\nno arrow here\n');
    expect(check().status).toBe(2);
  });

  it('parses the denylist and scans in code too', () => {
    const list = parseDenylist('# c\nExampleBank\n\n[allow]\nExampleBank => a.ts,b.ts\n');
    expect(list.terms).toEqual(['ExampleBank']);
    expect([...list.allow.get('examplebank')]).toEqual(['a.ts', 'b.ts']);
    write('a.ts', 'ExampleBank\n');
    write('c.ts', 'x\nExampleBank\n');
    expect(scanFolder(folder, list)).toEqual([{ file: 'c.ts', line: 2, term: 'ExampleBank' }]);
  });
});
