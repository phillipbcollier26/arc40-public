import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/database.js';
import { findSession, safeEqual, touchSession, type Session } from './sessions.js';
import { demoBlockReason, type Mode } from '../lib/demoPolicy.js';

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

/** Routes that work without being logged in. */
const PUBLIC_API = new Set([
  'GET /api/health',
  'GET /api/auth/status',
  'POST /api/auth/setup',
  'POST /api/auth/login',
  'POST /api/auth/logout',
]);

/** Routes that must not count as "activity" (so the idle timer keeps running). */
const NO_TOUCH = new Set(['GET /api/auth/status']);

const isMutating = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);

function hostnameOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}

/**
 * Installs the request guards. All of these are invisible during normal use:
 * 1. Host check: blocks DNS-rebinding (a website pretending to be 127.0.0.1).
 * 2. Origin check: a POST must come from Arc40's own page, not another site.
 * 3. Session check: /api/* needs a login, except the public routes above.
 * 4. CSRF token: logged-in changes must echo the session's token in a header.
 * 5. Demo policy: some requests are refused in demo mode (import, back up now) or in real mode (reset demo).
 */
export function installGuards(
  app: FastifyInstance,
  db: DB,
  now: () => number,
  cookieName: string,
  modeOf: () => Mode = () => 'real',
): void {
  app.decorateRequest('session', null);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const host = hostnameOf(req.headers.host);
    if (!host || !LOOPBACK_HOSTNAMES.has(host)) {
      return reply.code(421).send({ error: 'Arc40 only answers on 127.0.0.1.' });
    }

    if (isMutating(req.method) && req.headers.origin !== undefined) {
      const origin = hostnameOf(req.headers.origin);
      if (!origin || !LOOPBACK_HOSTNAMES.has(origin)) {
        return reply.code(403).send({ error: 'Cross-site request blocked.' });
      }
    }

    // Decide "is this an API call?" from the DECODED path and the route the router
    // matched. Reading the raw text let "/%61pi/accounts" (= /api/accounts) skip login.
    const rawPath = req.url.split('?')[0] ?? '';
    let path: string;
    try {
      path = decodeURIComponent(rawPath);
    } catch {
      return reply.code(400).send({ error: 'Bad address.' });
    }
    const routeUrl = req.routeOptions.url;
    if (!path.startsWith('/api/') && !routeUrl?.startsWith('/api/')) return;

    const key = `${req.method} ${req.routeOptions.url ?? path}`;
    const token = req.cookies[cookieName];
    const t = now();
    req.session = findSession(db, token, t);

    const blocked = demoBlockReason(modeOf(), req.method, req.routeOptions.url ?? path);
    if (PUBLIC_API.has(key)) {
      if (blocked) return reply.code(403).send({ error: blocked, code: 'MODE_BLOCKED' });
      return;
    }

    if (!req.session) {
      return reply.code(401).send({ error: 'Please log in.', code: 'AUTH_REQUIRED' });
    }
    if (isMutating(req.method)) {
      const sent = req.headers['x-csrf-token'];
      if (typeof sent !== 'string' || !safeEqual(sent, req.session.csrfToken)) {
        return reply.code(403).send({ error: 'Security token missing. Refresh the page.', code: 'CSRF' });
      }
    }
    if (blocked) return reply.code(403).send({ error: blocked, code: 'MODE_BLOCKED' });
    if (!NO_TOUCH.has(key)) touchSession(db, req.session, t);
  });
}
