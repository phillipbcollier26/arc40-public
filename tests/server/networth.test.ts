import { describe, expect, it } from 'vitest';
import {
  type NwFlow,
  changeBasisPoints,
  chartDates,
  netWorthOn,
  netWorthSeries,
  rangeStart,
  type NwAccount,
  type NwSnapshot,
} from '../../server/src/lib/networth.js';

const checking: NwAccount = { id: 1, class: 'asset' };
const hysa: NwAccount = { id: 2, class: 'asset' };
const roth: NwAccount = { id: 3, class: 'asset' };
const card: NwAccount = { id: 4, class: 'liability' };

const snap = (accountId: number, asOf: string, balanceCents: number): NwSnapshot => ({
  accountId,
  asOf,
  balanceCents,
});

describe('netWorthOn', () => {
  it('is zero with no data', () => {
    expect(netWorthOn([checking], [], '2026-11-11').totalCents).toBe(0);
  });

  it('uses the latest snapshot on or before the date', () => {
    const snaps = [snap(1, '2026-01-01', 10_000), snap(1, '2026-02-01', 25_000), snap(1, '2026-03-01', 5_000)];
    expect(netWorthOn([checking], snaps, '2025-12-31').totalCents).toBe(0);
    expect(netWorthOn([checking], snaps, '2026-01-01').totalCents).toBe(10_000);
    expect(netWorthOn([checking], snaps, '2026-01-31').totalCents).toBe(10_000);
    expect(netWorthOn([checking], snaps, '2026-02-01').totalCents).toBe(25_000);
    expect(netWorthOn([checking], snaps, '2030-01-01').totalCents).toBe(5_000);
  });

  it('adds accounts whose snapshots are on different dates', () => {
    const snaps = [snap(1, '2026-01-05', 50_000), snap(2, '2026-01-20', 300_000), snap(3, '2026-02-10', 700_000)];
    const p = netWorthOn([checking, hysa, roth], snaps, '2026-01-31');
    expect(p.totalCents).toBe(350_000);
    expect(p.byAccount).toEqual({ 1: 50_000, 2: 300_000 });
    expect(netWorthOn([checking, hysa, roth], snaps, '2026-02-10').totalCents).toBe(1_050_000);
  });

  it('subtracts liabilities (future credit cards)', () => {
    const snaps = [snap(1, '2026-01-01', 100_000), snap(4, '2026-01-01', 12_345)];
    const p = netWorthOn([checking, card], snaps, '2026-01-02');
    expect(p.assetsCents).toBe(100_000);
    expect(p.liabilitiesCents).toBe(12_345);
    expect(p.totalCents).toBe(87_655);
    expect(p.byAccount[4]).toBe(-12_345);
  });

  it('handles an overdrawn (negative) checking balance', () => {
    const p = netWorthOn([checking, hysa], [snap(1, '2026-01-01', -2_500), snap(2, '2026-01-01', 10_000)], '2026-01-01');
    expect(p.totalCents).toBe(7_500);
  });

  it('ignores snapshots for unknown accounts', () => {
    expect(netWorthOn([checking], [snap(99, '2026-01-01', 1_000_000)], '2026-01-02').totalCents).toBe(0);
  });

  it('refuses non-integer balances', () => {
    expect(() => netWorthOn([checking], [snap(1, '2026-01-01', 10.5)], '2026-01-02')).toThrow();
  });
});

describe('netWorthSeries', () => {
  it('matches netWorthOn at every date and returns sorted, unique dates', () => {
    const accounts = [checking, hysa, roth, card];
    const snaps = [
      snap(1, '2026-01-01', 40_000),
      snap(2, '2026-01-15', 200_000),
      snap(1, '2026-02-01', 35_012),
      snap(3, '2026-02-14', 650_099),
      snap(4, '2026-03-01', 4_201),
      snap(2, '2026-03-15', 215_000),
    ];
    const dates = ['2026-03-31', '2026-01-01', '2026-02-14', '2026-01-01', '2025-12-01'];
    const series = netWorthSeries(accounts, snaps, dates);
    expect(series.map((p) => p.date)).toEqual(['2025-12-01', '2026-01-01', '2026-02-14', '2026-03-31']);
    for (const p of series) {
      expect(p.totalCents).toBe(netWorthOn(accounts, snaps, p.date).totalCents);
      expect(Number.isInteger(p.totalCents)).toBe(true);
    }
    expect(series[3]!.totalCents).toBe(35_012 + 215_000 + 650_099 - 4_201);
  });

  it('is exact for many small amounts (no float drift)', () => {
    const accounts = Array.from({ length: 50 }, (_, i) => ({ id: i + 1, class: 'asset' as const }));
    const snaps = accounts.map((a) => snap(a.id, '2026-01-01', 10)); // ten cents each
    expect(netWorthOn(accounts, snaps, '2026-01-01').totalCents).toBe(500);
  });
});

