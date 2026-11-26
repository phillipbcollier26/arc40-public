/**
 * Trophy engine: which trophies exist, their states, the views the page shows, and evaluation.
 *
 * READ-ONLY: trophyViews, trophyDetail (GET routes).
 * WRITES:    evaluateTrophies (POST /api/trophies/evaluate, called by the app after changes, on login and when the
 *            Trophies page opens), turnOnTrophy, turnOnGroup, turnOffTrophy, takeBackTrophy.
 *
 * Earned trophies are permanent: evaluation never looks at them again, except record plaques, which only ever ADD
 * new records. A trophy that is Off is never evaluated (so Take it back is not re-awarded).
 *
 * Yearly trophies: one per year (key id:year), from the first year with data through this year. A new year's trophy
 * that has no row yet is On when last year's trophy of the same kind is On or Earned (same mode); evaluation saves
 * that row. Otherwise it is Off, like every trophy.
 */
import type { DB } from '../../db/database.js';
import type { IsoDate } from '../../../../shared/dates.js';
import {
  ARC_GROUP,
  isCollector,
  SHAPE_LABEL,
  TROPHIES,
  TROPHY_GROUPS,
  parseTrophyKey,
  rankInfo,
  rankLabel,
  trophyKey,
  trophyName,
  type RankId,
  type Shape,
  type TrophyDef,
  type TrophyGroup,
  type TrophyMode,
  type TrophyRule,
  type TrophyState,
} from '../../../../shared/trophies.js';
import { TrophyData, type TrophyEnv } from './data.js';
import {
  tdBackupStreak,
  tdCleanStreak,
  tdFidelityClean,
  tdFirstBackup,
  tdFirstSplit,
  tdImportStreak,
  tdRuleSorted,
  tdRulesMade,
  tdTracked,
  tdTransfersLinked,
} from './tidyRules.js';
import {
  lgAnniversary,
  lgCollector,
  lgCollectorAll,
  lgGoalSet,
  lgGoalsDone,
  lgPerfectMonths,
  lgPerfectYear,
  lgWrapped,
  lgYears,
  theArc,
  arcDay,
} from './longGameRules.js';
import { longDate, WAITING_FRACTION } from './format.js';
import { nwBestYear, nwComeback, nwHigh, nwHold, nwYearGain } from './netWorthRules.js';
import { rothByJune, rothFirst, rothMaxed, rothOnPace, rothTotal, rothWorth, rothYearsMaxed } from './rothRules.js';
import {
  invBestDay,
  invDownMonth,
  invFirstShare,
  invFunds,
  invGrowthBeatsPutIn,
  invGrowthBeatsSpending,
  invGrowthHold,
  invMonthStreak,
  invPassCash,
  invWorthHold,
} from './investingRules.js';
import { refCoversSpending, refGear10x, refLifetime, refMonth, refMonthStreak, refRecordMonth, refRecordYear, refUpYear } from './refereeingRules.js';
import { emFundedStreak, emInterest, emMonthsHold, emRefill, emSavingsHold } from './emergencyRules.js';
import { spBudgetStreak, spCategoryTamed, spCheaperMonth, spEarnStreak, spRateMonth, spRateYear, spSubsCheaper, spSubsCut } from './spendingRules.js';
import { addRecords, claimCelebrations, loadRecords, loadStates, pendingCelebrations, saveAward, takeBack, turnOff, turnOn, type StateRow } from './store.js';
import type { Progress, RecordEntry, RuleArgs, RuleOutcome, Story } from './types.js';

