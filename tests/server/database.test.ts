import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/src/db/database.js';
import { getSetting, setSetting } from '../../server/src/lib/settings.js';

describe('database', () => {
  it('creates the file in the data folder and migrates once', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-db-'));
    const db1 = openDatabase(dir);
    const count = () =>
      (db1.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n;
    const n = count();
    expect(n).toBeGreaterThan(0);
    db1.close();
    const db2 = openDatabase(dir);
    expect((db2.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(n);
    db2.close();
    expect(fs.existsSync(path.join(dir, 'arc40.db'))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('no money column is ever declared REAL/FLOAT', () => {
    const db = openDatabase(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    for (const { name } of tables) {
      const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(name)})`).all() as {
        name: string;
        type: string;
      }[];
      for (const c of cols) {
        expect(c.type.toUpperCase(), `${name}.${c.name}`).not.toMatch(/REAL|FLOA|DOUB|NUMERIC|DECIMAL/);
        if (c.name.endsWith('_cents')) expect(c.type.toUpperCase()).toBe('INTEGER');
      }
    }
  });

  it('settings fall back to defaults and persist', () => {
    const db = openDatabase(':memory:');
    expect(getSetting(db, 'session_idle_minutes')).toBe(60);
    setSetting(db, 'session_idle_minutes', 15);
    expect(getSetting(db, 'session_idle_minutes')).toBe(15);
  });
});
