import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { buildApp } from '../../server/src/app.js';
import { HOST } from '../../server/src/config.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  t = await testApp();
});
afterEach(async () => {
  await t.app.close();
});

describe('network binding', () => {
  it('HOST is hard-coded to loopback', () => {
    expect(HOST).toBe('127.0.0.1');
  });

  it('the real server listens on 127.0.0.1 only', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-bind-'));
    const { app } = await buildApp({ dataDir: dir, port: 0, webDistDir: '/nonexistent', backupDir: path.join(dir, 'backups') });
    await app.listen({ host: HOST, port: 0 });
    const addrs = app.addresses() as { address: string }[];
    expect(addrs.length).toBeGreaterThan(0);
    for (const a of addrs) expect(a.address).toBe('127.0.0.1');
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('main.ts uses the HOST constant, not a configurable address', () => {
    const src = fs.readFileSync(path.resolve('server/src/main.ts'), 'utf8');
    expect(src).toMatch(/listen\(\{\s*host:\s*HOST/);
  });
});

describe('DNS rebinding / host check', () => {
  it.each(['evil.example.com', '192.168.1.5:4040', '0.0.0.0:4040'])('rejects Host %s', async (host) => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: { host } });
    expect(res.statusCode).toBe(421);
  });

  it.each(['127.0.0.1:4040', 'localhost:4040', 'localhost:5173'])('accepts Host %s', async (host) => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: { host } });
    expect(res.statusCode).toBe(200);
  });
});

describe('cross-site request protection', () => {
  it('blocks POSTs from another website origin', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { ...HOST_HEADER, origin: 'https://evil.example.com' },
      payload: { password: 'whatever whatever' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows POSTs from Arc40 itself', async () => {
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      headers: { ...HOST_HEADER, origin: 'http://127.0.0.1:4040' },
      payload: { password: 'long enough pw' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('logged-in changes need the CSRF token', async () => {
    const { cookie, csrf } = await setupAndLogin(t);
    const missing = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/session',
      headers: { ...HOST_HEADER, cookie },
      payload: { idleTimeoutMinutes: 30 },
    });
    expect(missing.statusCode).toBe(403);
    const wrong = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/session',
      headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf.replace(/./, 'Z') + 'x' },
      payload: { idleTimeoutMinutes: 30 },
    });
    expect(wrong.statusCode).toBe(403);
    const right = await t.app.inject({
      method: 'PUT',
      url: '/api/settings/session',
      headers: { ...HOST_HEADER, cookie, 'x-csrf-token': csrf },
      payload: { idleTimeoutMinutes: 30 },
    });
    expect(right.statusCode).toBe(200);
  });
});

describe('security headers', () => {
  it('sends a CSP that forbids loading or connecting to anything external', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/health', headers: HOST_HEADER });
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/https?:\/\//);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('no external network calls', () => {
  it('server code never imports an HTTP client or calls fetch', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')) files.push(p);
      }
    };
    walk(path.resolve('server/src'));
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/\bfetch\s*\(/);
      expect(src, f).not.toMatch(/from ['"]node:(https?|net|dgram|tls)['"]/);
      expect(src, f).not.toMatch(/from ['"](axios|node-fetch|undici|got)['"]/);
    }
  });
});
