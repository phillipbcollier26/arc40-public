import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db/database.js';

/** A controllable clock for session/timeout tests. */
export function fakeClock(start = Date.UTC(2026, 10, 11, 12, 0, 0)) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

export const HOST_HEADER = { host: '127.0.0.1:4040' };

/** Fresh app with an in-memory database (never touches disk). */
export async function testApp() {
  const clock = fakeClock();
  const db = openDatabase(':memory:');
  // Backups go to a throwaway folder, never the real ~/Arc40Backups.
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-test-backups-'));
  // In-app demo mode also gets a throwaway folder, never the repo's demo-data/.
  const demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-test-demo-'));
  // preferences.json lives in the data folder: a throwaway one, never the repo's data/.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-test-data-'));
  const built = await buildApp({ db, now: clock.now, webDistDir: '/nonexistent', port: 4040, backupDir, demoDir, dataDir });
  return { ...built, clock };
}

type TestApp = Awaited<ReturnType<typeof testApp>>;

/** Pulls the session cookie out of a response. */
export function cookieFrom(res: { cookies: { name: string; value: string }[] }): string {
  const c = res.cookies.find((x) => x.name.startsWith('arc40_session_'));
  if (!c) throw new Error('no session cookie');
  return `${c.name}=${c.value}`;
}

/** Sets a password and returns a logged-in cookie + CSRF token. */
export async function setupAndLogin(t: TestApp, password = 'correct horse battery') {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    headers: HOST_HEADER,
    payload: { password },
  });
  if (res.statusCode !== 200) throw new Error(`setup failed: ${res.body}`);
  return { cookie: cookieFrom(res), csrf: res.json().csrfToken as string, password };
}
