/**
 * The projection engine (shared/projection.ts, re-exported by server/src/lib/projection.ts).
 * Hand-checked values: each expected number below was worked out separately (calculator / plain
 * float math) and rounded to the cent; the engine itself never uses floats.
 */
import { describe, expect, it } from 'vitest';
import {
  FACTOR_SCALE,
  ageAtMonth,
  ageOn,
  divRound,
  factorPow,
  firstMonthReaching,
  growLump,
  investedPart,
  monthDate,
  monthlyFactor,
  monthsUntilAge,
  simulate,
  type MonthMoney,
} from '../../server/src/lib/projection.js';

describe('compounding (today\'s dollars, monthly, effective yearly rate)', () => {
  it.each([
    // amount cents, yearly bp, months, expected cents          hand check
    [100_000, 700, 12, 107_000], //                              $1,000 x 1.07 = $1,070.00 exactly
    [5_000, 700, 264, 22_152], //                                $50 x 1.07^22 = $221.520087
    [100_000, 700, 120, 196_715], //                             $1,000 x 1.07^10 = $1,967.151357
    [100_000, 500, 120, 162_889], //                             $1,000 x 1.05^10 = $1,628.894627
    [100_000, 1_200, 1, 100_949], //                             $1,000 x 1.12^(1/12) = $1,009.488793
    [250_000, 700, 25, 287_843], //                              $2,500 x 1.07^(25/12) = $2,878.433578
    [100_000, 700, 480, 1_497_446], //                           $1,000 x 1.07^40 = $14,974.457839
    [100_000, 0, 240, 100_000], //                               0%: unchanged
    [100_000, -500, 12, 95_000], //                              -5% a year: $950.00
    [0, 700, 300, 0], //                                         nothing stays nothing
    [-5_000, 700, 12, -5_350], //                                negative amounts are symmetric
    [12_345, 700, 0, 12_345], //                                 0 months: unchanged
  ])('%i cents at %i bp for %i months = %i cents', (amount, bp, months, expected) => {
    expect(growLump(amount, bp, months)).toBe(expected);
  });

  it('the monthly factor is the exact 12th root, rounded down at 18 decimals', () => {
    expect(monthlyFactor(0)).toBe(FACTOR_SCALE);
    const f = monthlyFactor(700);
    expect(f).toBe(1_005_654_145_387_405_277n);
    expect(f ** 12n <= (107n * FACTOR_SCALE ** 12n) / 100n).toBe(true);
    expect((f + 1n) ** 12n > (107n * FACTOR_SCALE ** 12n) / 100n).toBe(true);
    // 12 months of that factor is 1.07 to within 12 units of 10^-18
    const diff = factorPow(f, 12) - 1_070_000_000_000_000_000n;
    expect(diff < 0n ? -diff : diff).toBeLessThanOrEqual(12n);
  });

  it('rounding happens in one place: half away from zero, to the cent, on the way out', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(-4n, 3n)).toBe(-1n);
    // 1 cent for 100 years: carried at millionths of a cent, so it is not lost to early rounding.
    expect(growLump(1, 700, 1200)).toBe(868); // 1.07^100 = 867.716
  });

  it('refuses floats, out-of-range rates and months', () => {
    expect(() => growLump(1.5, 700, 12)).toThrow();
    expect(() => growLump(100, 700.5, 12)).toThrow();
    expect(() => growLump(100, 3_001, 12)).toThrow();
    expect(() => growLump(100, 700, -1)).toThrow();
    expect(() => growLump(100, 700, 1201)).toThrow();
  });
});

