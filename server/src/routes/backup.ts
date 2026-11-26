import type { FastifyInstance } from 'fastify';
import type { DB } from '../db/database.js';
import { backupNow, listBackups } from '../lib/backup.js';
import { buildExport } from '../lib/exporter.js';
import { exportFilename, type Mode } from '../lib/demoPolicy.js';

export function registerBackupRoutes(
  app: FastifyInstance,
  db: DB,
  now: () => number,
  backupDir: string,
  modeOf: () => Mode = () => 'real',
): void {
  /** Downloads everything as a ZIP (logged-in GET; the browser saves it to Downloads). */
  app.get('/api/export', async (_req, reply) => {
    const mode = modeOf();
    const built = await buildExport(db, now());
    const filename = exportFilename(built.filename, mode);
    const zip = built.zip;
    return reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('Cache-Control', 'no-store')
      .send(zip);
  });

  // In demo mode the real backup list is not shown (and "Back up now" is refused by the guard).
  app.get('/api/backups', async () =>
    modeOf() === 'demo'
      ? { dir: backupDir, demo: true, backups: [] }
      : {
          dir: backupDir,
          demo: false,
          backups: listBackups(backupDir).map((b) => ({ name: b.name, sizeBytes: b.sizeBytes, createdAt: b.createdAt })),
        },
  );

  app.post('/api/backups', async () => {
    const b = await backupNow(db, backupDir, now());
    return { ok: true, backup: { name: b.name, sizeBytes: b.sizeBytes, createdAt: b.createdAt } };
  });
}
