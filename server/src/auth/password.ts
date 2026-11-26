import { hash, verify } from '@node-rs/argon2';
import type { DB } from '../db/database.js';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

/** argon2id with library defaults (19 MiB memory, 2 iterations, OWASP baseline). */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return 'That password is too long.';
  return null;
}

export function getPasswordHash(db: DB): string | null {
  const row = db.prepare('SELECT password_hash FROM app_user WHERE id = 1').get() as
    | { password_hash: string }
    | undefined;
  return row?.password_hash ?? null;
}

export function isSetupRequired(db: DB): boolean {
  return getPasswordHash(db) === null;
}

export async function setPassword(db: DB, password: string, now: number): Promise<void> {
  const h = await hashPassword(password);
  db.prepare(
    `INSERT INTO app_user (id, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at`,
  ).run(h, now, now);
}
