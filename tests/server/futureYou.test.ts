/**
 * Future you (V2 Phase 3, M6): the time machine card values and the expense line, plus its Settings switch.
 * Hand-checked with plain math: $50 x 1.07^(months / 12).
 */
import type { InjectOptions } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HOST_HEADER, setupAndLogin, testApp } from './helpers.js';
import { futureYou, wholeDollarsDown } from '../../server/src/lib/projection.js';

const birth = { year: 2007, month: 6 }; // 19 on 2026-11-11
const TODAY = '2026-11-11';

describe('time machine values (pure)', () => {
  it('to 40 by default: 247 months for someone born June 2007 ($50 -> $201.27)', () => {
    expect(futureYou(5_000, birth, TODAY, 700)).toEqual({ age: 40, months: 247, valueCents: 20_127 }); // 50 x 1.07^(247/12) = 201.273
  });
  it('any age on the slider, from the current age (no growth) to 40 and to 65', () => {
    expect(futureYou(5_000, birth, TODAY, 700, 32)).toEqual({ age: 32, months: 151, valueCents: 11_714 }); // 117.143
    expect(futureYou(5_000, birth, TODAY, 700, 19)).toEqual({ age: 19, months: 0, valueCents: 5_000 });
    expect(futureYou(5_000, birth, TODAY, 700, 18)).toEqual({ age: 18, months: 0, valueCents: 5_000 });
    expect(futureYou(5_000, birth, TODAY, 700, 65)!.months).toBe(547);
    expect(futureYou(100_000, birth, TODAY, 700, 65)!.valueCents).toBe(2_184_794); // 1,000 x 1.07^(547/12) = 21,847.94
  });
  it('the prompt example: $50 with 22 years to go is $221 (rounded down to the dollar)', () => {
    const f = futureYou(5_000, { year: 2008, month: 11 }, TODAY, 700)!;
    expect(f).toEqual({ age: 40, months: 264, valueCents: 22_152 }); // 50 x 1.07^22 = 221.520
    expect(wholeDollarsDown(f.valueCents)).toBe('$221');
  });
  it('past 40 it uses 65; past 65 there is nothing to show', () => {
    expect(futureYou(5_000, { year: 1980, month: 1 }, TODAY, 700)!.age).toBe(65);
    expect(futureYou(5_000, { year: 1961, month: 11 }, TODAY, 700)).toBeNull(); // 65 this month
    expect(futureYou(5_000, { year: 1950, month: 1 }, TODAY, 700)).toBeNull();
  });
  it('birthdays at month and year boundaries', () => {
    // Turning 40 next month: 1 month of growth.
    expect(futureYou(100_000, { year: 1986, month: 12 }, TODAY, 1_200)).toEqual({ age: 40, months: 1, valueCents: 100_949 });
    // Turning 40 this month: 40 is reached, so the line moves on to 65.
    expect(futureYou(100_000, { year: 1986, month: 11 }, TODAY, 700)!.age).toBe(65);
    // A January birthday, seen on Dec 31 and Jan 1.
    expect(futureYou(5_000, { year: 2007, month: 1 }, '2026-12-31', 700, 40)!.months).toBe(241);
    expect(futureYou(5_000, { year: 2007, month: 1 }, '2027-01-01', 700, 40)!.months).toBe(240);
  });
  it('0% return keeps the amount; whole dollars round down so the line never says more', () => {
    expect(futureYou(1_349, birth, TODAY, 0)!.valueCents).toBe(1_349);
    expect(wholeDollarsDown(199)).toBe('$1');
    expect(wholeDollarsDown(99)).toBe('$0');
    expect(wholeDollarsDown(123_456_789)).toBe('$1,234,567');
  });
});

let t: Awaited<ReturnType<typeof testApp>>;
let auth: { cookie: string; csrf: string };
const call = (opts: InjectOptions) =>
  t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf, ...(opts.headers ?? {}) } });

describe('the future-you line switch', () => {
  beforeEach(async () => {
    t = await testApp();
    auth = await setupAndLogin(t);
  });
  afterEach(async () => {
    await t.app.close();
  });

  it('is off by default, turns on and off, and refuses anything but true/false', async () => {
    const get = async () => (await call({ method: 'GET', url: '/api/settings/planning' })).json();
    expect(await get()).toMatchObject({ futureYouLine: false, today: TODAY });
    expect((await call({ method: 'PUT', url: '/api/settings/planning', payload: { futureYouLine: true } })).json()).toMatchObject({ futureYouLine: true });
    expect((await call({ method: 'PUT', url: '/api/settings/planning', payload: { futureYouLine: false } })).json()).toMatchObject({ futureYouLine: false });
    expect((await call({ method: 'PUT', url: '/api/settings/planning', payload: { futureYouLine: 'yes' } })).statusCode).toBe(400);
    expect((await get()).futureYouLine).toBe(false);
  });

  it('demo mode has it on with its own fake birth month; the real switch and birth month are untouched', async () => {
    await call({ method: 'PUT', url: '/api/settings/planning', payload: { birth: { year: 1999, month: 2 } } });
    const enter = await call({ method: 'POST', url: '/api/demo/enter' });
    const c = enter.cookies.find((x) => x.name.startsWith('arc40_session_'))!;
    const demoAuth = { cookie: `${c.name}=${c.value}`, csrf: enter.json().csrfToken as string };
    const demo = await t.app.inject({ method: 'GET', url: '/api/settings/planning', headers: { ...HOST_HEADER, cookie: demoAuth.cookie } });
    expect(demo.json()).toMatchObject({ futureYouLine: true, birth: { year: 2007, month: 6 } });
    expect(demo.body).not.toContain('1999');
  });
});
