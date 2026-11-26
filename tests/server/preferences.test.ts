import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../server/src/app.js';
import { PREFERENCES_FILE, readPreferences, sanitizePreferences } from '../../server/src/lib/preferences.js';
import { cookieFrom, fakeClock, HOST_HEADER, setupAndLogin, testApp } from './helpers.js';

const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));

describe('theme preference', () => {
  it('defaults to Dark, saves Light / Match Mac, and accepts nothing else', async () => {
    const t = await testApp();
    const { cookie, csrf } = await setupAndLogin(t);
    const get = () => t.app.inject({ method: 'GET', url: '/api/preferences', headers: { ...HOST_HEADER, cookie } });
    const put = (payload: unknown) =>
      t.app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf }, payload: payload as object });

    expect((await get()).json()).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    for (const theme of ['light', 'system', 'dark'] as const) {
      expect((await put({ theme })).json()).toEqual({ theme, wrappedSound: false, trophySound: true });
      expect((await get()).json()).toEqual({ theme, wrappedSound: false, trophySound: true });
    }
    for (const bad of [{ theme: 'purple' }, { theme: 'Light' }, { theme: 1 }, {}, { theme: null }]) {
      const res = await put(bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json().error).toBe('Pick Dark, Light or Match Mac.');
    }
    expect((await get()).json()).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    await t.app.close();
  });

  it('needs a login, and the status check only reveals it after login', async () => {
    const t = await testApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/preferences', headers: HOST_HEADER })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'PUT', url: '/api/preferences', headers: HOST_HEADER, payload: { theme: 'light' } })).statusCode).toBe(401);
    const { cookie, csrf } = await setupAndLogin(t);
    await t.app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf }, payload: { theme: 'light' } });
    const anon = await t.app.inject({ method: 'GET', url: '/api/auth/status', headers: HOST_HEADER });
    expect(anon.json().theme).toBeNull(); // the login screen is always dark
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/status', headers: { ...HOST_HEADER, cookie } });
    expect(me.json().theme).toBe('light');
    await t.app.close();
  });

  it('is kept across restarts and in demo mode, without ever writing the real database', async () => {
    const dirs = { dataDir: tmp('arc40-real-'), demoDir: tmp('arc40-demo-'), backupDir: tmp('arc40-bk-') };
    const opts = { ...dirs, now: fakeClock().now, webDistDir: '/nonexistent', port: 4040 };
    const a = await buildApp(opts);
    const setup = await a.app.inject({ method: 'POST', url: '/api/auth/setup', headers: HOST_HEADER, payload: { password: 'real password 123' } });
    let c = { cookie: cookieFrom(setup), csrf: setup.json().csrfToken as string };
    const enter = await a.app.inject({ method: 'POST', url: '/api/demo/enter', headers: { ...HOST_HEADER, cookie: c.cookie, 'x-csrf-token': c.csrf } });
    c = { cookie: cookieFrom(enter), csrf: enter.json().csrfToken };
    const db = path.join(dirs.dataDir, 'arc40.db');
    const before = crypto.createHash('sha256').update(fs.readFileSync(db)).digest('hex');

    const put = await a.app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...HOST_HEADER, cookie: c.cookie, 'x-csrf-token': c.csrf }, payload: { theme: 'light' } });
    expect(put.statusCode).toBe(200);
    expect(crypto.createHash('sha256').update(fs.readFileSync(db)).digest('hex')).toBe(before);
    expect(readPreferences(dirs.dataDir)).toEqual({ theme: 'light', wrappedSound: false, trophySound: true });
    expect(fs.statSync(path.join(dirs.dataDir, PREFERENCES_FILE)).mode & 0o777).toBe(0o600);
    await a.app.close();

    const b = await buildApp(opts);
    const login = await b.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: 'real password 123' } });
    const status = await b.app.inject({ method: 'GET', url: '/api/auth/status', headers: { ...HOST_HEADER, cookie: cookieFrom(login) } });
    expect(status.json()).toMatchObject({ mode: 'real', theme: 'light' });
    await b.app.close();
  });

  it('falls back to Dark when the file is missing or damaged', () => {
    const dir = tmp('arc40-prefs-');
    expect(readPreferences(dir)).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    fs.writeFileSync(path.join(dir, PREFERENCES_FILE), '{ not json');
    expect(readPreferences(dir)).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    expect(sanitizePreferences({ theme: 'cyan', extra: 1 })).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    expect(sanitizePreferences({ theme: 'system' })).toEqual({ theme: 'system', wrappedSound: false, trophySound: true });
  });
});

