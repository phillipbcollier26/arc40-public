import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cookieFrom, HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { LOCKOUT_MS, MAX_FAILURES } from '../../server/src/auth/loginThrottle.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  await t.app.close();
});

import type { InjectOptions } from 'fastify';

const req = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, ...(opts.headers ?? {}) } });

describe('first-run setup', () => {
  it('reports setup required until a password exists', async () => {
    const before = await req({ method: 'GET', url: '/api/auth/status' });
    expect(before.json()).toMatchObject({ setupRequired: true, authenticated: false });
    await setupAndLogin(t);
    const after = await req({ method: 'GET', url: '/api/auth/status' });
    expect(after.json()).toMatchObject({ setupRequired: false, authenticated: false });
  });

  it('rejects short passwords', async () => {
    const res = await req({ method: 'POST', url: '/api/auth/setup', payload: { password: 'short' } });
    expect(res.statusCode).toBe(400);
  });

  it('cannot be run twice (no silent password takeover)', async () => {
    await setupAndLogin(t);
    const res = await req({ method: 'POST', url: '/api/auth/setup', payload: { password: 'another password' } });
    expect(res.statusCode).toBe(409);
  });

  it('stores only an argon2id hash, never the password', async () => {
    const { password } = await setupAndLogin(t);
    const row = t.db.prepare('SELECT password_hash FROM app_user').get() as { password_hash: string };
    expect(row.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(row.password_hash).not.toContain(password);
  });
});

describe('login and sessions', () => {
  it('logs in with the right password and sets a locked-down cookie', async () => {
    const { password } = await setupAndLogin(t);
    const res = await req({ method: 'POST', url: '/api/auth/login', payload: { password } });
    expect(res.statusCode).toBe(200);
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    const status = await req({ method: 'GET', url: '/api/auth/status', headers: { cookie: cookieFrom(res) } });
    expect(status.json()).toMatchObject({ authenticated: true });
    expect(status.json().csrfToken).toBeTypeOf('string');
  });

  it('rejects the wrong password', async () => {
    await setupAndLogin(t);
    const res = await req({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope nope nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name.startsWith('arc40_session'))).toBeUndefined();
  });

  it('stores only a hash of the session token', async () => {
    const { cookie } = await setupAndLogin(t);
    const token = cookie.split('=')[1]!;
    const rows = t.db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
  });

  it('protects API routes when logged out', async () => {
    const res = await req({ method: 'POST', url: '/api/auth/keepalive' });
    expect(res.statusCode).toBe(401);
  });

  it('logs out and the old cookie stops working', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    await req({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    const res = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
    expect(res.statusCode).toBe(401);
  });

  it('a forged cookie does not work', async () => {
    await setupAndLogin(t);
    const res = await req({
      method: 'POST',
      url: '/api/auth/keepalive',
      headers: { cookie: 'arc40_session_4040=forged', 'x-csrf-token': 'x' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('cookie per port', () => {
  it('the real app and the demo use different cookies so they never log each other out', async () => {
    const { sessionCookieName } = await import('../../server/src/auth/sessions.js');
    expect(sessionCookieName(4040)).not.toBe(sessionCookieName(4041));
    const res = await req({ method: 'POST', url: '/api/auth/setup', payload: { password: 'long enough pw' } });
    expect(res.cookies.map((c) => c.name)).toContain('arc40_session_4040');
  });
});

describe('inactivity timeout', () => {
  it('expires after 60 idle minutes by default', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    t.clock.advance(59 * 60_000);
    const ok = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
    expect(ok.statusCode).toBe(200);
    t.clock.advance(61 * 60_000);
    const expired = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
    expect(expired.statusCode).toBe(401);
  });

  it('activity resets the timer (sliding window)', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    for (let i = 0; i < 5; i++) {
      t.clock.advance(50 * 60_000);
      const res = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
      expect(res.statusCode).toBe(200);
    }
  });

  it('checking status does not count as activity', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    for (let i = 0; i < 4; i++) {
      t.clock.advance(20 * 60_000);
      await req({ method: 'GET', url: '/api/auth/status', headers: { cookie } });
    }
    const res = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
    expect(res.statusCode).toBe(401);
  });

  it('timeout is editable', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    const set = await req({
      method: 'PUT',
      url: '/api/settings/session',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { idleTimeoutMinutes: 240 },
    });
    expect(set.statusCode).toBe(200);
    t.clock.advance(200 * 60_000);
    const res = await req({ method: 'POST', url: '/api/auth/keepalive', headers: { cookie, 'x-csrf-token': csrf } });
    expect(res.statusCode).toBe(200);
  });

  it('rejects silly timeout values', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    for (const v of [0, 1, 99999, 12.5]) {
      const res = await req({
        method: 'PUT',
        url: '/api/settings/session',
        headers: { cookie, 'x-csrf-token': csrf },
        payload: { idleTimeoutMinutes: v },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe('login throttle', () => {
  it(`pauses for ${LOCKOUT_MS / 1000}s after ${MAX_FAILURES} wrong tries, then allows again`, async () => {
    const { password } = await setupAndLogin(t);
    for (let i = 0; i < MAX_FAILURES; i++) {
      await req({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong wrong' } });
    }
    const locked = await req({ method: 'POST', url: '/api/auth/login', payload: { password } });
    expect(locked.statusCode).toBe(429);
    t.clock.advance(LOCKOUT_MS + 1);
    const ok = await req({ method: 'POST', url: '/api/auth/login', payload: { password } });
    expect(ok.statusCode).toBe(200);
  });
});

describe('change password', () => {
  it('requires the current password and signs out other sessions', async () => {
    const { cookie, csrf, password } = await setupAndLogin(t);
    const other = cookieFrom(await req({ method: 'POST', url: '/api/auth/login', payload: { password } }));

    const bad = await req({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { currentPassword: 'not it at all', newPassword: 'new password 123' },
    });
    expect(bad.statusCode).toBe(401);

    const good = await req({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { cookie, 'x-csrf-token': csrf },
      payload: { currentPassword: password, newPassword: 'new password 123' },
    });
    expect(good.statusCode).toBe(200);

    const otherStatus = await req({ method: 'GET', url: '/api/auth/status', headers: { cookie: other } });
    expect(otherStatus.json().authenticated).toBe(false);

    const oldPw = await req({ method: 'POST', url: '/api/auth/login', payload: { password } });
    expect(oldPw.statusCode).toBe(401);
    const newPw = await req({ method: 'POST', url: '/api/auth/login', payload: { password: 'new password 123' } });
    expect(newPw.statusCode).toBe(200);
  });
});
