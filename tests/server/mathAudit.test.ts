/**
 * Phase 3 math audit (M7). Every Phase 3 number is recomputed a SECOND, independent way and compared, over many
 * inputs (a fixed seeded generator, so the test is repeatable):
 *   - compounding vs plain float math (amount x (1 + r)^(months / 12)), to the cent;
 *   - the two-pool simulation vs a float re-implementation of the same rules, and its accounting identity;
 *   - years until FI vs a brute-force month count;
 *   - work cost tenths vs the definition "nearest tenth, halves up";
 *   - Roth "needed per month" is the smallest whole-cent amount that gets there; status agrees with months of pace;
 *   - future-you months vs a calendar count of months to the birthday;
 *   - the What if page vs the other screens on the demo data (net worth today, the shared income/spending totals,
 *     savings rate, FI = 25 x yearly spending, money only moving when the Roth amount changes).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOST_HEADER, cookieFrom, fakeClock } from './helpers.js';
import { buildApp } from '../../server/src/app.js';
import { openDatabase } from '../../server/src/db/database.js';
import { DEMO_PASSWORD, generateDemoData } from '../../server/src/lib/demo/index.js';
import { firstMonthReaching, futureYou, growLump, investedPart, monthlyFactor, simulate, FACTOR_SCALE } from '../../server/src/lib/projection.js';
import { jobRate, workTenths, type WorkRate } from '../../server/src/lib/workCost.js';
import { idealOn, monthsLeft, paceStatus, rothPace } from '../../server/src/lib/rothPace.js';
import { savingsRateBp } from '../../server/src/lib/cashflow.js';

/** Small seeded generator (mulberry32) so every run checks the same inputs. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

describe('compounding vs plain math', () => {
  it('2,000 random amounts, rates and spans agree with amount x (1 + r)^(months/12) to within 1 cent', () => {
    const r = rng(1);
    for (let i = 0; i < 2_000; i++) {
      const amount = int(r, 1, 1_000_000_000); // 1 cent .. $10M
      const bp = int(r, 0, 1_500);
      const months = int(r, 0, 1_200);
      const exact = amount * Math.pow(1 + bp / 10_000, months / 12);
      // Plain float math has its own error of about 1 part in 10^14, which only matters for values over about
      // $1 trillion (see the next test, checked with 60-digit math); below that the two agree to 1 cent.
      const allowed = Math.max(1, exact * 2e-14);
      expect(Math.abs(growLump(amount, bp, months) - Math.round(exact)), `${amount} @ ${bp}bp for ${months}m`).toBeLessThanOrEqual(allowed);
    }
  });

  it('a case where plain float math is off by a cent: the engine matches 60-digit math', () => {
    // $3,466,777.37 at 14% for 1,183 months = 141,187,380,458,965.4435... cents (Python Decimal, 60 digits).
    // Float math gives ...964.2; the engine gives the correctly rounded ...965.
    expect(growLump(346_677_737, 1_400, 1_183)).toBe(141_187_380_458_965);
  });

  it('twelve monthly factors make exactly one yearly factor (to 18 decimal places)', () => {
    for (let bp = 0; bp <= 1_500; bp += 25) {
      const f = monthlyFactor(bp);
      const year = (BigInt(10_000 + bp) * FACTOR_SCALE) / 10_000n;
      let p = FACTOR_SCALE;
      for (let m = 0; m < 12; m++) p = (p * f) / FACTOR_SCALE;
      expect(year - p >= 0n && year - p <= 30n, `${bp}bp`).toBe(true);
    }
  });

  it('more time or a higher rate never gives less', () => {
    const r = rng(2);
    for (let i = 0; i < 500; i++) {
      const a = int(r, 1, 10_000_000);
      const bp = int(r, 0, 1_499);
      const m = int(r, 0, 1_199);
      expect(growLump(a, bp, m + 1)).toBeGreaterThanOrEqual(growLump(a, bp, m));
      expect(growLump(a, bp + 1, m)).toBeGreaterThanOrEqual(growLump(a, bp, m));
    }
  });
});

describe('two-pool simulation vs a float re-implementation', () => {
  /** The same rules, written again with plain numbers. */
  function reference(start: { cash: number; inv: number }, bp: number, months: number, money: (m: number) => { s: number; t: number }) {
    const f = Math.pow(1 + bp / 10_000, 1 / 12);
    let cash = start.cash;
    let inv = start.inv;
    const out = [{ cash, inv }];
    for (let m = 1; m <= months; m++) {
      inv *= f;
      const { s, t } = money(m);
      cash += s - t;
      inv += t;
      if (cash < 0) {
        inv += cash;
        cash = 0;
      }
      out.push({ cash, inv });
    }
    return out;
  }

  it('300 random paths (savings, moves, shortfalls) agree to within 2 cents every month', () => {
    const r = rng(3);
    for (let i = 0; i < 300; i++) {
      const start = { cash: int(r, 0, 5_000_000), inv: int(r, 0, 20_000_000) };
      const bp = int(r, 0, 1_500);
      const months = int(r, 1, 600);
      const sav = int(r, -60_000, 300_000);
      const mv = int(r, 0, 200_000);
      const money = () => ({ s: sav, t: mv });
      const eng = simulate({ months, yearlyReturnBp: bp, startCashCents: start.cash, startInvestedCents: start.inv, money: () => ({ savingsCents: sav, toInvestedCents: mv }) });
      const ref = reference(start, bp, months, money);
      for (let m = 0; m <= months; m += Math.max(1, Math.floor(months / 25))) {
        expect(Math.abs(eng[m]!.cashCents - Math.round(ref[m]!.cash)), `cash path ${i} month ${m}`).toBeLessThanOrEqual(2);
        expect(Math.abs(eng[m]!.investedCents - Math.round(ref[m]!.inv)), `invested path ${i} month ${m}`).toBeLessThanOrEqual(2);
      }
      // Accounting identity at the end: net worth = start + all savings + all growth (moves never add money).
      const end = eng.at(-1)!;
      expect(Math.abs(end.netWorthCents - (start.cash + start.inv + months * sav + end.growthCents))).toBeLessThanOrEqual(2);
    }
  });

  it('years until FI: the engine month equals a brute-force count (cash never counts)', () => {
    const r = rng(4);
    for (let i = 0; i < 200; i++) {
      const inv0 = int(r, 0, 5_000_000);
      const cash0 = int(r, 0, 50_000_000);
      const bp = int(r, 0, 1_200);
      const sav = int(r, 0, 300_000);
      const share = { num: int(r, 0, sav), den: Math.max(sav, 1) };
      const put = investedPart(sav, sav > 0 ? share : null);
      const target = int(r, 100_000, 300_000_000);
      const pts = simulate({ months: 600, yearlyReturnBp: bp, startCashCents: cash0, startInvestedCents: inv0, money: () => ({ savingsCents: sav, toInvestedCents: put }) });
      const engine = firstMonthReaching(pts, target);
      // Brute force on invested money only.
      const f = Math.pow(1 + bp / 10_000, 1 / 12);
      let inv = inv0;
      let brute: number | null = inv >= target ? 0 : null;
      for (let m = 1; m <= 600 && brute === null; m++) {
        inv = inv * f + put;
        if (inv >= target - 0.5) brute = m; // engine rounds to the cent on the way out
      }
      if (engine !== brute) {
        // Only allowed when the two land within a cent of the target on the boundary month.
        const m = (engine ?? brute)!;
        expect(Math.abs(pts[m]!.investedCents - target)).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('work cost vs its definition (nearest tenth, halves up)', () => {
  it('10,000 random costs and pay rates (games, hourly, salary / 2,080)', () => {
    const r = rng(5);
    for (let i = 0; i < 10_000; i++) {
      const cost = int(r, 1, 50_000_000);
      const kind = int(r, 0, 2);
      const rate: WorkRate =
        kind === 0
          ? { unit: 'game', title: null, num: int(r, 100, 1_000_000), den: 1 }
          : jobRate({ id: 1, title: 'X', payKind: kind === 1 ? 'hourly' : 'salary', payCents: kind === 1 ? int(r, 100, 100_000) : int(r, 100_000, 1_000_000_000) });
      const t = workTenths(cost, rate);
      // |t/10 - cost/(num/den)| <= 1/20, written without division: |t*num - cost*10*den| * 2 <= num, ties go up.
      const diff = BigInt(t) * BigInt(rate.num) - BigInt(cost) * 10n * BigInt(rate.den);
      const twice = (diff < 0n ? -diff : diff) * 2n;
      expect(twice <= BigInt(rate.num), `cost ${cost} rate ${rate.num}/${rate.den}`).toBe(true);
      if (twice === BigInt(rate.num)) expect(diff > 0n).toBe(true); // exactly half: rounded up
    }
  });
});

describe('Roth pace from the other direction', () => {
  it('needed per month is the smallest whole-cent amount that reaches the target in the months left', () => {
    const r = rng(6);
    for (let i = 0; i < 2_000; i++) {
      const limit = int(r, 100_000, 2_000_000);
      const contributed = int(r, 0, limit);
      const day = int(r, 0, 469);
      const today = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      const p = rothPace({ year: 2026, limitCents: limit, deadline: '2027-04-15', today, contributions: [{ date: '2026-01-01', amountCents: contributed }], earnedCents: limit });
      const left = monthsLeft(today, '2027-04-15');
      const need = p.limit.neededPerMonthCents!;
      expect(need * left).toBeGreaterThanOrEqual(limit - contributed);
      if (need > 0) expect((need - 1) * left).toBeLessThan(limit - contributed);
      // The status agrees with the gap measured in (unrounded) months of pace.
      if (p.status !== 'maxed') {
        const months = ((idealOn(limit, '2026-01-01', '2027-04-15', today) - contributed) * 16) / limit;
        const expected = months < -0.5 ? 'ahead' : months <= 0.5 ? 'on_pace' : months <= 2 ? 'behind_slightly' : 'behind_well';
        expect(p.status, `${limit} ${contributed} ${today}`).toBe(expected);
        expect(paceStatus(p.gapCents, limit, 16)).toBe(expected);
      }
    }
  });

  it('the ideal line never goes backwards and ends exactly on the limit', () => {
    let prev = -1;
    for (let d = 0; d <= 469; d++) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      const v = idealOn(750_000, '2026-01-01', '2027-04-15', day);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(prev).toBe(750_000);
  });
});

describe('future you vs a calendar count', () => {
  it('months to the birthday month match counting calendar months one by one', () => {
    const r = rng(7);
    for (let i = 0; i < 500; i++) {
      const birth = { year: int(r, 1965, 2010), month: int(r, 1, 12) };
      const day = int(r, 0, 3_650);
      const today = new Date(Date.UTC(2020, 0, 1 + day)).toISOString().slice(0, 10);
      const age = int(r, 20, 65);
      // Count months from today's month until year/month = birth.year + age / birth.month.
      let y = Number(today.slice(0, 4));
      let mo = Number(today.slice(5, 7));
      let count = 0;
      const ty = birth.year + age;
      if (ty * 12 + birth.month > y * 12 + mo) {
        while (y !== ty || mo !== birth.month) {
          mo++;
          if (mo > 12) {
            mo = 1;
            y++;
          }
          count++;
        }
      }
      const f = futureYou(10_000, birth, today, 700, age)!;
      expect(f.months, `${JSON.stringify(birth)} ${today} age ${age}`).toBe(count);
      expect(f.valueCents).toBe(growLump(10_000, 700, count));
    }
  });
});

// ---------------------------------------------------------------------------------------------
// What if vs the other screens, on the full demo data.
// ---------------------------------------------------------------------------------------------

describe('What if agrees with the rest of Arc40 (demo data)', () => {
  let t: Awaited<ReturnType<typeof buildApp>>;
  let auth: { cookie: string; csrf: string };
  const call = (opts: InjectOptions) => t.app.inject({ ...opts, headers: { ...HOST_HEADER, cookie: auth.cookie, 'x-csrf-token': auth.csrf } });
  const get = async (url: string) => (await call({ method: 'GET', url })).json();
  const project = async (payload: object) => {
    const r = await call({ method: 'POST', url: '/api/what-if/project', payload: { baselineMonths: 6, range: '10y', scenarios: [], ...payload } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  beforeAll(async () => {
    const at = Date.UTC(2026, 10, 11, 12);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-audit-'));
    await generateDemoData(dir, '2026-11-11', at);
    const tmp = (p: string) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    t = await buildApp({ db: openDatabase(dir), now: fakeClock(at).now, webDistDir: '/nonexistent', port: 4040, dataDir: tmp('arc40-audit-d-'), demoDir: tmp('arc40-audit-m-'), backupDir: tmp('arc40-audit-b-') });
    const login = await t.app.inject({ method: 'POST', url: '/api/auth/login', headers: HOST_HEADER, payload: { password: DEMO_PASSWORD } });
    auth = { cookie: cookieFrom(login), csrf: login.json().csrfToken };
  });
  afterAll(async () => {
    await t.app.close();
  });

  it('net worth today is the same as the Accounts page and the net worth chart', async () => {
    const w = await project({});
    const nw = await get('/api/networth?range=1m');
    expect(w.current.series[0].netWorthCents).toBe(nw.current.totalCents);
    expect(w.baseline.cashCents + w.baseline.investedCents).toBe(nw.current.totalCents); // the demo has no debts
  });

  it.each([3, 6, 12])('the %i-month baseline is the average of the Budget / cash flow months', async (n) => {
    const w = await project({ baselineMonths: n });
    const flow = await get('/api/cashflow?months=24');
    const months = (flow.months as { month: string; incomeCents: number; spendingCents: number }[]).filter((m) => m.month < '2026-11-01').slice(-n);
    const avg = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
    expect(w.baseline.monthsUsed).toBe(n);
    expect(w.baseline.incomeCents).toBe(avg(months.map((m) => m.incomeCents)));
    expect(w.baseline.spendingCents).toBe(avg(months.map((m) => m.spendingCents)));
    expect(w.current.savingsRateBp).toBe(savingsRateBp(w.baseline.incomeCents, w.baseline.spendingCents));
    expect(w.current.fi.numberCents).toBe(25 * 12 * w.baseline.spendingCents);
  });

  it('a spending cut adds exactly that much to monthly savings; FI uses the new spending', async () => {
    const cats = (await get('/api/categories')).categories as { name: string; id: number }[];
    const food = cats.find((c) => c.name === 'Food')!.id;
    const w = await project({ scenarios: [{ name: 'Cut', changes: [{ kind: 'spending', categoryId: food, direction: 'down', amount: '25' }] }] });
    expect(w.scenarios[0].savingsCents - w.current.savingsCents).toBe(2_500);
    expect(w.scenarios[0].fi.numberCents).toBe(25 * 12 * (w.current.spendingCents - 2_500));
  });

  it('at 0% return, net worth grows by savings only, and a bigger Roth amount only moves money', async () => {
    const w = await project({
      range: '5y',
      scenarios: [
        { name: 'Zero', changes: [{ kind: 'return', rate: '0' }] },
        { name: 'Zero + Roth', changes: [{ kind: 'return', rate: '0' }, { kind: 'roth', monthly: '200' }] },
      ],
    });
    const [zero, roth] = w.scenarios;
    expect(zero.end.netWorthCents).toBe(zero.series[0].netWorthCents + 60 * zero.savingsCents);
    expect(roth.end.netWorthCents).toBe(zero.end.netWorthCents);
    expect(roth.end.investedCents).toBeGreaterThan(zero.end.investedCents);
  });

  it('a higher return never reaches FI later, and a lower one never sooner', async () => {
    const w = await project({ range: 'to65', scenarios: [{ name: 'Low', changes: [{ kind: 'return', rate: '4' }] }, { name: 'High', changes: [{ kind: 'return', rate: '10' }] }] });
    const m = (p: { fi: { month: number | null } }) => p.fi.month ?? Infinity;
    expect(m(w.scenarios[1])).toBeLessThanOrEqual(m(w.current));
    expect(m(w.scenarios[0])).toBeGreaterThanOrEqual(m(w.current));
  });
});
