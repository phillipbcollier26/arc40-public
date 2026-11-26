/**
 * Forgot your password? Run:  npm run reset-password
 * Your data is kept. It asks for a new password and logs out every session.
 * (Anyone who can run commands on your Mac could do this, which is fine:
 * Arc40's password protects the browser screen, not the files on disk.)
 */
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { loadConfig } from '../server/src/config.js';
import { openDatabase } from '../server/src/db/database.js';
import { setPassword, validateNewPassword } from '../server/src/auth/password.js';
import { destroyAllSessions } from '../server/src/auth/sessions.js';
import { MigrationBackupError } from '../server/src/db/migrationBackup.js';

const config = loadConfig();
let db: ReturnType<typeof openDatabase>;
try {
  // Same safety rule as starting Arc40: back up before any new migration runs.
  db = openDatabase(config.dataDir, {
    backupBeforeMigrate: process.env.ARC40_BACKUPS === 'off' ? null : { dir: config.backupDir, now: Date.now() },
    onBackup: (f) => console.log(`Safety backup before updating the database: ${f}`),
  });
} catch (e) {
  if (e instanceof MigrationBackupError) {
    console.error(`${e.message}\nNothing changed.`);
    process.exit(1);
  }
  throw e;
}
const rl = readline.createInterface({ input, output });
const pw = await rl.question('New Arc40 password: ');
const again = await rl.question('Type it again: ');
rl.close();

if (pw !== again) {
  console.error('Those did not match. Nothing changed.');
  process.exit(1);
}
const problem = validateNewPassword(pw);
if (problem) {
  console.error(problem);
  process.exit(1);
}
await setPassword(db, pw, Date.now());
destroyAllSessions(db);
db.close();
console.log('Password updated. Start Arc40 and log in with the new password.');
