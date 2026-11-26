import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { generateDemoData, DEMO_PASSWORD } from '../../scripts/generate-demo-data.js';
import { openDatabase } from '../../server/src/db/database.js';
import { verifyPassword, getPasswordHash } from '../../server/src/auth/password.js';

describe('demo data generator', () => {
  it('builds a fake, repeatable dataset with integer balances only', async () => {
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-demo-'));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-demo-'));
    await generateDemoData(dir1, '2026-11-11');
    await generateDemoData(dir2, '2026-11-11');

    const read = (dir: string) => {
      const db = openDatabase(dir);
      const rows = db
        .prepare('SELECT account_id, as_of, balance_cents, typeof(balance_cents) AS t FROM balance_snapshots ORDER BY account_id, as_of')
        .all() as { account_id: number; as_of: string; balance_cents: number; t: string }[];
      const accounts = db.prepare('SELECT name, type FROM accounts ORDER BY id').all();
      const hash = getPasswordHash(db)!;
      db.close();
      return { rows, accounts, hash };
    };
    const a = read(dir1);
    const b = read(dir2);

    expect(a.accounts.map((x) => (x as { type: string }).type)).toEqual(['checking', 'savings', 'roth_ira', 'brokerage']);
    expect(a.rows.length).toBeGreaterThan(30);
    expect(a.rows.every((r) => r.t === 'integer')).toBe(true);
    expect(a.rows.at(-1)!.as_of).toBe('2026-11-11');
    expect(a.rows.map((r) => r.balance_cents)).toEqual(b.rows.map((r) => r.balance_cents)); // repeatable
    expect(await verifyPassword(a.hash, DEMO_PASSWORD)).toBe(true);

    for (const d of [dir1, dir2]) fs.rmSync(d, { recursive: true, force: true });
  });
});