let savepoint = 0;
/** Runs fn atomically; safe to nest (SAVEPOINTs work inside or outside a transaction). */
function transaction<T>(db: DB, fn: () => T): T {
  const name = `trophies_${++savepoint}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const out = fn();
    db.exec(`RELEASE ${name}`);
    return out;
  } catch (err) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw err;
  }
}

export interface Instance {
  key: string;
  def: TrophyDef;
  year: number | null;
}

/**
 * What a trophy that is not earned shows: a full bar always means earned, so a rule that is already ahead of its line
 * while it waits for a month or year to end (or for the next check) stops at 95%. Its score (Closest to earning) is kept:
 * being ahead is as close as it gets. Earned is never touched.
 */
export function shownProgress(p: Progress, earned: boolean): Progress {
  if (earned || p.fraction < 1) return p;
  return { ...p, fraction: WAITING_FRACTION };
}

/** Runs one trophy's rule. Rounds 2 to 4 add cases here. */
export function runRule(data: TrophyData, rule: TrophyRule, args: RuleArgs): RuleOutcome {
  switch (rule.kind) {
    case 'nw_hold':
      return nwHold(data.netWorth, rule.lineCents, args);
    case 'nw_year_gain':
      return nwYearGain(data.netWorth, rule.lineCents, args);
    case 'nw_high':
      return nwHigh(data.netWorth, args);
    case 'nw_best_year':
      return nwBestYear(data.netWorth, args);
    case 'nw_comeback':
      return nwComeback(data.netWorth, args);
    case 'roth_maxed':
      return rothMaxed(data.roth, args);
    case 'roth_on_pace':
      return rothOnPace(data.roth, args);
    case 'roth_by_june':
      return rothByJune(data.roth, args);
    case 'roth_years_maxed':
      return rothYearsMaxed(data.roth, rule.count, rule.inARow, args);
    case 'roth_total':
      return rothTotal(data.roth, rule.lineCents, args);
    case 'roth_worth_hold':
      return rothWorth(data.roth, rule.lineCents, args);
    case 'roth_first':
      return rothFirst(data.roth, args);
    case 'inv_worth_hold':
      return invWorthHold(data.investing, rule.lineCents, args);
    case 'inv_growth_hold':
      return invGrowthHold(data.investing, rule.lineCents, args);
    case 'inv_month_streak':
      return invMonthStreak(data.investing, rule.months, args);
    case 'inv_first_share':
      return invFirstShare(data.investing, args);
    case 'inv_pass_cash':
      return invPassCash(data.investing, args);
    case 'inv_growth_beats_put_in':
      return invGrowthBeatsPutIn(data.investing, args);
    case 'inv_growth_beats_spending':
      return invGrowthBeatsSpending(data.investing, args);
    case 'inv_down_month':
      return invDownMonth(data.investing, args);
    case 'inv_funds':
      return invFunds(data.investing, rule.count, args);
    case 'inv_best_day':
      return invBestDay(data.investing, args);
    case 'ref_lifetime':
      return refLifetime(data.refereeing, rule.lineCents, args);
    case 'ref_month':
      return refMonth(data.refereeing, rule.lineCents, args);
    case 'ref_month_streak':
      return refMonthStreak(data.refereeing, rule.months, args);
    case 'ref_record_month':
      return refRecordMonth(data.refereeing, args);
    case 'ref_record_year':
      return refRecordYear(data.refereeing, args);
    case 'ref_up_year':
      return refUpYear(data.refereeing, args);
    case 'ref_gear_10x':
      return refGear10x(data.refereeing, args);
    case 'ref_covers_spending':
      return refCoversSpending(data.refereeing, args);
    case 'em_months_hold':
      return emMonthsHold(data.emergency, rule.months, args);
    case 'em_funded_streak':
      return emFundedStreak(data.emergency, rule.months, args);
    case 'em_savings_hold':
      return emSavingsHold(data.emergency, rule.lineCents, args);
    case 'em_interest':
      return emInterest(data.emergency, rule.lineCents, args);
    case 'em_refill':
      return emRefill(data.emergency, args);
    case 'sp_earn_streak':
      return spEarnStreak(data.spending, rule.months, args);
    case 'sp_rate_month':
      return spRateMonth(data.spending, rule.bp, args);
    case 'sp_rate_year':
      return spRateYear(data.spending, rule.bp, args);
    case 'sp_budget_streak':
      return spBudgetStreak(data.spending, rule.months, args);
    case 'sp_subs_cut':
      return spSubsCut(data.spending, rule.count, args);
    case 'sp_cheaper_month':
      return spCheaperMonth(data.spending, args);
    case 'sp_subs_cheaper':
      return spSubsCheaper(data.spending, args);
    case 'sp_category_tamed':
      return spCategoryTamed(data.spending, args);
    case 'td_clean_streak':
      return tdCleanStreak(data.tidy, rule.months, args);
    case 'td_import_streak':
      return tdImportStreak(data.tidy, rule.months, args);
    case 'td_tracked':
      return tdTracked(data.tidy, rule.count, args);
    case 'td_rules_made':
      return tdRulesMade(data.tidy, rule.count, args);
    case 'td_rule_sorted':
      return tdRuleSorted(data.tidy, rule.count, args);
    case 'td_backup_streak':
      return tdBackupStreak(data.tidy, rule.months, args);
    case 'td_first_split':
      return tdFirstSplit(data.tidy, args);
    case 'td_transfers_linked':
      return tdTransfersLinked(data.tidy, args);
    case 'td_first_backup':
      return tdFirstBackup(data.tidy, args);
    case 'td_fidelity_clean':
      return tdFidelityClean(data.tidy, args);
    case 'lg_years':
      return lgYears(data.long, rule.years, args);
    case 'lg_goal_set':
      return lgGoalSet(data.long, args);
    case 'lg_goals_done':
      return lgGoalsDone(data.long, rule.count, args);
    case 'lg_perfect_months':
      return lgPerfectMonths(data.long, rule.count, args);
    case 'lg_perfect_year':
      return lgPerfectYear(data.long, args);
    case 'lg_wrapped':
      return lgWrapped(data.long, rule.count, args);
    case 'lg_anniversary':
      return lgAnniversary(data.long, args);
    case 'lg_collector':
      return lgCollector(data.collector, rule.count, args);
    case 'lg_collector_all':
      return lgCollectorAll(data.collector, args);
    case 'the_arc':
      return theArc(data.long, args);
  }
}

/** Every trophy that exists today, in catalog order (yearly ones oldest year first). */
export function instances(data: TrophyData): Instance[] {
  const out: Instance[] = [];
  for (const def of TROPHIES) {
    // Roth banners follow the years with Roth data; anniversary banners follow the setup day (Round 4).
    const years = def.rule.kind === 'lg_anniversary' ? data.anniversaryYears() : def.yearly ? data.trophyYears() : [];
    if (def.yearly) for (const y of years) out.push({ key: trophyKey(def, y), def, year: y });
    else out.push({ key: def.id, def, year: null });
  }
  return out;
}

interface Effective {
  state: TrophyState;
  mode: TrophyMode | null;
  since: IsoDate | null;
  /** A yearly trophy that is On because last year's was (no row saved yet). */
  inherited: boolean;
  row: StateRow | null;
}

function effectiveStates(insts: readonly Instance[], rows: Map<string, StateRow>): Map<string, Effective> {
  const out = new Map<string, Effective>();
  for (const i of insts) {
    const row = rows.get(i.key) ?? null;
    if (row) {
      out.set(i.key, { state: row.state, mode: row.mode, since: row.since, inherited: false, row });
      continue;
    }
    const prev = i.year !== null ? out.get(trophyKey(i.def, i.year - 1)) : undefined;
    if (prev && (prev.state === 'on' || prev.state === 'earned'))
      out.set(i.key, { state: 'on', mode: prev.mode, since: prev.since, inherited: true, row: null });
    else out.set(i.key, { state: 'off', mode: null, since: null, inherited: false, row: null });
  }
  return out;
}

function argsFor(e: Pick<Effective, 'mode' | 'since'>, mode: TrophyMode | null, today: IsoDate, year: number | null): RuleArgs {
  const m = mode ?? e.mode ?? 'history';
  return { today, from: m === 'today' ? (e.since ?? today) : null, year };
}

export interface TrophyView {
  key: string;
  id: string;
  year: number | null;
  group: TrophyGroup;
  name: string;
  subtitle: string;
  rank: RankId;
  stars: number;
  rankLabel: string;
  shape: Shape;
  kindLabel: string;
  design: string;
  designStep: number;
  engraving: string;
  defaultMode: TrophyMode;
  state: TrophyState;
  mode: TrophyMode | null;
  since: IsoDate | null;
  earnedOn: IsoDate | null;
  /** "Counted your history" / "From the day you turned it on, Nov 1, 2025". */
  howCounted: string | null;
  sentence: string | null;
  /** On trophies only. */
  progress: Progress | null;
  blocked: string | null;
  /** Record plaques: newest first (older ones are shown struck through). */
  records: RecordEntry[];
  /** The newest earned trophy overall. */
  isNew: boolean;
}

function howCounted(mode: TrophyMode | null, since: IsoDate | null): string | null {
  if (!mode) return null;
  return mode === 'history' ? 'Counted your history' : `From the day you turned it on, ${longDate(since!)}`;
}

function baseView(i: Instance, e: Effective): TrophyView {
  const d = i.def;
  return {
    key: i.key,
    id: d.id,
    year: i.year,
    group: d.group,
    name: trophyName(d, i.year),
    subtitle: d.subtitle,
    rank: d.rank,
    stars: d.stars ?? 0,
    rankLabel: rankLabel(d.rank, d.stars ?? 0),
    shape: d.shape,
    kindLabel: SHAPE_LABEL[d.shape],
    design: d.design,
    designStep: d.designStep,
    engraving: i.year !== null ? `${d.engraving} · ${i.year}` : d.engraving,
    defaultMode: d.defaultMode,
    state: e.state,
    mode: e.state === 'off' ? null : e.mode,
    since: e.state === 'off' ? null : e.since,
    earnedOn: e.state === 'earned' ? (e.row?.earnedOn ?? null) : null,
    howCounted: e.state === 'off' ? null : howCounted(e.mode, e.since),
    sentence: e.state === 'earned' ? (e.row?.detail?.sentence ?? null) : null,
    progress: null,
    blocked: null,
    records: [],
    isNew: false,
  };
}

/** Shelf order: earned newest first, then On by how close, then Off in catalog order. */
function shelfOrder(views: TrophyView[], earnedAt: Map<string, number>): TrophyView[] {
  const earned = views
    .filter((v) => v.state === 'earned')
    .sort((a, b) => (b.earnedOn! < a.earnedOn! ? -1 : b.earnedOn! > a.earnedOn! ? 1 : (earnedAt.get(b.key) ?? 0) - (earnedAt.get(a.key) ?? 0)));
  const on = views.filter((v) => v.state === 'on').sort((a, b) => (b.progress?.score ?? 0) - (a.progress?.score ?? 0));
  const off = views.filter((v) => v.state === 'off');
  return [...earned, ...on, ...off];
}

export interface TrophiesResponse {
  today: IsoDate;
  counts: { earned: number; on: number; off: number; total: number };
  groups: { id: TrophyGroup; label: string; earned: number; total: number; off: number }[];
  /** Grouped by shelf (fixed group order), each shelf in its display order. */
  trophies: TrophyView[];
  closest: string[];
}

/** READ-ONLY: everything the Trophies page shows. */
export function trophyViews(db: DB, today: IsoDate, env: TrophyEnv = {}): TrophiesResponse {
  const data = new TrophyData(db, today, env);
  const insts = instances(data);
  const rows = loadStates(db);
  const eff = effectiveStates(insts, rows);
  const recs = loadRecords(db);
  const earnedAt = new Map([...rows.values()].filter((r) => r.earnedAt !== null).map((r) => [r.key, r.earnedAt!]));

  const views = insts.map((i) => {
    const e = eff.get(i.key)!;
    const v = baseView(i, e);
    if (e.state === 'on') {
      const o = runRule(data, i.def.rule, argsFor(e, null, today, i.year));
      v.progress = shownProgress(o.progress, false);
      v.blocked = o.blocked;
    }
    if (e.state === 'earned') v.records = [...(recs.get(i.key) ?? [])].reverse();
    return v;
  });

  // NEW tag: the most recently awarded trophy (ties: the later earned date).
  const newest = views
    .filter((v) => v.state === 'earned')
    .sort((a, b) => (earnedAt.get(b.key) ?? 0) - (earnedAt.get(a.key) ?? 0) || (b.earnedOn! > a.earnedOn! ? 1 : -1))[0];
  if (newest) newest.isNew = true;

  const ordered: TrophyView[] = [];
  const groups: TrophiesResponse['groups'] = [];
  for (const g of TROPHY_GROUPS) {
    const mine = views.filter((v) => v.group === g.id);
    if (!mine.length) continue;
    ordered.push(...shelfOrder(mine, earnedAt));
    groups.push({
      id: g.id,
      label: g.label,
      earned: mine.filter((v) => v.state === 'earned').length,
      off: mine.filter((v) => v.state === 'off').length,
      total: mine.length,
    });
  }
  // Round 4: The Arc is not on a shelf; it goes after every shelf (the page shows it in its reserved spot).
  ordered.push(...views.filter((v) => v.group === ARC_GROUP.id));
  const closest = views
    .filter((v) => v.state === 'on' && v.progress && !v.blocked)
    .sort((a, b) => b.progress!.score - a.progress!.score)
    .slice(0, 3)
    .map((v) => v.key);
  return {
    today,
    counts: {
      earned: views.filter((v) => v.state === 'earned').length,
      on: views.filter((v) => v.state === 'on').length,
      off: views.filter((v) => v.state === 'off').length,
      total: views.length,
    },
    groups,
    trophies: ordered,
    closest,
  };
}

export interface TrophyDetail extends TrophyView {
  /** "How you got there": the award's story when earned, else the current picture. */
  story: Story | null;
  /** The next rung of the same ladder. */
  next: { key: string; name: string; rankLabel: string; fraction: number; text: string } | null;
  /** Progress shown for an Off trophy's close-up too (what it would be with its suggested mode). */
  preview: Progress | null;
}

/** READ-ONLY: one trophy for the close-up view. null = no such trophy. */
export function trophyDetail(db: DB, today: IsoDate, key: string, env: TrophyEnv = {}): TrophyDetail | null {
  const parsed = parseTrophyKey(key);
  if (!parsed) return null;
  const data = new TrophyData(db, today, env);
  const insts = instances(data);
  const inst = insts.find((i) => i.key === key);
  if (!inst) return null;
  const eff = effectiveStates(insts, loadStates(db));
  const e = eff.get(key)!;
  const view = baseView(inst, e);
  const outcome = e.state === 'earned' ? null : runRule(data, inst.def.rule, argsFor(e, e.state === 'off' ? inst.def.defaultMode : null, today, inst.year));
  if (e.state === 'on') {
    view.progress = shownProgress(outcome!.progress, false);
    view.blocked = outcome!.blocked;
  }
  if (e.state === 'earned') view.records = [...(loadRecords(db).get(key) ?? [])].reverse();

  let next: TrophyDetail['next'] = null;
  if (inst.def.ladder) {
    const ladder = TROPHIES.filter((t) => t.ladder === inst.def.ladder);
    const n = ladder[ladder.indexOf(inst.def) + 1];
    if (n) {
      const ne = eff.get(trophyKey(n, inst.year));
      const o = runRule(data, n.rule, argsFor(ne ?? { mode: null, since: null }, ne?.state === 'on' ? null : n.defaultMode, today, inst.year));
      next = {
        key: trophyKey(n, inst.year),
        name: trophyName(n, inst.year),
        rankLabel: rankLabel(n.rank, n.stars ?? 0).replace(/ · Rank \d+/, ''),
        fraction: ne?.state === 'earned' ? 1 : shownProgress(o.progress, false).fraction,
        text: ne?.state === 'earned' ? 'Earned' : o.progress.text,
      };
    }
  }
  return {
    ...view,
    story: e.state === 'earned' ? (e.row?.detail?.story ?? null) : (outcome?.story ?? null),
    next,
    preview: e.state === 'off' && outcome ? shownProgress(outcome.progress, false) : null,
  };
}

export interface Earned {
  key: string;
  name: string;
  rankLabel: string;
  earnedOn: IsoDate;
}

/**
 * Checks every On trophy and saves new awards (and new records on earned plaques). `only` limits it to some keys.
 * Returns the newly earned trophies (Round 2's unlock pop-up uses this list).
 */
export function evaluateTrophies(db: DB, today: IsoDate, now: number, only?: ReadonlySet<string>, env: TrophyEnv = {}): Earned[] {
  return transaction(db, () => {
    const data = new TrophyData(db, today, env);
    const insts = instances(data);
    const rows = loadStates(db);
    const eff = effectiveStates(insts, rows);
    const recs = loadRecords(db);
    saveGoalMarks(db, data); // Round 4: a done goal is remembered even if it is deleted later
    const earned: Earned[] = [];
    for (const i of insts) {
      if (only && !only.has(i.key)) continue;
      const e = eff.get(i.key)!;
      if (e.state === 'off') continue;
      if (e.inherited) turnOn(db, i.key, e.mode!, e.since!, now, true);
      if (e.state === 'earned') {
        // Record plaques only ever ADD records that beat the newest one already kept.
        if (i.def.shape !== 'plaque') continue;
        const kept = recs.get(i.key) ?? [];
        const lastKept = kept[kept.length - 1];
        const o = runRule(data, i.def.rule, argsFor(e, null, today, i.year));
        const fresh = (o.records ?? []).filter((r) => !lastKept || (r.period > lastKept.period && r.amountCents > lastKept.amountCents));
        if (fresh.length) addRecords(db, i.key, e.row!.award, fresh, now);
        continue;
      }
      const o = runRule(data, i.def.rule, argsFor(e, null, today, i.year));
      if (!o.earned || o.blocked) continue;
      saveAward(db, i.key, o.earned, o.records, now);
      earned.push({ key: i.key, name: trophyName(i.def, i.year), rankLabel: rankLabel(i.def.rank, i.def.stars ?? 0), earnedOn: o.earned.date });
    }
    return earned;
  });
}

/**
 * Saves each goal's set day and first done day (trophy_goal_marks) so deleting a goal never lowers the goals done count.
 * Writes only what changed; a saved done day is never moved or cleared.
 */
export function saveGoalMarks(db: DB, data: TrophyData): void {
  const saved = new Map(
    (db.prepare('SELECT goal_id, created_at, done_on FROM trophy_goal_marks').all() as { goal_id: number; created_at: number; done_on: string | null }[]).map((r) => [
      `${r.goal_id}|${r.created_at}`,
      r,
    ]),
  );
  for (const g of data.goalMarks()) {
    if (!g.live) continue;
    const cur = saved.get(`${g.id}|${g.createdAt}`);
    if (!cur) db.prepare('INSERT INTO trophy_goal_marks (goal_id, created_at, set_on, done_on) VALUES (?, ?, ?, ?)').run(g.id, g.createdAt, g.setOn, g.doneOn);
    else if (cur.done_on === null && g.doneOn !== null)
      db.prepare('UPDATE trophy_goal_marks SET done_on = ? WHERE goal_id = ? AND created_at = ?').run(g.doneOn, g.id, g.createdAt);
  }
}

export class TrophyError extends Error {}

function instanceOrThrow(db: DB, today: IsoDate, key: string): Instance {
  const insts = instances(new TrophyData(db, today));
  const inst = insts.find((i) => i.key === key);
  if (!inst) throw new TrophyError('That trophy does not exist.');
  return inst;
}

/** Off -> On with a mode, then checks it right away. */
export function turnOnTrophy(db: DB, key: string, mode: TrophyMode, today: IsoDate, now: number, env: TrophyEnv = {}): Earned[] {
  instanceOrThrow(db, today, key);
  return transaction(db, () => {
    if (!turnOn(db, key, mode, today, now)) throw new TrophyError('That trophy is already on.');
    return evaluateTrophies(db, today, now, new Set([key]), env);
  });
}

export function turnOffTrophy(db: DB, key: string, today: IsoDate, now: number): void {
  const inst = instanceOrThrow(db, today, key);
  transaction(db, () => {
    // An inherited yearly trophy has no row yet: save it as Off so it stays off.
    if (inst.year !== null && !loadStates(db).has(key)) {
      const eff = effectiveStates(instances(new TrophyData(db, today)), loadStates(db)).get(key)!;
      if (eff.state !== 'on') throw new TrophyError('That trophy is not on.');
      turnOn(db, key, eff.mode!, eff.since!, now, true);
    }
    if (!turnOff(db, key, now)) throw new TrophyError('That trophy is not on.');
  });
}

export function takeBackTrophy(db: DB, key: string, today: IsoDate, now: number): void {
  instanceOrThrow(db, today, key);
  if (!transaction(db, () => takeBack(db, key, now))) throw new TrophyError('That trophy is not earned.');
}

/** Turns on every Off trophy in a group, each with its own suggested mode. */
export function turnOnGroup(db: DB, group: TrophyGroup, today: IsoDate, now: number, env: TrophyEnv = {}): { turnedOn: number; earned: Earned[] } {
  return transaction(db, () => {
    const data = new TrophyData(db, today);
    const insts = instances(data).filter((i) => i.def.group === group);
    const eff = effectiveStates(insts, loadStates(db));
    const keys = new Set<string>();
    for (const i of insts) {
      if (eff.get(i.key)!.state !== 'off') continue;
      turnOn(db, i.key, i.def.defaultMode, today, now);
      keys.add(i.key);
    }
    return { turnedOn: keys.size, earned: keys.size ? evaluateTrophies(db, today, now, keys, env) : [] };
  });
}

// ------------------------------------------------------------------ Round 2: the unlock pop-up

/** A trophy as the unlock pop-up shows it: its view (sentence, records...) + the award number and its shelf label. */
export interface UnlockItem extends TrophyView {
  award: number;
  groupLabel: string;
}

/** Round 4: Collector comes after every other trophy and The Arc is always last (an exception to lowest rank first). */
function finaleTier(v: Pick<TrophyView, 'id' | 'group'>): number {
  if (v.group === ARC_GROUP.id) return 2;
  const def = TROPHIES.find((t) => t.id === v.id);
  return def && isCollector(def) ? 1 : 0;
}

/**
 * Pop-up order: lowest rank first and the biggest last, so a batch builds up; same rank: oldest earned date first.
 * Collector trophies follow everything else, and The Arc is always the very last.
 */
export function unlockOrder(a: UnlockItem, b: UnlockItem): number {
  const fa = finaleTier(a);
  const fb = finaleTier(b);
  if (fa !== fb) return fa - fb;
  const la = rankInfo(a.rank).level * 10 + a.stars;
  const lb = rankInfo(b.rank).level * 10 + b.stars;
  if (la !== lb) return la - lb;
  if (a.earnedOn !== b.earnedOn) return (a.earnedOn ?? '') < (b.earnedOn ?? '') ? -1 : 1;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function asUnlock(v: TrophyView, award: number): UnlockItem {
  return { ...v, award, groupLabel: v.group === ARC_GROUP.id ? ARC_GROUP.label : (TROPHY_GROUPS.find((g) => g.id === v.group)?.label ?? '') };
}

/** READ-ONLY: every award still waiting for its pop-up, in pop-up order. */
export function unseenTrophies(db: DB, today: IsoDate, env: TrophyEnv = {}): UnlockItem[] {
  const pending = pendingCelebrations(db);
  if (!pending.size) return [];
  return trophyViews(db, today, env)
    .trophies.filter((v) => v.state === 'earned' && pending.has(v.key))
    .map((v) => asUnlock(v, pending.get(v.key)!))
    .sort(unlockOrder);
}

/** Marks awards as celebrated (see claimCelebrations); returns the keys this call claimed. */
export function celebrate(db: DB, items: readonly { key: string; award: number }[]): string[] {
  return transaction(db, () => claimCelebrations(db, items));
}

/**
 * DEMO ONLY, READ-ONLY ("Play an unlock"): three earned demo trophies of rising rank (a Silver, a Gold and an Arc40 star
 * level when the demo has them), then The Arc as the finale (a preview of it earned; Round 4), in pop-up order. Nothing is
 * awarded and nothing is marked as celebrated.
 */
export function demoUnlockTrophies(db: DB, today: IsoDate): UnlockItem[] {
  const earned = trophyViews(db, today).trophies.filter((v) => v.state === 'earned');
  const picks: TrophyView[] = [];
  const take = (ok: (v: TrophyView) => boolean) => {
    const v = earned.find((x) => ok(x) && !picks.includes(x));
    if (v) picks.push(v);
  };
  take((v) => v.rank === 'silver');
  take((v) => v.rank === 'gold');
  take((v) => v.rank === 'arc40' && v.stars > 0);
  take((v) => v.rank === 'arc40');
  for (const v of [...earned].sort((a, b) => rankInfo(b.rank).level - rankInfo(a.rank).level)) {
    if (picks.length >= 3) break;
    if (!picks.some((p) => p.rank === v.rank)) picks.push(v);
  }
  const queue = picks.slice(0, 3).map((v) => asUnlock(v, 0));
  // Round 4: the queue ends on The Arc, shown as it will look when it arrives (a preview; it is not awarded).
  const arc = trophyViews(db, today).trophies.find((v) => v.group === ARC_GROUP.id);
  if (arc) {
    const data = new TrophyData(db, today);
    const birth = data.long.birth;
    queue.push(
      asUnlock(
        {
          ...arc,
          state: 'earned',
          earnedOn: birth ? arcDay(birth) : today,
          progress: null,
          blocked: null,
          sentence: 'A preview of the finale: The Arc arrives the month you turn 40.',
        },
        0,
      ),
    );
  }
  return queue.sort(unlockOrder);
}

// ------------------------------------------------------------------ Round 2: the Dashboard shelf

export interface ShelfResponse {
  counts: { earned: number; on: number };
  /** The 5 most recently AWARDED trophies (newest award first, so the NEW one leads), each with its earned date. */
  recent: TrophyView[];
  /** The single On trophy closest to being earned (null when none can show progress). */
  closest: TrophyView | null;
}

/** READ-ONLY: what the Dashboard's Trophies card shows. */
export function trophyShelf(db: DB, today: IsoDate, env: TrophyEnv = {}): ShelfResponse {
  const all = trophyViews(db, today, env);
  const earnedAt = new Map([...loadStates(db).values()].map((r) => [r.key, r.earnedAt ?? 0]));
  const recent = all.trophies
    .filter((v) => v.state === 'earned')
    .sort(
      (a, b) =>
        (earnedAt.get(b.key) ?? 0) - (earnedAt.get(a.key) ?? 0) ||
        (b.earnedOn! > a.earnedOn! ? 1 : b.earnedOn! < a.earnedOn! ? -1 : 0) ||
        (a.key < b.key ? -1 : 1),
    )
    .slice(0, 5);
  const closestKey = all.closest[0];
  return {
    counts: { earned: all.counts.earned, on: all.counts.on },
    recent,
    closest: closestKey ? (all.trophies.find((v) => v.key === closestKey) ?? null) : null,
  };
}
