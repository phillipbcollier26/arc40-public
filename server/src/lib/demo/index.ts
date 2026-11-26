/**
 * Builds the FAKE demo dataset: four invented accounts and two years of a student who referees.
 * Used by `npm run demo` (port 4041), by in-app demo mode (DataStore) and by "Reset demo data".
 * Deterministic: the same `today` always gives the same accounts, transactions and amounts.
 * It writes ONLY into the folder it is given and never touches ./data.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB_FILENAME, openDatabase } from '../../db/database.js';
import { setPassword } from '../../auth/password.js';
import { createAccount } from '../accounts.js';
import { toIsoDate, type IsoDate } from '../../../../shared/dates.js';
import { makeContext } from './context.js';
import { DEMO_SEEDERS, type DemoSeeder } from './seeders.js';

export const DEMO_PASSWORD = 'demo1234';

/** Removes the database file and its WAL/SHM side files from `dir`. */
export function removeDbFiles(dir: string): void {
  for (const f of [DB_FILENAME, `${DB_FILENAME}-wal`, `${DB_FILENAME}-shm`]) {
    fs.rmSync(path.join(dir, f), { force: true });
  }
}

/**
 * `seeders` defaults to all of DEMO_SEEDERS. Tests pass a prefix (e.g. the first four) to pin a
 * baseline that later seeders, appended at the end, can never move.
 */
export async function generateDemoData(
  dir: string,
  today: IsoDate = toIsoDate(Date.now()),
  now: number = Date.now(),
  seeders: readonly DemoSeeder[] = DEMO_SEEDERS,
) {
  removeDbFiles(dir);
  const db = openDatabase(dir);
  try {
    await setPassword(db, DEMO_PASSWORD, now);
    const accounts = {
      checking: createAccount(db, { name: 'Everyday Checking', institution: 'Hometown Credit Union', type: 'checking' }, now),
      hysa: createAccount(db, { name: 'High-Yield Savings', institution: 'Greenleaf Bank', type: 'savings' }, now),
      roth: createAccount(db, { name: 'Roth IRA', institution: 'Summit Investments', type: 'roth_ira' }, now),
      brokerage: createAccount(db, { name: 'Index Brokerage', institution: 'Summit Investments', type: 'brokerage' }, now),
    };
    const ctx = makeContext(db, today, now, accounts);
    for (const seeder of seeders) seeder.run(ctx);
  } finally {
    db.close();
  }
  return { dir, password: DEMO_PASSWORD };
}
