import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import {
  getPasswordHash,
  isSetupRequired,
  setPassword,
  validateNewPassword,
  verifyPassword,
} from '../auth/password.js';
import {
  createSession,
  destroyAllSessions,
  destroySession,
} from '../auth/sessions.js';
import type { LoginThrottle } from '../auth/loginThrottle.js';
import type { DataStore } from '../db/dataStore.js';
import { getSetting, setSetting } from '../lib/settings.js';
import { readPreferences } from '../lib/preferences.js';

export const cookieOptions = {
  path: '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  // `secure` is intentionally off: Arc40 runs on plain http://127.0.0.1 and
  // Safari will not send Secure cookies over http. Traffic never leaves the Mac.
  secure: false,
};

export function registerAuthRoutes(
  app: FastifyInstance,
  db: DB,
  now: () => number,
  cookieName: string,
  store: DataStore,
  throttle: LoginThrottle,
  dataDir: string,
): void {

  const startSession = (reply: import('fastify').FastifyReply) => {
    const { token, session } = createSession(db, now());
    reply.setCookie(cookieName, token, cookieOptions);
    return session;
  };

  app.get('/api/health', async () => ({ ok: true, app: 'arc40' }));

  app.get('/api/auth/status', async (req) => ({
    setupRequired: store.active().mode === 'real' && isSetupRequired(db),
    /** 'demo' while in-app demo mode is on. The tab compares it with the X-Arc40-Mode header. */
    mode: store.active().mode,
    /** Only after login, so the theme applies at once. The login screen itself is always dark. */
    theme: req.session ? readPreferences(dataDir).theme : null,
    authenticated: req.session !== null,
    csrfToken: req.session?.csrfToken ?? null,
    idleTimeoutMinutes: getSetting(db, 'session_idle_minutes'),
  }));

  app.post('/api/auth/setup', async (req, reply) => {
    if (!isSetupRequired(db)) return reply.code(409).send({ error: 'A password is already set.' });
    const password = (req.body as { password?: unknown } | undefined)?.password;
    const problem = validateNewPassword(password);
    if (problem) return reply.code(400).send({ error: problem });
    await setPassword(db, password as string, now());
    const session = startSession(reply);
    return { ok: true, csrfToken: session.csrfToken };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const wait = throttle.retryAfterMs(now());
    if (wait > 0) {
      return reply
        .code(429)
        .send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.`, retryAfterMs: wait });
    }
    // Always the REAL password, also in demo mode (the demo's own demo1234 never unlocks port 4040).
    const hash = store.active().mode === 'demo' ? store.realPasswordHash() : getPasswordHash(db);
    if (!hash) return reply.code(409).send({ error: 'No password set yet.', code: 'SETUP_REQUIRED' });
    const password = (req.body as { password?: unknown } | undefined)?.password;
    if (typeof password !== 'string' || !(await verifyPassword(hash, password))) {
      throttle.recordFailure(now());
      return reply.code(401).send({ error: 'Wrong password.' });
    }
    throttle.recordSuccess();
    const session = startSession(reply);
    return { ok: true, csrfToken: session.csrfToken };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[cookieName];
    if (token) destroySession(db, token);
    reply.clearCookie(cookieName, { path: '/' });
    return { ok: true };
  });

  /** Called by the page every few minutes while you are actively using it. */
  app.post('/api/auth/keepalive', async () => ({ ok: true }));

  app.post('/api/auth/change-password', async (req, reply) => {
    const body = z
      .object({ currentPassword: z.string(), newPassword: z.string() })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Fill in both fields.' });
    const hash = getPasswordHash(db)!;
    if (!(await verifyPassword(hash, body.data.currentPassword))) {
      return reply.code(401).send({ error: 'Current password is wrong.' });
    }
    const problem = validateNewPassword(body.data.newPassword);
    if (problem) return reply.code(400).send({ error: problem });
    await setPassword(db, body.data.newPassword, now());
    destroyAllSessions(db);
    const session = startSession(reply);
    return { ok: true, csrfToken: session.csrfToken };
  });

  app.put('/api/settings/session', async (req, reply) => {
    const body = z
      .object({ idleTimeoutMinutes: z.number().int().min(5).max(24 * 60) })
      .safeParse(req.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Pick between 5 minutes and 24 hours.' });
    }
    setSetting(db, 'session_idle_minutes', body.data.idleTimeoutMinutes);
    return { ok: true, idleTimeoutMinutes: body.data.idleTimeoutMinutes };
  });
}