describe('two-pool simulation (the accounting model)', () => {
  const flat = (m: MonthMoney) => () => m;

  it('monthly deposits land at the end of each month ($100 a month for a year at 7% = $1,238.03)', () => {
    const p = simulate({ months: 12, yearlyReturnBp: 700, startCashCents: 0, startInvestedCents: 0, money: flat({ savingsCents: 10_000, toInvestedCents: 10_000 }) });
    expect(p.at(-1)!.investedCents).toBe(123_803); // 100 x ((1.07 - 1) / (1.07^(1/12) - 1)) = 1,238.0297
    expect(p.at(-1)!.cashCents).toBe(0);
    expect(p).toHaveLength(13); // month 0 = today
    expect(p[0]).toMatchObject({ month: 0, cashCents: 0, investedCents: 0, netWorthCents: 0 });
  });

  it('cash earns no investment return; invested assets do', () => {
    const p = simulate({ months: 12, yearlyReturnBp: 700, startCashCents: 100_000, startInvestedCents: 100_000, money: flat({ savingsCents: 0, toInvestedCents: 0 }) });
    expect(p.at(-1)).toMatchObject({ cashCents: 100_000, investedCents: 107_000, netWorthCents: 207_000, growthCents: 7_000 });
  });

  it('a transfer from savings to an investment account moves money; it is never counted as savings twice', () => {
    // No new savings, $500 moved each month: net worth stays $1,000 (0% return), the money just moves.
    const p = simulate({ months: 2, yearlyReturnBp: 0, startCashCents: 100_000, startInvestedCents: 0, money: flat({ savingsCents: 0, toInvestedCents: 50_000 }) });
    expect(p.map((x) => [x.cashCents, x.investedCents, x.netWorthCents])).toEqual([
      [100_000, 0, 100_000],
      [50_000, 50_000, 100_000],
      [0, 100_000, 100_000],
    ]);
  });

  it('a Roth contribution inside monthly savings adds the savings once, not savings + contribution', () => {
    // Save $400 a month, $250 of it goes to the Roth. After a year at 0%: +$4,800 net worth, not +$7,800.
    const p = simulate({ months: 12, yearlyReturnBp: 0, startCashCents: 0, startInvestedCents: 0, money: flat({ savingsCents: 40_000, toInvestedCents: 25_000 }) });
    expect(p.at(-1)).toMatchObject({ netWorthCents: 480_000, investedCents: 300_000, cashCents: 180_000 });
  });

  it('when cash runs out, the shortfall comes out of investments (money is never created)', () => {
    const p = simulate({ months: 3, yearlyReturnBp: 0, startCashCents: 50_000, startInvestedCents: 100_000, money: flat({ savingsCents: -30_000, toInvestedCents: 0 }) });
    expect(p.map((x) => [x.cashCents, x.investedCents, x.drewFromInvestments])).toEqual([
      [50_000, 100_000, false],
      [20_000, 100_000, false],
      [0, 90_000, true],
      [0, 60_000, true],
    ]);
    // Moving more than cash holds is the same: you cannot move money you do not have.
    const q = simulate({ months: 1, yearlyReturnBp: 0, startCashCents: 10_000, startInvestedCents: 0, money: flat({ savingsCents: 0, toInvestedCents: 30_000 }) });
    expect(q.at(-1)).toMatchObject({ cashCents: 0, investedCents: 10_000, netWorthCents: 10_000 });
  });

  it('every month, net worth changes by exactly savings + investment growth', () => {
    const money = (m: number): MonthMoney => ({ savingsCents: ((m * 7919) % 50_000) - 15_000, toInvestedCents: (m * 3571) % 20_000 });
    const p = simulate({ months: 240, yearlyReturnBp: 650, startCashCents: 123_456, startInvestedCents: 987_654, fixedCents: -50_000, money });
    for (let m = 1; m < p.length; m++) {
      const growth = p[m]!.growthCents - p[m - 1]!.growthCents;
      // whole-cent rounding of two balances can differ from the unrounded sum by at most 1 cent each
      expect(Math.abs(p[m]!.netWorthCents - p[m - 1]!.netWorthCents - money(m).savingsCents - growth)).toBeLessThanOrEqual(2);
    }
    expect(p.at(-1)!.netWorthCents).toBe(p.at(-1)!.cashCents + p.at(-1)!.investedCents - 50_000);
  });

  it('first month reaching a target, or null when never reached in range', () => {
    const p = simulate({ months: 24, yearlyReturnBp: 0, startCashCents: 0, startInvestedCents: 0, money: flat({ savingsCents: 10_000, toInvestedCents: 10_000 }) });
    expect(firstMonthReaching(p, 0)).toBe(0);
    expect(firstMonthReaching(p, 120_000)).toBe(12);
    expect(firstMonthReaching(p, 120_001)).toBe(13);
    expect(firstMonthReaching(p, 10_000_000)).toBeNull();
  });

  it('invested share of savings: a ratio of whole cents, rounded once; nothing invested from zero or negative savings', () => {
    const share = { num: 30_000, den: 100_000 };
    expect(investedPart(100_000, share)).toBe(30_000);
    expect(investedPart(150_000, share)).toBe(45_000);
    expect(investedPart(1_115, share)).toBe(335); // 334.5 -> 335
    expect(investedPart(0, share)).toBe(0);
    expect(investedPart(-5_000, share)).toBe(0);
    expect(investedPart(100_000, null)).toBe(0);
  });
});

describe('ages from a birth month and year', () => {
  it('a birthday counts from the first day of the birth month', () => {
    const b = { year: 2007, month: 6 };
    expect(ageOn(b, '2026-05-31')).toBe(18);
    expect(ageOn(b, '2026-06-01')).toBe(19);
    expect(monthsUntilAge(b, '2026-06-15', 40)).toBe(252);
    expect(monthsUntilAge(b, '2026-05-15', 40)).toBe(253);
    expect(monthsUntilAge(b, '2026-11-13', 65)).toBe(46 * 12 - 5); // Nov 2026 -> Jun 2072
  });

  it('year boundaries: December and January births', () => {
    expect(ageOn({ year: 2006, month: 12 }, '2026-11-30')).toBe(19);
    expect(ageOn({ year: 2006, month: 12 }, '2026-12-01')).toBe(20);
    expect(ageOn({ year: 2007, month: 1 }, '2026-12-31')).toBe(19);
    expect(ageOn({ year: 2007, month: 1 }, '2027-01-01')).toBe(20);
    expect(monthsUntilAge({ year: 2006, month: 12 }, '2026-12-31', 40)).toBe(240);
    expect(monthsUntilAge({ year: 2007, month: 1 }, '2026-12-31', 40)).toBe(241);
  });

  it('ages already past 40 or 65 give negative months (callers then hide that range)', () => {
    const b = { year: 1980, month: 3 };
    expect(ageOn(b, '2026-11-13')).toBe(46);
    expect(monthsUntilAge(b, '2026-11-13', 40)).toBe(-80);
    expect(monthsUntilAge({ year: 1950, month: 1 }, '2026-11-13', 65)).toBeLessThan(0);
    expect(monthsUntilAge(b, '2020-03-01', 40)).toBe(0); // the month the user turns 40 = month 0
  });

  it('age and date along a projection', () => {
    const b = { year: 2007, month: 6 };
    expect(ageAtMonth(b, '2026-11-13', 0)).toBe(19);
    expect(ageAtMonth(b, '2026-11-13', 7)).toBe(20);
    expect(monthDate('2026-11-13', 0)).toBe('2026-11-01');
    expect(monthDate('2026-11-13', 14)).toBe('2028-01-01');
  });
});
