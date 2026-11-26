import { buildApp } from './app.js';
import { backupIfDue } from './lib/backup.js';
import { HOST } from './config.js';
import { MigrationBackupError } from './db/migrationBackup.js';

const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16)) {
  console.error(`Arc40 needs Node.js 22.16 or newer. You have ${process.versions.node}.`);
  console.error('Install the LTS version from https://nodejs.org and try again.');
  process.exit(1);
}

let built: Awaited<ReturnType<typeof buildApp>>;
try {
  built = await buildApp({
    onMigrationBackup: (file) => console.log(`  Safety backup before updating the database: ${file}`),
  });
} catch (err) {
  if (err instanceof MigrationBackupError) {
    console.error('');
    console.error('  Arc40 did NOT start, and your data was NOT changed.');
    console.error('  This update needs to change the shape of your database, and Arc40 always makes a');
    console.error('  safety backup first. That backup could not be made, so Arc40 stopped.');
    console.error(`  Reason: ${err.reason}`);
    console.error('  Check that your backups folder exists and has free space, then start Arc40 again.');
    console.error('');
    process.exit(1);
  }
  throw err;
}
const { app, config, store } = built;

try {
  await app.listen({ host: HOST, port: config.port });
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Is Arc40 already running?`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

console.log('');
console.log(`  Arc40 is running at http://${HOST}:${config.port}`);
console.log(`  Data folder: ${config.dataDir}`);
console.log('  Close this window (or press Ctrl+C) to stop Arc40.');
console.log('');

// Weekly automatic backup: checked at startup and every 6 hours while running.
// (Off for `npm run demo`, which sets ARC40_BACKUPS=off, and skipped while in-app demo mode is on:
// the real database is closed then and demo data must never go to the backups folder.)
if (process.env.ARC40_BACKUPS !== 'off') {
  const check = async () => {
    const real = store.realIfOpen();
    if (!real) return;
    await backupIfDue(real, config.backupDir, Date.now())
      .then((b) => b && console.log(`  Backup saved: ${b.path}`))
      .catch((e) => console.error(`  Backup failed: ${(e as Error).message}`));
  };
  await check();
  setInterval(check, 6 * 60 * 60 * 1000).unref();
  console.log(`  Backups folder: ${config.backupDir}`);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);
