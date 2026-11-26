/**
 * Restore Arc40 from a backup or an export.
 *   1. Quit Arc40 (close its Terminal window).
 *   2. npm run restore -- ~/Arc40Backups/arc40-backup-2026-11-11-093000.db
 *      (an export's arc40.db works too; unzip the export first)
 * Your current database is saved next to it first (data/arc40-before-restore-<time>.db),
 * so a restore can itself be undone by restoring that file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../server/src/config.js';
import { DB_FILENAME, openDatabase } from '../server/src/db/database.js';
import { isArc40Database } from '../server/src/lib/backup.js';

export async function restore(source: string, dataDir: string, opts: { checkRunning?: number | null } = {}): Promise<string> {
  const src = path.resolve(source.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
  if (!fs.existsSync(src)) throw new Error(`File not found: ${src}`);
  if (!isArc40Database(src)) throw new Error('That file is not an Arc40 database (backup .db files and the arc40.db inside an export work).');

  if (opts.checkRunning) {
    const running = await fetch(`http://127.0.0.1:${opts.checkRunning}/api/health`)
      .then((r) => r.ok)
      .catch(() => false);
    if (running) throw new Error('Arc40 is still running. Close its Terminal window, then run this again.');
  }

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const live = path.join(dataDir, DB_FILENAME);
  let savedAs = '';
  if (fs.existsSync(live)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    savedAs = path.join(dataDir, `arc40-before-restore-${stamp}.db`);
    // Fold any pending write-ahead log into the file before copying it aside.
    const cur = openDatabase(dataDir);
    cur.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    cur.close();
    fs.copyFileSync(live, savedAs);
  }
  for (const f of [live, `${live}-wal`, `${live}-shm`]) fs.rmSync(f, { force: true });
  fs.copyFileSync(src, live);
  fs.chmodSync(live, 0o600);

  // Open once so any newer migrations are applied to an older backup.
  openDatabase(dataDir).close();
  return savedAs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: npm run restore -- /path/to/arc40-backup-YYYY-MM-DD-HHMMSS.db');
    process.exit(1);
  }
  const config = loadConfig();
  try {
    const savedAs = await restore(file, config.dataDir, { checkRunning: config.port });
    console.log('Restored. Start Arc40 again with Start Arc40.command.');
    if (savedAs) console.log(`Your previous data was saved as ${savedAs}`);
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
