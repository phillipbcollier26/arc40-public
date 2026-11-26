/**
 * Golden numbers: every income/spending total on every screen, recorded from the fake demo
 * dataset BEFORE the V2 Phase 2 "one shared totals source" refactor. The refactor (and anything
 * after it) must reproduce these exactly, to the cent.
 *
 * The baseline uses only the first four demo seeders (the V2 Phase 1 dataset). Later seeders are
 * appended at the end of DEMO_SEEDERS and can never move these numbers. Net worth and investment
 * values are deliberately left out: they are not income/spending totals and Phase 2 changes how
 * investment values are computed on purpose.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db/database.js';
import { DEMO_PASSWORD, generateDemoData } from '../../server/src/lib/demo/index.js';
import { DEMO_SEEDERS } from '../../server/src/lib/demo/seeders.js';
import { HOST_HEADER, cookieFrom, fakeClock } from './helpers.js';

const PHASE1_SEEDERS = DEMO_SEEDERS.slice(0, 4);
let t: Awaited<ReturnType<typeof buildApp>>;
let auth: { cookie: string; csrf: string };
const get = async (url: string) => {
  const r = await t.app.inject({ method: 'GET', url, headers: { ...HOST_HEADER, cookie: auth.cookie } } as InjectOptions);
  expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
  return r.json();
};

beforeAll(async () => {
  expect(PHASE1_SEEDERS.map((s) => s.name)).toEqual(['opening-balances', 'banking', 'investments', 'budgets']);
  const clock = fakeClock(); // 2026-11-11
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-golden-'));
  await generateDemoData(dir, '2026-11-11', clock.now(), PHASE1_SEEDERS);
  const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
  t = await buildApp({
    db: openDatabase(dir),
    now: clock.now,
    webDistDir: '/nonexistent',
    port: 4040,
    backupDir: tmp('arc40-golden-bk-'),
    demoDir: tmp('arc40-golden-demo-'),
    dataDir: tmp('arc40-golden-data-'),
  });
  const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: DEMO_PASSWORD } });
  auth = { cookie: cookieFrom(login), csrf: login.json().csrfToken };
});
afterAll(async () => {
  await t.app.close();
});

it('every income and spending total matches the recorded baseline', async () => {
  const cats = (await get('/api/categories')).categories as { id: number; name: string }[];
  const out: Record<string, unknown> = {};

  for (const m of ['2026-11-01', '2026-10-01', '2026-03-01', '2025-12-01']) {
    const b = await get(`/api/budget?month=${m}`);
    out[`budget ${m}`] = b;
  }
  out.cashflow24 = await get('/api/cashflow?months=24');
  out.cashflow12 = await get('/api/cashflow?months=12');
  out.dashboard = await get('/api/dashboard');
  const goals = await get('/api/goals?year=2026');
  // `pace` (V2 Phase 3) is new and not a total; it is left out so the recorded baseline stays byte-for-byte.
  const withoutPace = ({ pace: _pace, ...rest }: Record<string, unknown>) => rest;
  out.goals = { roth: withoutPace(goals.roth), emergency: goals.emergency };
  const goals25 = await get('/api/goals?year=2025');
  out.goals2025 = { roth: withoutPace(goals25.roth) };

  const sums = async (q: string) => (await get(`/api/transactions?limit=1${q}`)) as { total: number; sums: unknown };
  out.txAll = await sums('').then((r) => ({ total: r.total, sums: r.sums }));
  for (const typ of ['income', 'expense', 'transfer', 'gift']) {
    out[`tx type ${typ}`] = await sums(`&type=${typ}`).then((r) => ({ total: r.total, sums: r.sums }));
  }
  out.txUncategorized = await sums('&categoryId=none').then((r) => ({ total: r.total, sums: r.sums }));
  for (const c of cats) out[`tx cat ${c.name}`] = await sums(`&categoryId=${c.id}`).then((r) => ({ total: r.total, sums: r.sums }));
  out.txRange = await sums('&from=2026-01-01&to=2026-06-30').then((r) => ({ total: r.total, sums: r.sums }));
  out.txSearch = await sums('&q=coffee').then((r) => ({ total: r.total, sums: r.sums }));

  await expect(JSON.stringify(out, null, 1)).toMatchFileSnapshot('./__golden__/totals.json');
});