describe('chart helpers', () => {
  it('chartDates includes start, change dates inside the range, and end', () => {
    const snaps = [snap(1, '2025-12-01', 1), snap(1, '2026-02-01', 1), snap(2, '2026-02-01', 1), snap(1, '2026-05-01', 1)];
    expect(chartDates(snaps.map((x) => x.asOf), '2026-01-01', '2026-03-31')).toEqual(['2026-01-01', '2026-02-01', '2026-03-31']);
  });

  it('rangeStart', () => {
    expect(rangeStart('3m', '2026-11-11', null)).toBe('2026-08-11');
    expect(rangeStart('1y', '2026-11-11', null)).toBe('2025-11-11');
    expect(rangeStart('all', '2026-11-11', '2024-06-01')).toBe('2024-06-01');
    expect(rangeStart('all', '2026-11-11', null)).toBe('2026-10-12');
  });

  it('changeBasisPoints handles zero and negative starts', () => {
    expect(changeBasisPoints(100_00, 110_00)).toBe(1000); // +10.00%
    expect(changeBasisPoints(100_00, 90_00)).toBe(-1000);
    expect(changeBasisPoints(0, 500_00)).toBeNull();
    expect(changeBasisPoints(-100_00, -50_00)).toBe(5000); // debt shrinking is a gain
  });
});

describe('history filled in from transactions (no gaps, no fake losses)', () => {
  const wpcuSavings: NwAccount = { id: 10, class: 'asset' };
  const brokerage: NwAccount = { id: 11, class: 'asset', isInvestment: true };
  const cfSavings: NwAccount = { id: 12, class: 'asset' };
  const flow = (accountId: number, date: string, amountCents: number): NwFlow => ({ accountId, date, amountCents });

  it('a transfer to an account with no balance history does not look like money vanishing', () => {
    // Credit union savings has daily balances from its CSV; Fidelity only has today's balance you typed in.
    const snaps = [snap(10, '2026-09-18', 2_051_769), snap(10, '2026-09-29', 100_500), snap(11, '2026-11-11', 1_911_699)];
    const flows = [flow(10, '2026-09-29', -1_951_269), flow(11, '2026-09-29', 1_951_269)];
    const s = netWorthSeries([wpcuSavings, brokerage], snaps, ['2026-09-28', '2026-09-29', '2026-10-15', '2026-11-11'], flows);
    expect(s.map((p) => p.totalCents)).toEqual([
      2_051_769, // before: all in savings
      100_500 + 1_951_269, // after: same money, now mostly at Fidelity (cost basis)
      100_500 + 1_951_269,
      100_500 + 1_911_699, // today: Fidelity's real value
    ]);
  });

  it('an investment account before its first balance shows money put in, never a negative', () => {
    const s = netWorthSeries([brokerage], [snap(11, '2026-11-11', 1_911_699)], ['2026-09-01', '2026-10-01'], [flow(11, '2026-09-29', 1_951_269)]);
    expect(s[0]!.byAccount[11]).toBeUndefined(); // did not exist yet
    expect(s[1]!.byAccount[11]).toBe(1_951_269);
  });

  it('a bank account without a balance column is worked backward from the balance you entered', () => {
    // Bank savings: opened with 4,500, interest, a 55 transfer out; balance entered today.
    const flows = [flow(12, '2026-07-15', 450_000), flow(12, '2026-07-31', 824), flow(12, '2026-09-30', -5_500), flow(12, '2026-10-31', 1_499)];
    const today = 450_000 + 824 - 5_500 + 1_499;
    const s = netWorthSeries([cfSavings], [snap(12, '2026-11-11', today)], ['2026-07-01', '2026-07-15', '2026-08-01', '2026-10-01', '2026-11-11'], flows);
    expect(s.map((p) => p.byAccount[12])).toEqual([undefined, 450_000, 450_824, 445_324, today]);
  });

  it('transactions after the last balance move it forward', () => {
    const s = netWorthSeries([checking], [snap(1, '2026-10-01', 50_000)], ['2026-10-20'], [flow(1, '2026-10-05', -1_250), flow(1, '2026-09-01', -999)]);
    expect(s[0]!.totalCents).toBe(48_750);
  });

  it('an account with only transactions is their running total', () => {
    const s = netWorthSeries([checking], [], ['2026-01-01', '2026-02-01'], [flow(1, '2026-01-10', 2_000), flow(1, '2026-01-20', -500)]);
    expect(s.map((p) => p.byAccount[1])).toEqual([undefined, 1_500]);
  });

  it('a later balance you enter always wins over the running total', () => {
    const s = netWorthSeries([checking], [snap(1, '2026-01-01', 10_000), snap(1, '2026-02-01', 9_000)], ['2026-02-02'], [flow(1, '2026-01-15', -2_000)]);
    expect(s[0]!.totalCents).toBe(9_000);
  });
});
