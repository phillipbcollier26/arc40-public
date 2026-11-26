/**
 * Work cost (V2 Phase 3, M4). Fake pay only. Every expected value is worked out by hand in the comment.
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { activeRate, formatWorkCost, hourlyCents, jobRate, spendingCents, workTenths, type WorkRate } from '../../server/src/lib/workCost.js';

const games: WorkRate = { unit: 'game', title: null, num: 6_000, den: 1 }; // $60 a game
const lifeguard = jobRate({ id: 1, title: 'Lifeguard', payKind: 'hourly', payCents: 1_650 }); // $16.50 an hour
const desk = jobRate({ id: 2, title: 'IT Help Desk', payKind: 'salary', payCents: 5_200_000 }); // $52,000 / 2,080 = $25 an hour

describe('work cost math (pure)', () => {
  it.each([
    [21_000, games, 35, '3.5 games'], //                $210 / $60 = 3.5
    [6_000, games, 10, '1.0 game'], //                  one game, singular
    [1_499, games, 2, '0.2 games'], //                  $14.99 / $60 = 0.2498
    [300, games, 1, '0.1 games'], //                    $3 / $60 = 0.05 -> half up -> 0.1
    [299, games, 0, 'under 0.1 games'], //              0.0498 -> 0.0
    [1_234_567, games, 2_058, '205.8 games'], //        $12,345.67 / $60 = 205.761
    [5_000, lifeguard, 30, '3.0 hours as a Lifeguard'], // $50 / $16.50 = 3.0303
    [1_650, lifeguard, 10, '1.0 hour as a Lifeguard'],
    [5_000, desk, 20, '2.0 hours as an IT Help Desk'], //  $50 x 2,080 / $52,000 = 2.0
  ])('%i cents -> %i tenths = %s', (cost, rate, tenths, text) => {
    expect(workTenths(cost, rate)).toBe(tenths);
    expect(formatWorkCost(tenths, rate)).toBe(text);
  });

  it('a yearly salary converts with 2,080 hours (40 a week x 52 weeks), rounded half up once', () => {
    const r = jobRate({ id: 3, title: 'Tutor', payKind: 'salary', payCents: 4_160_000 }); // $41,600 = $20 an hour
    expect(r).toEqual({ unit: 'hour', title: 'Tutor', num: 4_160_000, den: 2_080 });
    expect(workTenths(3_300, r)).toBe(17); // $33 / $20 = 1.65 -> 1.7 (half up)
    expect(workTenths(3_290, r)).toBe(16); // 1.645 -> 1.6
    expect(hourlyCents({ id: 3, title: 'Tutor', payKind: 'salary', payCents: 4_160_000 })).toBe(2_000);
    expect(hourlyCents({ id: 4, title: 'X', payKind: 'salary', payCents: 3_000_000 })).toBe(1_442); // $14.4230... -> $14.42
  });

  it('only spending: an expense with money going out. Income, transfers, gifts and refunds never', () => {
    expect(spendingCents('expense', -1_299)).toBe(1_299);
    expect(spendingCents('expense', 1_299)).toBeNull(); // a refund
    expect(spendingCents('income', 50_000)).toBeNull();
    expect(spendingCents('transfer', -50_000)).toBeNull();
    expect(spendingCents('gift', 10_000)).toBeNull();
    expect(spendingCents('expense', 0)).toBeNull();
  });

  it('which pay is used: off, games or a job; a missing pay or a deleted job means off (never another pay)', () => {
    const jobs = [{ id: 7, title: 'Lifeguard', payKind: 'hourly' as const, payCents: 1_650 }];
    expect(activeRate('off', 6_000, jobs)).toBeNull();
    expect(activeRate('ref', 6_000, jobs)).toEqual(games);
    expect(activeRate('ref', null, jobs)).toBeNull();
    expect(activeRate('job:7', 6_000, jobs)).toEqual({ unit: 'hour', title: 'Lifeguard', num: 1_650, den: 1 });
    expect(activeRate('job:8', 6_000, jobs)).toBeNull();
    expect(activeRate('nonsense', 6_000, jobs)).toBeNull();
  });

  it('refuses floats and bad rates', () => {
    expect(() => workTenths(10.5, games)).toThrow();
    expect(() => workTenths(-1, games)).toThrow();
    expect(() => workTenths(100, { ...games, num: 0 })).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });
const ok = async (opts: InjectOptions) => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBeLessThan(300);
  return r.json();
};
const refused = async (opts: InjectOptions, msg = '') => {
  const r = await call(opts);
  expect(r.statusCode, r.body).toBe(400);
  expect(r.json().error).toContain(msg);
};

describe('work cost API', () => {
  beforeEach(async () => {
    t = await testApp();
    auth = await setupAndLogin(t);
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('starts off, with no pay per game and no jobs', async () => {
    expect(await ok({ method: 'GET', url: '/api/work-cost' })).toEqual({ refPayPerGameCents: null, jobs: [], selection: 'off', active: null });
  });

  it('pay per game, then pick games; picking games without a pay is refused', async () => {
    await refused({ method: 'PUT', url: '/api/work-cost', payload: { selection: 'ref' } }, 'pay per game first');
    const s = await ok({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: '60', selection: 'ref' } });
    expect(s).toMatchObject({ refPayPerGameCents: 6_000, selection: 'ref', active: { unit: 'game', num: 6_000, den: 1 } });
    // Clearing the pay turns work cost off.
    expect(await ok({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: null } })).toMatchObject({ selection: 'off', active: null });
  });

  it('jobs: add hourly and salary, edit, pick one, delete it -> back to Off', async () => {
    const a = (await ok({ method: 'POST', url: '/api/work-jobs', payload: { title: 'Lifeguard', payKind: 'hourly', pay: '16.50' } })).job;
    const b = (await ok({ method: 'POST', url: '/api/work-jobs', payload: { title: 'IT Help Desk', payKind: 'salary', pay: '52,000' } })).job;
    expect(a).toMatchObject({ title: 'Lifeguard', payKind: 'hourly', payCents: 1_650 });
    expect(b).toMatchObject({ payKind: 'salary', payCents: 5_200_000 });
    const picked = await ok({ method: 'PUT', url: '/api/work-cost', payload: { selection: `job:${b.id}` } });
    expect(picked.active).toEqual({ unit: 'hour', title: 'IT Help Desk', num: 5_200_000, den: 2_080 });
    const edited = await ok({ method: 'PATCH', url: `/api/work-jobs/${b.id}`, payload: { title: 'Help Desk', payKind: 'hourly', pay: '30' } });
    expect(edited.active).toEqual({ unit: 'hour', title: 'Help Desk', num: 3_000, den: 1 });
    // Deleting a job that is NOT picked keeps the pick.
    expect((await ok({ method: 'DELETE', url: `/api/work-jobs/${a.id}` })).selection).toBe(`job:${b.id}`);
    // Deleting the picked job falls back to Off.
    expect(await ok({ method: 'DELETE', url: `/api/work-jobs/${b.id}` })).toMatchObject({ selection: 'off', active: null, jobs: [] });
    expect((await call({ method: 'DELETE', url: `/api/work-jobs/${b.id}` })).statusCode).toBe(404);
    await refused({ method: 'PUT', url: '/api/work-cost', payload: { selection: `job:${b.id}` } }, 'no longer exists');
  });

  it('caps and validation', async () => {
    const job = (o: object) => ({ method: 'POST' as const, url: '/api/work-jobs', payload: { title: 'Fake Job', payKind: 'hourly', pay: '15', ...o } });
    await refused(job({ title: 'x'.repeat(41) }), '40 characters');
    await refused(job({ title: '   ' }), 'Type a job title');
    await refused(job({ pay: '0' }), 'above $0');
    await refused(job({ pay: '-5' }));
    await refused(job({ pay: 15 }));
    await refused(job({ pay: '1,000.01' }), 'more than Arc40 allows');
    await refused(job({ payKind: 'salary', pay: '10,000,000.01' }), 'more than Arc40 allows');
    await refused(job({ payKind: 'weekly' }));
    await refused(job({ extra: 1 }));
    await refused({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: '10,000.01' } }, 'more than Arc40 allows');
    await refused({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: 'abc' } }, 'like 45');
    await refused({ method: 'PUT', url: '/api/work-cost', payload: { selection: 'job:abc' } });
    for (let i = 0; i < 20; i++) await ok(job({ title: `Fake Job ${i}` }));
    await refused(job({ title: 'One too many' }), 'up to 20 jobs');
  });

  it('demo mode has its own fake pay and jobs; the real ones are never shown there', async () => {
    await ok({ method: 'PUT', url: '/api/work-cost', payload: { refPayPerGame: '77.77', selection: 'ref' } });
    await ok({ method: 'POST', url: '/api/work-jobs', payload: { title: 'Secret Real Job', payKind: 'hourly', pay: '99' } });
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    auth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken };
    const demo = await ok({ method: 'GET', url: '/api/work-cost' });
    expect(demo).toMatchObject({ refPayPerGameCents: 6_000, selection: 'ref' });
    expect(demo.jobs.map((j: { title: string }) => j.title)).toEqual(['Lifeguard', 'IT Help Desk']);
    expect(JSON.stringify(demo)).not.toMatch(/Secret Real Job|7777/);
  });
});
