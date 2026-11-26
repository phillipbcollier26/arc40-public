/**
 * Trophy audit (Nov 2026, after Round 4): every trophy checked against what it tracks, and the "full bar but not earned"
 * fix. Fake data only.
 *
 * A user saw "Gear paid off 10x" with a full bar and "2026 so far: ref pay $X, ref costs $Y" but not earned: the
 * rule only judges a FINISHED year (correct), but the bar and the card's line did not say it was waiting for Dec 31.
 * Now a full bar always means earned (`shownProgress` stops an unearned one at 95%), and every rule that is ahead while a month or year is still
 * running says when it counts.
 *
 * The whole-catalog audit turns on every trophy (from scratch, Count my history) on demo data for several build dates and
 * checks: no full bar unless earned (and a capped bar says when it counts), no earned date after today or before the
 * first data day, ladders earned in order, the 30-day holds equal a brute-force recount, a second check earns nothing,
 * no broken text, and Start from today never earns a past date.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TROPHIES, TROPHY_GROUPS } from '../../shared/trophies.js';
import { refCoversSpending, refGear10x, refRecordMonth, refRecordYear, refUpYear, type RefFacts } from '../../server/src/lib/trophies/refereeingRules.js';
import { nwBestYear, nwHigh } from '../../server/src/lib/trophies/netWorthRules.js';
import { dailySeries, TrophyData } from '../../server/src/lib/trophies/data.js';
import { everyDay } from '../../server/src/lib/trophies/hold.js';
import { WAITING_FRACTION } from '../../server/src/lib/trophies/format.js';
import { evaluateTrophies, shownProgress, trophyDetail, trophyViews, turnOnGroup, turnOnTrophy } from '../../server/src/lib/trophies/engine.js';
import { generateDemoData } from '../../server/src/lib/demo/index.js';
import { openDatabase } from '../../server/src/db/database.js';

const A = (today: string, from: string | null = null) => ({ today, from, year: null });
const D = 100;

function ref(p: Partial<RefFacts> & { pay?: [string, number][]; cost?: [string, number][] } = {}): RefFacts {
  return {
    hasCategory: true,
    income: (p.pay ?? []).map(([date, d]) => ({ date, cents: d * D })),
    costs: (p.cost ?? []).map(([date, d]) => ({ date, cents: d * D })),
    spendingInMonth: () => 0,
    firstDataDate: '2025-01-02',
    ...p,
  };
}

describe('a full bar only when earned', () => {
  it('shownProgress stops an unearned full bar at 95% (99% still looked full) and keeps everything else', () => {
    const full = { fraction: 1, score: 1, text: 'x', need: null };
    expect(WAITING_FRACTION).toBe(0.95);
    expect(shownProgress(full, false)).toMatchObject({ fraction: WAITING_FRACTION, score: 1 }); // stays top of Closest
    expect(shownProgress(full, true)).toBe(full);
    expect(shownProgress({ fraction: 0.4, score: 0.4, text: 'x', need: null }, false).fraction).toBe(0.4);
    // "Ready: it is earned at the next check" keeps its top score for Closest to earning.
    expect(shownProgress({ fraction: 1, score: 2, text: 'x', need: null }, false)).toMatchObject({ fraction: WAITING_FRACTION, score: 2 });
  });

  it('the reported case: Gear paid off 10x with $1,500 of ref pay on $50 of costs waits for Dec 31 and says so', () => {
    // 2026 so far: $1,500 / $50 = 30, so 30x. Not earned until 2026 has ended.
    const f = ref({ pay: [['2026-04-11', 700], ['2026-10-03', 800]], cost: [['2026-03-01', 50]] });
    const o = refGear10x(f, A('2026-11-25'));
    expect(o.earned).toBeNull();
    expect(o.progress.text).toBe('2026 so far: ref pay is 30x your ref costs. Counts on Dec 31 if it stays at 10x or more.');
    expect(o.progress.need).toBe('Ref pay $1,500, ref costs $50.');
    expect(shownProgress(o.progress, false).fraction).toBe(WAITING_FRACTION);
    // On Jan 1 the year has ended: earned, dated Dec 31.
    expect(refGear10x(f, A('2027-01-01')).earned?.date).toBe('2026-12-31');
    // Below 10x keeps the old line: 9x is not ahead.
    expect(refGear10x(ref({ pay: [['2026-04-11', 540]], cost: [['2026-03-01', 60]] }), A('2026-11-25')).progress.text).toBe('2026 so far: ref pay $540, ref costs $60');
  });

  it('every other rule that waits for a month or year to end says when it counts once ahead', () => {
    // Record ref year: 2025 (data from January) $1,000; 2026 so far $1,200, ahead.
    const yr = ref({ pay: [['2025-02-01', 1000], ['2026-02-01', 1200]] });
    expect(refRecordYear(yr, A('2026-11-25')).progress.text).toBe('2026 so far $1,200, ahead of your best year. Counts on Dec 31.');
    expect(refRecordYear(yr, A('2026-11-25')).progress.need).toBe('Your best full year: $1,000.');
    expect(refUpYear(yr, A('2026-11-25')).progress.text).toBe('2026 so far $1,200, ahead of 2025. Counts on Dec 31.');
    // Behind: the old wording, never "$0 more".
    const behind = ref({ pay: [['2025-02-01', 1000], ['2026-02-01', 400]] });
    expect(refRecordYear(behind, A('2026-11-25')).progress.need).toBe('$600.01 more by Dec 31');
    // Record ref month: 3 earlier months with pay ($100 best), this month $150 so far.
    const mo = ref({ pay: [['2026-07-03', 100], ['2026-08-03', 90], ['2026-09-03', 80], ['2026-11-04', 150]] });
    expect(refRecordMonth(mo, A('2026-11-25')).progress.text).toBe('This month $150, ahead of your best month. Counts when November ends.');
    // Ref pay covered all spending: $300 of pay, $200 spent so far this month.
    const cov = ref({ pay: [['2026-11-04', 300]], spendingInMonth: (m) => (m === '2026-11' ? 200 * D : 0) });
    expect(refCoversSpending(cov, A('2026-11-25')).progress.text).toBe('This month: ref pay $300 covers spending $200. Counts when November ends.');
    // Net worth: $1,000 at the end of 2024, $3,000 through 2025 (best full year: +$4,000 from Dec 31, 2024 to Dec 31,
    // 2025 at $5,000), $10,000 from Nov 10, 2026: above every month end, and 2026 so far +$5,000, ahead of +$4,000.
    const days = everyDay('2025-12-01', '2026-11-25').map((date) => ({ date, cents: date >= '2026-11-10' ? 1_000_000 : 500_000 }));
    const s = dailySeries([{ date: '2024-12-31', cents: 100_000 }, ...everyDay('2025-01-01', '2025-11-30').map((date) => ({ date, cents: 300_000 })), ...days]);
    expect(nwHigh(s, A('2026-11-25')).progress.text).toBe('Today $10,000, above your best month end. Counts if November ends there.');
    expect(nwBestYear(s, A('2026-11-25')).progress.text).toBe('2026 so far $5,000, ahead of your best year. Counts on Dec 31 if it stays ahead.');
  });
});

// ------------------------------------------------------------------ the whole catalog on demo data

async function demo(today: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-audit-'));
  await generateDemoData(dir, today, Date.parse(`${today}T15:00:00Z`));
  const db = openDatabase(dir);
  db.prepare('DELETE FROM trophy_states').run(); // every rule from scratch
  return db;
}
const at = (d: string) => Date.parse(`${d}T16:00:00Z`);
const ODD = /NaN|undefined|Infinity|\bnull\b|\[object|trophys|\$-0/;

describe('every trophy against what it tracks (demo data, several build dates)', () => {
  for (const today of ['2026-03-02', '2026-11-25', '2026-12-31', '2027-01-15']) {
    it(`${today}: Count my history`, async () => {
      const db = await demo(today);
      for (const g of TROPHY_GROUPS) turnOnGroup(db, g.id, today, at(today));
      turnOnTrophy(db, 'the-arc', 'history', today, at(today));
      db.prepare("UPDATE trophy_states SET mode = 'history', since = ? WHERE state = 'on'").run(today);
      evaluateTrophies(db, today, at(today));
      expect(evaluateTrophies(db, today, at(today))).toEqual([]); // a second check earns nothing more

      const v = trophyViews(db, today);
      expect(v.counts.off).toBe(0);
      const data = new TrophyData(db, today);
      const first = data.long.firstDataDate!;
      const byId = new Map(v.trophies.map((t) => [t.key, t]));
      for (const t of v.trophies) {
        const d = trophyDetail(db, today, t.key)!;
        for (const text of [t.name, t.sentence ?? '', t.progress?.text ?? '', t.progress?.need ?? '', t.blocked ?? '', d.next?.text ?? ''])
          expect(text, t.key).not.toMatch(ODD);
        if (t.state === 'earned') {
          expect(t.earnedOn! <= today, `${t.key} earned ${t.earnedOn}`).toBe(true);
          if (!t.key.startsWith('lg.anniversary')) expect(t.earnedOn! >= first, `${t.key} earned ${t.earnedOn}`).toBe(true);
          expect(t.sentence, t.key).toBeTruthy();
        } else if (t.progress) {
          expect(t.progress.fraction, t.key).toBeGreaterThanOrEqual(0);
          expect(t.progress.fraction, `${t.key} shows a full bar but is not earned`).toBeLessThan(1);
          // A bar stopped at 95% always says when it counts.
          if (t.progress.fraction === WAITING_FRACTION && !t.blocked)
            expect(`${t.progress.text} ${t.progress.need}`, t.key).toMatch(/Counts|earned at the next check/);
        }
      }
      // Ladders: a higher rung earned means every lower rung earned on the same day or before.
      const ladders = new Map<string, string[]>();
      for (const def of TROPHIES) if (def.ladder && !def.yearly) ladders.set(def.ladder, [...(ladders.get(def.ladder) ?? []), def.id]);
      for (const [name, ids] of ladders)
        for (let i = 1; i < ids.length; i++) {
          const hi = byId.get(ids[i]!)!;
          const lo = byId.get(ids[i - 1]!)!;
          if (hi.state === 'earned') expect(lo.state === 'earned' && lo.earnedOn! <= hi.earnedOn!, `${name}: ${ids[i]} before ${ids[i - 1]}`).toBe(true);
        }
      // The 30-day holds equal a brute-force recount of the same daily numbers.
      const series: Record<string, { date: string; cents: number | null }[]> = {
        nw_hold: data.netWorth.days,
        roth_worth_hold: data.rothWorth.days,
        inv_worth_hold: data.investing.worth.days,
        inv_growth_hold: data.investing.growth.days,
        em_savings_hold: data.emergency.savings.days,
      };
      let holds = 0;
      for (const def of TROPHIES) {
        const days = series[def.rule.kind];
        if (!days) continue;
        const line = (def.rule as { lineCents: number }).lineCents;
        let run = 0;
        let hit: string | null = null;
        for (const d of days) {
          run = d.cents !== null && d.cents >= line ? run + 1 : 0;
          if (run === 30) {
            hit = d.date;
            break;
          }
        }
        const t = byId.get(def.id)!;
        expect(t.state === 'earned' ? t.earnedOn : null, def.id).toBe(hit);
        holds++;
      }
      expect(holds).toBeGreaterThan(40);
    }, 120_000);
  }

  it('Start from today never earns a date before the turn-on day', async () => {
    const today = '2026-11-25';
    const db = await demo(today);
    const keys = trophyViews(db, today).trophies.map((t) => t.key);
    const ins = db.prepare("INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', 'today', ?, ?, ?)");
    for (const k of keys) ins.run(k, today, at(today), at(today));
    evaluateTrophies(db, today, at(today));
    for (const t of trophyViews(db, today).trophies) if (t.state === 'earned') expect(t.earnedOn! >= today, `${t.key} earned ${t.earnedOn}`).toBe(true);
  }, 120_000);

  it('demo showcase awards are never dated after the day the demo was built', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-audit-'));
    await generateDemoData(dir, '2026-03-02', Date.parse('2026-03-02T15:00:00Z'));
    const db = openDatabase(dir);
    for (const t of trophyViews(db, '2026-03-02').trophies) if (t.state === 'earned') expect(t.earnedOn! <= '2026-03-02', t.key).toBe(true);
  }, 120_000);
});
