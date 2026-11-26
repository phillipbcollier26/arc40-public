import crypto from 'node:crypto';
import type { DB } from '../db/database.js';
import { getSetting } from '../lib/settings.js';

/**
 * Cookie name includes the port. Browsers share cookies across ports on
 * 127.0.0.1, so without this the demo (4041) and the real app (4040) would
 * keep logging each other out.
 */
export const sessionCookieName = (port: number) => `arc40_session_${port}`;

export interface Session {
  tokenHash: string;
  csrfToken: string;
  createdAt: number;
  lastSeenAt: number;
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Creates a session. Returns the raw token (goes in the cookie, never stored). */
export function createSession(db: DB, now: number): { token: string; session: Session } {
  const token = crypto.randomBytes(32).toString('base64url');
  const session: Session = {
    tokenHash: sha256(token),
    csrfToken: crypto.randomBytes(32).toString('base64url'),
    createdAt: now,
    lastSeenAt: now,
  };
  db.prepare(
    'INSERT INTO sessions (token_hash, csrf_token, created_at, last_seen_at) VALUES (?, ?, ?, ?)',
  ).run(session.tokenHash, session.csrfToken, now, now);
  return { token, session };
}

export function idleTimeoutMs(db: DB): number {
  return getSetting(db, 'session_idle_minutes') * 60_000;
}

/**
 * Looks up a session by raw cookie token. Expired sessions (idle longer than
 * the timeout) are deleted and treated as missing. Does NOT refresh activity.
 */
export function findSession(db: DB, token: string | undefined, now: number): Session | null {
  if (!token) return null;
  const tokenHash = sha256(token);
  const row = db
    .prepare('SELECT token_hash, csrf_token, created_at, last_seen_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as
    | { token_hash: string; csrf_token: string; created_at: number; last_seen_at: number }
    | undefined;
  if (!row) return null;
  if (now - row.last_seen_at > idleTimeoutMs(db)) {
    destroySession(db, token);
    return null;
  }
  return {
    tokenHash: row.token_hash,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Marks the session as active right now (sliding idle timeout). */
export function touchSession(db: DB, session: Session, now: number): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now, session.tokenHash);
  session.lastSeenAt = now;
}

export function destroySession(db: DB, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyAllSessions(db: DB): void {
  db.exec('DELETE FROM sessions');
}

export function pruneExpiredSessions(db: DB, now: number): void {
  db.prepare('DELETE FROM sessions WHERE last_seen_at < ?').run(now - idleTimeoutMs(db));
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
