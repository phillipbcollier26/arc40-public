import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import type { DB } from './db/database.js';
import { DataStore } from './db/dataStore.js';
import { loadConfig, type AppConfig } from './config.js';
import { installGuards } from './auth/guard.js';
import { pruneExpiredSessions, sessionCookieName } from './auth/sessions.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerTransactionRoutes } from './routes/transactions.js';
import { registerImportRoutes } from './routes/import.js';
import { registerCategoryRoutes } from './routes/categories.js';
import { registerBudgetRoutes } from './routes/budget.js';
import { registerInvestmentRoutes } from './routes/investments.js';
import { registerGoalRoutes } from './routes/goals.js';
import { registerDashboardRoutes } from './routes/dashboard.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerDemoRoutes } from './routes/demo.js';
import { registerPreferenceRoutes } from './routes/preferences.js';
import { registerRecurringRoutes } from './routes/recurring.js';
import { registerPositionRoutes } from './routes/positions.js';
import { registerPriceHistoryRoutes } from './routes/priceHistory.js';
import { registerPlanningRoutes } from './routes/planning.js';
import { registerWorkCostRoutes } from './routes/workCost.js';
import { registerWhatIfRoutes } from './routes/whatIf.js';
import { registerRiverRoutes } from './routes/river.js';
import { registerWrappedRoutes } from './routes/wrapped.js';
import { registerTrophyRoutes } from './routes/trophies.js';
import { registerActivityRoutes } from './routes/activity.js';
import { backupFileDates } from './lib/backup.js';
import { LoginThrottle } from './auth/loginThrottle.js';

/**
 * Content-Security-Policy: the page may only load code, fonts and images from
 * Arc40 itself and may not connect anywhere else. This is what guarantees "no
 * external network calls" from the browser side.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // charts and animations set inline styles
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export interface BuiltApp {
  app: FastifyInstance;
  /** Proxy to the database the current request (or, outside a request, the app) is using. */
  db: DB;
  /** Real vs demo database switch. See db/dataStore.ts. */
  store: DataStore;
  config: AppConfig;
}

export async function buildApp(
  overrides: Partial<AppConfig> & { db?: DB; onMigrationBackup?: (file: string) => void } = {},
): Promise<BuiltApp> {
  const { db: injectedDb, onMigrationBackup, ...configOverrides } = overrides;
  const config = loadConfig(configOverrides);
  const store = new DataStore({
    realDir: config.dataDir,
    demoDir: config.demoDir,
    injectedReal: injectedDb,
    now: config.now,
    // Safety backup of the REAL database before any new migration (never for the demo database).
    migrationBackupDir: process.env.ARC40_BACKUPS === 'off' ? null : config.backupDir,
    onMigrationBackup,
  });
  // Every route gets this proxy. It forwards to the database the request was pinned to.
  const db = store.db;
  pruneExpiredSessions(db, config.now());

  const app = Fastify({
    logger: false,
    bodyLimit: 1024 * 1024, // JSON bodies; CSV uploads get their own larger limit later
  });

  // FIRST hook: pin each request to the database that is active when it arrives (real or demo).
  app.addHook('onRequest', (_req, _reply, done) => store.pin(done));

  await app.register(cookie);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    // Tells each open tab which mode answered, so a tab left in the other mode reloads itself.
    reply.header('X-Arc40-Mode', store.active().mode);
  });

  const cookieName = sessionCookieName(config.port);
  const modeOf = () => store.active().mode;
  const throttle = new LoginThrottle(); // shared by login and "leave demo mode"
  installGuards(app, db, config.now, cookieName, modeOf);
  registerAuthRoutes(app, db, config.now, cookieName, store, throttle, config.dataDir);
  registerDemoRoutes(app, store, config.now, cookieName, throttle);
  registerPreferenceRoutes(app, config.dataDir);
  registerAccountRoutes(app, db, config.now, config.backupDir, modeOf);
  registerTransactionRoutes(app, db, config.now);
  registerImportRoutes(app, db, config.now);
  registerCategoryRoutes(app, db, config.now);
  registerBudgetRoutes(app, db, config.now);
  registerRecurringRoutes(app, db, config.now);
  registerPositionRoutes(app, db, config.now);
  registerPriceHistoryRoutes(app, db, config.now);
  registerPlanningRoutes(app, db, config.now);
  registerWorkCostRoutes(app, db, config.now);
  registerWhatIfRoutes(app, db, config.now);
  registerRiverRoutes(app, db, config.now);
  registerWrappedRoutes(app, db, config.now);
  // Trophies Round 4 (First backup): backup files already in the folder count, in real mode with backups on only.
  const backupsOn = process.env.ARC40_BACKUPS !== 'off';
  registerTrophyRoutes(app, db, config.now, () => (modeOf() === 'real' && backupsOn ? { backupFileDates: () => backupFileDates(config.backupDir) } : {}));
  registerActivityRoutes(app, db, config.now);
  registerInvestmentRoutes(app, db, config.now);
  registerGoalRoutes(app, db, config.now);
  registerDashboardRoutes(app, db, config.now);
  registerBackupRoutes(app, db, config.now, config.backupDir, modeOf);

  // Serve the built React app (if it has been built) with SPA fallback.
  const indexFile = path.join(config.webDistDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    await app.register(fastifyStatic, { root: config.webDistDir, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && fs.existsSync(indexFile)) {
      return reply.type('text/html').send(fs.readFileSync(indexFile));
    }
    return reply.code(404).send({ error: 'Not found' });
  });

  app.addHook('onClose', async () => {
    store.close();
  });

  return { app, db, store, config };
}
