import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import type { DataStore } from '../db/dataStore.js';
import { verifyPassword } from '../auth/password.js';
import { createSession, destroySession } from '../auth/sessions.js';
import type { LoginThrottle } from '../auth/loginThrottle.js';
import { setSetting } from '../lib/settings.js';
import { cookieOptions } from './auth.js';

/**
 * In-app demo mode. Entering needs a logged-in real session (one click). Leaving needs the REAL
 * password, with the same 5-tries throttle as the login screen. Which requests are refused in
 * each mode lives in lib/demoPolicy.ts and is enforced by the guard before these handlers run.
 */
export function registerDemoRoutes(
  app: FastifyInstance,
  store: DataStore,
  now: () => number,
  cookieName: string,
  throttle: LoginThrottle,
): void {
  /** Starts a session in `db` and sets the cookie. Every mode switch gets a fresh session + CSRF token. */
  const startSession = (db: DB, reply: FastifyReply) => {
    const { token, session } = createSession(db, now());
    reply.setCookie(cookieName, token, cookieOptions);
    return session.csrfToken;
  };
  const fail = (reply: FastifyReply, e: unknown) => reply.code(409).send({ error: (e as Error).message });

  app.post('/api/demo/enter', async (req, reply) => {
    const token = req.cookies[cookieName];
    let demo: DB;
    try {
      // End the real session while the real database is still open, then switch.
      demo = await store.enterDemo((real) => {
        if (token) destroySession(real, token);
      });
    } catch (e) {
      return fail(reply, e);
    }
    // Auto-lock works exactly as in real mode: same idle minutes.
    setSetting(demo, 'session_idle_minutes', store.realIdleTimeoutMinutes());
    return { ok: true, mode: 'demo', csrfToken: startSession(demo, reply) };
  });

  app.post('/api/demo/exit', async (req, reply) => {
    const wait = throttle.retryAfterMs(now());
    if (wait > 0) {
      return reply.code(429).send({ error: `Too many tries. Wait ${Math.ceil(wait / 1000)} seconds.`, retryAfterMs: wait });
    }
    const body = z.object({ password: z.string() }).safeParse(req.body);
    const hash = store.realPasswordHash();
    if (!body.success || !hash || !(await verifyPassword(hash, body.data.password))) {
      throttle.recordFailure(now());
      return reply.code(401).send({ error: 'Wrong password. Use your real Arc40 password.' });
    }
    throttle.recordSuccess();
    const token = req.cookies[cookieName];
    let real: DB;
    try {
      real = store.exitDemo((demo) => {
        if (token) destroySession(demo, token);
      });
    } catch (e) {
      return fail(reply, e);
    }
    return { ok: true, mode: 'real', csrfToken: startSession(real, reply) };
  });

  app.post('/api/demo/reset', async (_req, reply) => {
    let demo: DB;
    try {
      demo = await store.resetDemo();
    } catch (e) {
      return fail(reply, e);
    }
    // The rebuilt file has no sessions, so start a new one (you stay logged in).
    setSetting(demo, 'session_idle_minutes', store.realIdleTimeoutMinutes());
    return { ok: true, mode: 'demo', csrfToken: startSession(demo, reply) };
  });
}
