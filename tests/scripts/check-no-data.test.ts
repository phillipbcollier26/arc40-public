import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve('scripts/check-no-data.mjs');
let repo: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
const write = (rel: string, content: string | Buffer) => {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};
const check = (mode = '--staged') => spawnSync('node', [SCRIPT, mode], { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-guard-'));
  git('init', '-q');
});

describe('data-file guard', () => {
  it('allows normal code', () => {
    write('server/src/x.ts', 'export const a = 1;');
    git('add', '-A');
    expect(check().status).toBe(0);
  });

  it.each([
    ['data/arc40.db', 'x'],
    ['data/notes.txt', 'anything in data/'],
    ['statement.csv', 'Date,Amount\n'],
    ['nested/dir/wpcu.CSV', 'Date,Amount\n'],
    ['backups/arc40-2026-11-11.db', 'x'],
    ['export.zip', 'x'],
    ['fidelity.ofx', 'x'],
    ['arc40.db-wal', 'x'],
  ])('blocks %s', (file, content) => {
    write(file, content);
    git('add', '-f', file);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(file);
  });

  it('blocks a SQLite database even when it is renamed', () => {
    write('innocent.txt', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]));
    git('add', 'innocent.txt');
    expect(check().status).toBe(1);
  });

  it('allows fake CSV fixtures under tests/fixtures', () => {
    write('tests/fixtures/csv/wpcu-sample.csv', 'Date,Amount\n2026-01-01,1.00\n');
    git('add', '-f', 'tests/fixtures/csv/wpcu-sample.csv');
    expect(check().status).toBe(0);
  });

  it('--all mode checks every tracked file (used in GitHub Actions)', () => {
    write('leak.csv', 'x');
    git('add', '-f', 'leak.csv');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x', '--no-verify');
    expect(check('--all').status).toBe(1);
  });
});

describe('.gitignore', () => {
  it('ignores the data folder, databases, CSVs and backups', () => {
    fs.copyFileSync(path.resolve('.gitignore'), path.join(repo, '.gitignore'));
    for (const f of ['data/arc40.db', 'x.csv', 'backups/b.db', 'a.sqlite', 'arc40.db-wal', 'exports/e.zip']) {
      write(f, 'x');
    }
    write('tests/fixtures/ok.csv', 'x');
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: repo,
      encoding: 'utf8',
    });
    expect(status).not.toMatch(/arc40\.db|x\.csv|b\.db|a\.sqlite|e\.zip/);
    expect(status).toContain('tests/fixtures/ok.csv');
  });
});

// Audit F-07: data that slipped past the guard and .gitignore before.
describe('audit F-07: exports, PDFs, the old demo/ exemption and databases in fixtures', () => {
  const SQLITE = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100)]);

  it.each([
    ['arc40.json', '{"accounts":[]}'],
    ['notes/arc40-backup.json', '{}'],
    ['arc40-export-2026-11-16/README.txt', 'what is inside'],
    ['arc40-export-2026-11-16/csv/accounts.txt', 'renamed table'],
    ['statement.pdf', '%PDF-1.7'],
    ['Downloads/Statement Nov.PDF', '%PDF-1.4'],
    ['demo/arc40.db', 'x'],
    ['demo/bank.csv', 'Date,Amount\n'],
  ])('blocks %s', (file, content) => {
    write(file, content);
    git('add', '-f', file);
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(file);
  });

  it('blocks a SQLite database even inside tests/fixtures (renamed or not)', () => {
    for (const f of ['tests/fixtures/real.db', 'tests/fixtures/csv/looks-fine.csv']) {
      write(f, SQLITE);
      git('add', '-f', f);
    }
    const r = check();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('tests/fixtures/real.db');
    expect(r.stderr).toContain('tests/fixtures/csv/looks-fine.csv');
  });

  it('still allows the fake CSV fixtures and normal JSON files', () => {
    write('tests/fixtures/csv/fake.csv', 'Date,Amount\n2026-01-01,1.00\n');
    write('tests/server/__golden__/totals.json', '{}');
    write('package.json', '{}');
    git('add', '-f', '-A');
    expect(check().status).toBe(0);
  });

  it('.gitignore ignores exports (JSON and unzipped folders) and PDFs', () => {
    fs.copyFileSync(path.resolve('.gitignore'), path.join(repo, '.gitignore'));
    for (const f of ['arc40.json', 'arc40-export-2026-11-16/README.txt', 'statement.pdf', 'package.json']) write(f, 'x');
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' });
    expect(status).not.toMatch(/arc40\.json|arc40-export|statement\.pdf/);
    expect(status).toContain('package.json');
  });
});