describe('Arc40 Wrapped sound (V2 Phase 4)', () => {
  it('is off by default, can be turned on and off, keeps the theme, and accepts only true or false', async () => {
    const t = await testApp();
    const { cookie, csrf } = await setupAndLogin(t);
    const get = () => t.app.inject({ method: 'GET', url: '/api/preferences', headers: { ...HOST_HEADER, cookie } });
    const put = (payload: unknown) =>
      t.app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf }, payload: payload as object });
    expect((await get()).json().wrappedSound).toBe(false);
    await put({ theme: 'light' });
    expect((await put({ wrappedSound: true })).json()).toEqual({ theme: 'light', wrappedSound: true, trophySound: true });
    expect((await get()).json()).toEqual({ theme: 'light', wrappedSound: true, trophySound: true });
    expect((await put({ theme: 'dark' })).json()).toEqual({ theme: 'dark', wrappedSound: true, trophySound: true }); // a theme change keeps the sound
    for (const bad of [{ wrappedSound: 'yes' }, { wrappedSound: 1 }, { wrappedSound: null }]) {
      const r = await put(bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      expect(r.json().error).toBe('Turn the sound on or off.');
    }
    expect((await put({ wrappedSound: false, volume: 11 })).statusCode).toBe(400);
    expect((await put({ wrappedSound: false })).json()).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    // A damaged value in the file means off, never on.
    expect(sanitizePreferences({ theme: 'dark', wrappedSound: 'true' })).toEqual({ theme: 'dark', wrappedSound: false, trophySound: true });
    await t.app.close();
  });

  it('Trophies Round 2: trophy sounds are ON by default, the mute (or Settings) turns them off, a damaged value means on', async () => {
    const t = await testApp();
    const { cookie, csrf } = await setupAndLogin(t);
    const get = () => t.app.inject({ method: 'GET', url: '/api/preferences', headers: { ...HOST_HEADER, cookie } });
    const put = (payload: unknown) =>
      t.app.inject({ method: 'PUT', url: '/api/preferences', headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf }, payload: payload as object });
    expect((await get()).json().trophySound).toBe(true);
    // The pop-up's mute button sends exactly this.
    expect((await put({ trophySound: false })).json()).toEqual({ theme: 'dark', wrappedSound: false, trophySound: false });
    expect((await get()).json().trophySound).toBe(false);
    expect((await put({ theme: 'light' })).json().trophySound).toBe(false); // other changes keep it
    expect((await put({ wrappedSound: true })).json().trophySound).toBe(false); // separate from the Wrapped sound
    expect((await put({ trophySound: true })).json()).toEqual({ theme: 'light', wrappedSound: true, trophySound: true });
    for (const bad of [{ trophySound: 'no' }, { trophySound: 0 }, { trophySound: null }]) {
      const r = await put(bad);
      expect(r.statusCode, JSON.stringify(bad)).toBe(400);
      expect(r.json().error).toBe('Turn the sound on or off.');
    }
    expect(sanitizePreferences({ theme: 'dark', trophySound: 'false' }).trophySound).toBe(true);
    expect(sanitizePreferences({}).trophySound).toBe(true);
    // Saved in preferences.json next to the database (never in arc40.db).
    expect(JSON.parse(fs.readFileSync(path.join(t.config.dataDir, 'preferences.json'), 'utf8')).trophySound).toBe(true);
    await t.app.close();
  });

  it('the sounds are generated in the browser: no audio files, no downloads', () => {
    for (const f of ['web/src/lib/wrappedSound.ts', 'web/src/lib/trophySound.ts']) {
      const src = fs.readFileSync(path.resolve(f), 'utf8');
      expect(src, f).toMatch(/createOscillator/);
      expect(src, f).not.toMatch(/fetch\(|new Audio\(|https?:\/\/|\.mp3|\.wav|\.ogg|import\(/);
    }
    const src = fs.readFileSync(path.resolve('web/src/lib/wrappedSound.ts'), 'utf8');
    expect(src).toMatch(/createOscillator/);
    expect(src).not.toMatch(/fetch\(|new Audio\(|https?:\/\/|\.mp3|\.wav|\.ogg|import\(/);
    expect(fs.readdirSync(path.resolve('web/public')).filter((f) => /\.(mp3|wav|ogg|m4a|aac)$/i.test(f))).toEqual([]);
  });
});
