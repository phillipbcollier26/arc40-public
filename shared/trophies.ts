/**
 * Trophy Case (Trophies Rounds 1 to 4): THE catalog. Used by the server (rules) and the web (drawings, labels).
 *
 * A trophy definition is data only. Rounds 2 to 4 add definitions (and rule kinds / design families);
 * nothing here needs rewriting. Every trophy is Off until the user turns it on (no row in trophy_states).
 *
 * Keys: a plain trophy has key = id ('nw.50k'). A yearly trophy has one trophy per year:
 * key = '<id>:<year>' ('roth.maxed:2026').
 */

export type TrophyGroup = 'net_worth' | 'investing' | 'roth' | 'emergency' | 'refereeing' | 'spending' | 'tidy' | 'long_game' | 'the_arc';

/**
 * Round 4: The Arc is not on a shelf. It lives in the reserved spot at the top of the Trophy Case, so its group is not in
 * TROPHY_GROUPS (shelves); this is its label wherever a group name is shown (the pop-up, the close-up).
 */
export const ARC_GROUP = { id: 'the_arc' as const, label: 'The Arc' };

/** Shelves, in their fixed order. Shelves without trophies are not shown. */
export const TROPHY_GROUPS: readonly { id: TrophyGroup; label: string }[] = [
  { id: 'net_worth', label: 'Net worth' },
  { id: 'investing', label: 'Investing' },
  { id: 'roth', label: 'Roth' },
  { id: 'emergency', label: 'Emergency fund and savings' },
  { id: 'refereeing', label: 'Refereeing' },
  { id: 'spending', label: 'Spending habits' },
  { id: 'tidy', label: 'Keeping things tidy' },
  { id: 'long_game', label: 'The long game' },
];

export type RankId =
  | 'iron'
  | 'copper'
  | 'bronze'
  | 'silver'
  | 'gold'
  | 'rose_gold'
  | 'platinum'
  | 'obsidian'
  | 'emerald'
  | 'ruby'
  | 'diamond'
  | 'arc40';

/** solid = one metal; inlaid = platinum body with the material set in; arc = gold inside the Arc40 ring. */
export type Material = 'solid' | 'inlaid' | 'arc';

/** Difficulty ranks, same meaning everywhere. Ladders skip ranks they do not need. */
export const RANKS: readonly { id: RankId; level: number; label: string; material: Material }[] = [
  { id: 'iron', level: 1, label: 'Iron', material: 'solid' },
  { id: 'copper', level: 2, label: 'Copper', material: 'solid' },
  { id: 'bronze', level: 3, label: 'Bronze', material: 'solid' },
  { id: 'silver', level: 4, label: 'Silver', material: 'solid' },
  { id: 'gold', level: 5, label: 'Gold', material: 'solid' },
  { id: 'rose_gold', level: 6, label: 'Rose gold', material: 'solid' },
  { id: 'platinum', level: 7, label: 'Platinum', material: 'solid' },
  { id: 'obsidian', level: 8, label: 'Obsidian', material: 'inlaid' },
  { id: 'emerald', level: 9, label: 'Emerald', material: 'inlaid' },
  { id: 'ruby', level: 10, label: 'Ruby', material: 'inlaid' },
  { id: 'diamond', level: 11, label: 'Diamond', material: 'inlaid' },
  { id: 'arc40', level: 12, label: 'Arc40', material: 'arc' },
];

export function rankInfo(id: RankId) {
  return RANKS.find((r) => r.id === id)!;
}

/** "Gold · Rank 5", "Arc40 · Rank 12 · 2 stars". */
export function rankLabel(id: RankId, stars = 0): string {
  const r = rankInfo(id);
  return `${r.label} · Rank ${r.level}${stars ? ` · ${stars} star${stars > 1 ? 's' : ''}` : ''}`;
}

export type Shape = 'coin' | 'cup' | 'plaque' | 'banner' | 'statuette' | 'arc';
export const SHAPE_LABEL: Record<Shape, string> = {
  coin: 'Milestone',
  cup: 'Streak',
  plaque: 'Record',
  banner: 'Yearly',
  statuette: 'One of a kind',
  arc: 'The one and only',
};

/** Count my history (look back through all data) or Start from today (only data from the day it is turned on). */
export type TrophyMode = 'history' | 'today';
export type TrophyState = 'off' | 'on' | 'earned';

/**
 * The rule a trophy follows. Each kind has one evaluator on the server (runRule in server/src/lib/trophies/engine.ts).
 * Amounts are integer cents.
 */
export type TrophyRule =
  | { kind: 'nw_hold'; lineCents: number }
  | { kind: 'nw_year_gain'; lineCents: number }
  | { kind: 'nw_high' }
  | { kind: 'nw_best_year' }
  | { kind: 'nw_comeback' }
  | { kind: 'roth_maxed' }
  | { kind: 'roth_on_pace' }
  | { kind: 'roth_by_june' }
  | { kind: 'roth_years_maxed'; count: number; inARow: boolean }
  | { kind: 'roth_total'; lineCents: number }
  | { kind: 'roth_worth_hold'; lineCents: number }
  | { kind: 'roth_first' }
  // Round 2: Investing
  | { kind: 'inv_worth_hold'; lineCents: number }
  | { kind: 'inv_growth_hold'; lineCents: number }
  | { kind: 'inv_month_streak'; months: number }
  | { kind: 'inv_first_share' }
  | { kind: 'inv_pass_cash' }
  | { kind: 'inv_growth_beats_put_in' }
  | { kind: 'inv_growth_beats_spending' }
  | { kind: 'inv_down_month' }
  | { kind: 'inv_funds'; count: number }
  | { kind: 'inv_best_day' }
  // Round 2: Refereeing
  | { kind: 'ref_lifetime'; lineCents: number }
  | { kind: 'ref_month'; lineCents: number }
  | { kind: 'ref_month_streak'; months: number }
  | { kind: 'ref_record_month' }
  | { kind: 'ref_record_year' }
  | { kind: 'ref_up_year' }
  | { kind: 'ref_gear_10x' }
  | { kind: 'ref_covers_spending' }
  // Round 3: Emergency fund and savings
  | { kind: 'em_months_hold'; months: number }
  | { kind: 'em_funded_streak'; months: number }
  | { kind: 'em_savings_hold'; lineCents: number }
  | { kind: 'em_interest'; lineCents: number }
  | { kind: 'em_refill' }
  // Round 3: Spending habits
  | { kind: 'sp_earn_streak'; months: number }
  | { kind: 'sp_rate_month'; bp: number }
  | { kind: 'sp_rate_year'; bp: number }
  | { kind: 'sp_budget_streak'; months: number }
  | { kind: 'sp_subs_cut'; count: number }
  | { kind: 'sp_cheaper_month' }
  | { kind: 'sp_subs_cheaper' }
  | { kind: 'sp_category_tamed' }
  // Round 4: Keeping things tidy
  | { kind: 'td_clean_streak'; months: number }
  | { kind: 'td_import_streak'; months: number }
  | { kind: 'td_tracked'; count: number }
  | { kind: 'td_rules_made'; count: number }
  | { kind: 'td_rule_sorted'; count: number }
  | { kind: 'td_backup_streak'; months: number }
  | { kind: 'td_first_split' }
  | { kind: 'td_transfers_linked' }
  | { kind: 'td_first_backup' }
  | { kind: 'td_fidelity_clean' }
  // Round 4: The long game
  | { kind: 'lg_years'; years: number }
  | { kind: 'lg_goal_set' }
  | { kind: 'lg_goals_done'; count: number }
  | { kind: 'lg_perfect_months'; count: number }
  | { kind: 'lg_perfect_year' }
  | { kind: 'lg_wrapped'; count: number }
  | { kind: 'lg_anniversary' }
  | { kind: 'lg_collector'; count: number }
  | { kind: 'lg_collector_all' }
  // Round 4: The Arc
  | { kind: 'the_arc' };

export interface TrophyDef {
  id: string;
  group: TrophyGroup;
  /** Name; a yearly trophy's {year} is filled in ("Maxed the Roth 2026"). */
  name: string;
  /** Short line under the name ("$50,000", "2 years in a row"). */
  subtitle: string;
  rank: RankId;
  /** Arc40 star level 0..3 (only for rank arc40). */
  stars?: number;
  shape: Shape;
  /** Design family drawn on the trophy ('nw-coins', 'roth-vault', ...) and its step in that family (1 = simplest). */
  design: string;
  designStep: number;
  /** Text engraved on the rim / plate ("$50,000 · NET WORTH"). */
  engraving: string;
  /** Suggested answer when turning it on. Balances, lifetime totals, counts and yearly: history. Spending: today. */
  defaultMode: TrophyMode;
  /** One trophy per tax year. */
  yearly?: boolean;
  /** Trophies in the same ladder, in order (for "Next: ..."). */
  ladder?: string;
  rule: TrophyRule;
}

const K = 100_000; // $1,000 in cents
const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US')}`;
const short = (cents: number) => {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${d / 1_000_000}M`;
  return `$${d / 1000}k`;
};

// ---------------------------------------------------------------- Net worth (23)

const NW_LADDER: [number, RankId, number?][] = [
  [1 * K, 'iron'],
  [5 * K, 'copper'],
  [10 * K, 'bronze'],
  [25 * K, 'silver'],
  [50 * K, 'gold'],
  [100 * K, 'rose_gold'],
  [250 * K, 'platinum'],
  [500 * K, 'obsidian'],
  [750 * K, 'emerald'],
  [1000 * K, 'diamond'],
  [2000 * K, 'arc40'],
  [3000 * K, 'arc40', 1],
  [5000 * K, 'arc40', 2],
  [10000 * K, 'arc40', 3],
];

const NW_YEAR: [number, RankId][] = [
  [5 * K, 'bronze'],
  [10 * K, 'silver'],
  [25 * K, 'gold'],
  [50 * K, 'platinum'],
  [100 * K, 'emerald'],
  [250 * K, 'diamond'],
];

const netWorth: TrophyDef[] = [
  ...NW_LADDER.map(([line, rank, stars], i): TrophyDef => ({
    id: `nw.${short(line).slice(1).toLowerCase()}`,
    group: 'net_worth',
    name: `Net worth ${short(line)}`,
    subtitle: `${usd(line)}, held 30 days`,
    rank,
    stars,
    shape: 'coin',
    design: 'nw-coins',
    designStep: Math.min(i + 1, 11),
    engraving: `${usd(line)} · NET WORTH`,
    defaultMode: 'history',
    ladder: 'nw',
    rule: { kind: 'nw_hold', lineCents: line },
  })),
  ...NW_YEAR.map(([line, rank], i): TrophyDef => ({
    id: `nw.year.${short(line).slice(1).toLowerCase()}`,
    group: 'net_worth',
    name: `Up ${short(line)} in a year`,
    subtitle: `${usd(line)} more than Jan 1, held 30 days`,
    rank,
    shape: 'coin',
    design: 'nw-arrows',
    designStep: i + 1,
    engraving: `+${usd(line)} · IN ONE YEAR`,
    defaultMode: 'history',
    ladder: 'nw-year',
    rule: { kind: 'nw_year_gain', lineCents: line },
  })),
  {
    id: 'nw.high',
    group: 'net_worth',
    name: 'New all-time high',
    subtitle: 'A month end above every earlier one',
    rank: 'silver',
    shape: 'plaque',
    design: 'nw-peak',
    designStep: 1,
    engraving: 'ALL-TIME HIGH',
    defaultMode: 'history',
    rule: { kind: 'nw_high' },
  },
  {
    id: 'nw.best-year',
    group: 'net_worth',
    name: 'Biggest year ever',
    subtitle: 'A full year that grew more than any before',
    rank: 'rose_gold',
    shape: 'plaque',
    design: 'nw-crown-calendar',
    designStep: 1,
    engraving: 'BIGGEST YEAR',
    defaultMode: 'history',
    rule: { kind: 'nw_best_year' },
  },
  {
    id: 'nw.comeback',
    group: 'net_worth',
    name: 'Comeback',
    subtitle: 'Fell 10%, then passed the old high',
    rank: 'gold',
    shape: 'statuette',
    design: 'nw-comeback',
    designStep: 1,
    engraving: 'COMEBACK',
    defaultMode: 'history',
    rule: { kind: 'nw_comeback' },
  },
];

// ---------------------------------------------------------------- Roth (20)

const ROTH_TOTAL: [number, RankId][] = [
  [10 * K, 'silver'],
  [25 * K, 'gold'],
  [50 * K, 'platinum'],
  [100 * K, 'emerald'],
  [150 * K, 'diamond'],
];
const ROTH_WORTH: [number, RankId][] = [
  [10 * K, 'bronze'],
  [50 * K, 'gold'],
  [100 * K, 'platinum'],
  [250 * K, 'emerald'],
  [500 * K, 'diamond'],
  [1000 * K, 'arc40'],
];
const ROTH_YEARS: [number, RankId][] = [
  [5, 'obsidian'],
  [10, 'emerald'],
  [15, 'diamond'],
  [20, 'arc40'],
];

const roth: TrophyDef[] = [
  {
    id: 'roth.maxed',
    group: 'roth',
    name: 'Maxed the Roth {year}',
    subtitle: 'The full limit by the deadline',
    rank: 'gold',
    shape: 'banner',
    design: 'roth-shield',
    designStep: 1,
    engraving: 'MAXED',
    defaultMode: 'history',
    yearly: true,
    rule: { kind: 'roth_maxed' },
  },
  {
    id: 'roth.on-pace',
    group: 'roth',
    name: 'On pace all year {year}',
    subtitle: 'Never behind at a month end, then maxed',
    rank: 'silver',
    shape: 'banner',
    design: 'roth-shield',
    designStep: 2,
    engraving: 'ON PACE',
    defaultMode: 'history',
    yearly: true,
    rule: { kind: 'roth_on_pace' },
  },
  {
    id: 'roth.june',
    group: 'roth',
    name: 'Maxed by June 30, {year}',
    subtitle: 'The full limit by June 30',
    rank: 'platinum',
    shape: 'banner',
    design: 'roth-shield',
    designStep: 3,
    engraving: 'BY JUNE 30',
    defaultMode: 'history',
    yearly: true,
    rule: { kind: 'roth_by_june' },
  },
  {
    id: 'roth.streak.2',
    group: 'roth',
    name: '2 years maxed in a row',
    subtitle: '2 tax years in a row',
    rank: 'rose_gold',
    shape: 'cup',
    design: 'roth-shields',
    designStep: 2,
    engraving: '2 YEARS IN A ROW',
    defaultMode: 'history',
    rule: { kind: 'roth_years_maxed', count: 2, inARow: true },
  },
  ...ROTH_YEARS.map(([n, rank], i): TrophyDef => ({
    id: `roth.years.${n}`,
    group: 'roth',
    name: `${n} years maxed`,
    subtitle: `${n} tax years at the full limit`,
    rank,
    shape: 'coin',
    design: 'roth-shields',
    designStep: i + 3,
    engraving: `${n} YEARS · ROTH MAXED`,
    defaultMode: 'history',
    ladder: 'roth-years',
    rule: { kind: 'roth_years_maxed', count: n, inARow: false },
  })),
  ...ROTH_TOTAL.map(([line, rank], i): TrophyDef => ({
    id: `roth.total.${short(line).slice(1).toLowerCase()}`,
    group: 'roth',
    name: `${short(line)} put into the Roth`,
    subtitle: `${usd(line)} in contributions`,
    rank,
    shape: 'coin',
    design: 'roth-vault',
    designStep: i + 1,
    engraving: `${usd(line)} · CONTRIBUTED`,
    defaultMode: 'history',
    ladder: 'roth-total',
    rule: { kind: 'roth_total', lineCents: line },
  })),
  ...ROTH_WORTH.map(([line, rank], i): TrophyDef => ({
    id: `roth.worth.${short(line).slice(1).toLowerCase()}`,
    group: 'roth',
    name: `Roth worth ${short(line)}`,
    subtitle: `${usd(line)}, held 30 days`,
    rank,
    shape: 'coin',
    design: 'roth-vault-open',
    designStep: i + 1,
    engraving: `${usd(line)} · ROTH IRA`,
    defaultMode: 'history',
    ladder: 'roth-worth',
    rule: { kind: 'roth_worth_hold', lineCents: line },
  })),
  {
    id: 'roth.first',
    group: 'roth',
    name: 'First Roth contribution',
    subtitle: 'Your first money into a Roth IRA',
    rank: 'bronze',
    shape: 'statuette',
    design: 'roth-seed',
    designStep: 1,
    engraving: 'FIRST CONTRIBUTION',
    defaultMode: 'history',
    rule: { kind: 'roth_first' },
  },
];

// ---------------------------------------------------------------- Investing (28, Round 2)

const INV_WORTH: [number, RankId, number?][] = [
  [10 * K, 'bronze'],
  [25 * K, 'silver'],
  [50 * K, 'gold'],
  [100 * K, 'platinum'],
  [250 * K, 'obsidian'],
  [500 * K, 'emerald'],
  [1000 * K, 'diamond'],
  [2000 * K, 'arc40'],
  [5000 * K, 'arc40', 1],
];
const INV_GROWTH: [number, RankId][] = [
  [1 * K, 'copper'],
  [10 * K, 'silver'],
  [50 * K, 'gold'],
  [100 * K, 'platinum'],
  [250 * K, 'emerald'],
  [500 * K, 'ruby'],
  [1000 * K, 'diamond'],
];
const INV_STREAK: [number, RankId][] = [
  [6, 'silver'],
  [12, 'gold'],
  [24, 'platinum'],
  [36, 'obsidian'],
  [60, 'diamond'],
];

const one = (
  id: string,
  name: string,
  subtitle: string,
  rank: RankId,
  design: string,
  engraving: string,
  rule: TrophyRule,
  opts: { shape?: Shape; defaultMode?: TrophyMode } = {},
): TrophyDef => ({
  id,
  group: 'investing',
  name,
  subtitle,
  rank,
  shape: opts.shape ?? 'statuette',
  design,
  designStep: 1,
  engraving,
  defaultMode: opts.defaultMode ?? 'history',
  rule,
});

const investing: TrophyDef[] = [
  ...INV_WORTH.map(([line, rank, stars], i): TrophyDef => ({
    id: `inv.worth.${short(line).slice(1).toLowerCase()}`,
    group: 'investing',
    name: `Investments worth ${short(line)}`,
    subtitle: `${usd(line)}, held 30 days`,
    rank,
    stars,
    shape: 'coin',
    design: 'inv-trees',
    designStep: Math.min(i + 1, 8),
    engraving: `${usd(line)} · INVESTED`,
    defaultMode: 'history',
    ladder: 'inv-worth',
    rule: { kind: 'inv_worth_hold', lineCents: line },
  })),
  ...INV_GROWTH.map(([line, rank], i): TrophyDef => ({
    id: `inv.growth.${short(line).slice(1).toLowerCase()}`,
    group: 'investing',
    name: `Growth ${short(line)}`,
    subtitle: `${usd(line)} of growth, held 30 days`,
    rank,
    shape: 'coin',
    design: 'inv-snowball',
    designStep: i + 1,
    engraving: `+${usd(line)} · GROWTH`,
    defaultMode: 'history',
    ladder: 'inv-growth',
    rule: { kind: 'inv_growth_hold', lineCents: line },
  })),
  ...INV_STREAK.map(([n, rank], i): TrophyDef => ({
    id: `inv.streak.${n}`,
    group: 'investing',
    name: `Invested ${n} months in a row`,
    subtitle: `Money put in every month for ${n} months`,
    rank,
    shape: 'cup',
    design: 'inv-chain',
    designStep: i + 1,
    engraving: `${n} MONTHS IN A ROW`,
    defaultMode: 'history',
    ladder: 'inv-streak',
    rule: { kind: 'inv_month_streak', months: n },
  })),
  one('inv.first-share', 'First share', 'The first day you held shares', 'iron', 'inv-seedling', 'FIRST SHARE', { kind: 'inv_first_share' }),
  one('inv.pass-cash', 'Investments pass cash', 'Worth more than all your cash, 30 days', 'gold', 'inv-scale-chart', 'PASSED CASH', { kind: 'inv_pass_cash' }),
  one('inv.growth-beats-put-in', 'Growth beats money put in', 'Growth bigger than all you put in, 30 days', 'ruby', 'inv-bars', 'GROWTH WINS', {
    kind: 'inv_growth_beats_put_in',
  }),
  one(
    'inv.growth-beats-spending',
    'Growth beat a year of spending',
    'A full year where growth topped spending',
    'ruby',
    'inv-scale-receipt',
    'GROWTH > SPENDING',
    { kind: 'inv_growth_beats_spending' },
    { defaultMode: 'today' },
  ),
  one('inv.down-month', 'Kept investing in a down month', 'Put money in while the market fell 5%', 'gold', 'inv-anchor', 'HELD STEADY', { kind: 'inv_down_month' }),
  one('inv.funds.3', 'Own 3+ funds', 'Three different funds at once', 'bronze', 'inv-circles', '3 FUNDS', { kind: 'inv_funds', count: 3 }),
  one('inv.best-day', 'Best day ever', 'Your biggest one-day market gain', 'silver', 'inv-lightning', 'BEST DAY', { kind: 'inv_best_day' }, { shape: 'plaque' }),
];

// ---------------------------------------------------------------- Refereeing (17, Round 2)

const REF_LIFETIME: [number, RankId][] = [
  [1 * K, 'bronze'],
  [5 * K, 'silver'],
  [10 * K, 'gold'],
  [25 * K, 'platinum'],
  [50 * K, 'obsidian'],
  [100 * K, 'diamond'],
];
const REF_MONTH: [number, RankId][] = [
  [1 * K, 'silver'],
  [2 * K, 'gold'],
  [3 * K, 'platinum'],
];
const REF_STREAK: [number, RankId][] = [
  [6, 'silver'],
  [12, 'gold'],
  [24, 'platinum'],
];

const ref = (def: Omit<TrophyDef, 'group' | 'designStep' | 'defaultMode'> & { designStep?: number; defaultMode?: TrophyMode }): TrophyDef => ({
  group: 'refereeing',
  designStep: 1,
  defaultMode: 'history',
  ...def,
});

const refereeing: TrophyDef[] = [
  ...REF_LIFETIME.map(([line, rank], i) =>
    ref({
      id: `ref.lifetime.${short(line).slice(1).toLowerCase()}`,
      name: `${short(line)} refereeing`,
      subtitle: `${usd(line)} of ref pay, all time`,
      rank,
      shape: 'coin',
      design: 'ref-whistle',
      designStep: i + 1,
      engraving: `${usd(line)} · REFEREEING`,
      ladder: 'ref-lifetime',
      rule: { kind: 'ref_lifetime', lineCents: line },
    }),
  ),
  ...REF_MONTH.map(([line, rank], i) =>
    ref({
      id: `ref.month.${short(line).slice(1).toLowerCase()}`,
      name: `${short(line)} ref month`,
      subtitle: `${usd(line)} of ref pay in one month`,
      rank,
      shape: 'coin',
      design: 'ref-cord',
      designStep: i + 1,
      engraving: `${usd(line)} · ONE MONTH`,
      ladder: 'ref-month',
      rule: { kind: 'ref_month', lineCents: line },
    }),
  ),
  ...REF_STREAK.map(([n, rank], i) =>
    ref({
      id: `ref.streak.${n}`,
      name: `Reffed ${n} months in a row`,
      subtitle: `Ref pay every month for ${n} months`,
      rank,
      shape: 'cup',
      design: 'ref-scorecard',
      designStep: i + 1,
      engraving: `${n} MONTHS IN A ROW`,
      ladder: 'ref-streak',
      rule: { kind: 'ref_month_streak', months: n },
    }),
  ),
  ref({ id: 'ref.record-month', name: 'Record ref month', subtitle: 'A month above every month before', rank: 'rose_gold', shape: 'plaque', design: 'ref-calendar', engraving: 'RECORD MONTH', rule: { kind: 'ref_record_month' } }),
  ref({ id: 'ref.record-year', name: 'Record ref year', subtitle: 'A full year above every year before', rank: 'obsidian', shape: 'plaque', design: 'ref-jersey-crown', engraving: 'RECORD YEAR', rule: { kind: 'ref_record_year' } }),
  ref({ id: 'ref.up-year', name: 'Ref pay up vs last year', subtitle: 'A full year above the year before', rank: 'bronze', shape: 'statuette', design: 'ref-whistle-arrow', engraving: 'UP ON LAST YEAR', rule: { kind: 'ref_up_year' } }),
  ref({ id: 'ref.gear-10x', name: 'Gear paid off 10x', subtitle: 'A year of ref pay 10 times your ref costs', rank: 'gold', shape: 'statuette', design: 'ref-cap', engraving: 'PAID OFF 10X', rule: { kind: 'ref_gear_10x' } }),
  ref({
    id: 'ref.covers-spending',
    name: 'Ref pay covered all spending',
    subtitle: 'A month where ref pay covered everything you spent',
    rank: 'emerald',
    shape: 'statuette',
    design: 'ref-roof',
    engraving: 'COVERED IT ALL',
    defaultMode: 'today',
    rule: { kind: 'ref_covers_spending' },
  }),
];

// ---------------------------------------------------------------- Emergency fund and savings (19, Round 3)

const EM_MONTHS: [number, RankId][] = [
  [1, 'bronze'],
  [3, 'silver'],
  [6, 'gold'],
  [9, 'rose_gold'],
  [12, 'platinum'],
];
const EM_FUNDED: [number, RankId][] = [
  [12, 'platinum'],
  [24, 'obsidian'],
  [36, 'emerald'],
];
const EM_SAVINGS: [number, RankId][] = [
  [5 * K, 'copper'],
  [10 * K, 'bronze'],
  [25 * K, 'silver'],
  [50 * K, 'gold'],
  [100 * K, 'platinum'],
];
const EM_INTEREST: [number, RankId][] = [
  [100 * 100, 'iron'],
  [1 * K, 'silver'],
  [5 * K, 'gold'],
  [10 * K, 'platinum'],
  [25 * K, 'emerald'],
];
/** "$100" / "$1k" / "$25k" for names and ids. */
const shortSmall = (cents: number) => (cents < K ? usd(cents) : short(cents));
const idPart = (cents: number) => shortSmall(cents).slice(1).toLowerCase();

const em = (def: Omit<TrophyDef, 'group' | 'designStep'> & { designStep?: number }): TrophyDef => ({ group: 'emergency', designStep: 1, ...def });

const emergency: TrophyDef[] = [
  ...EM_MONTHS.map(([n, rank], i) =>
    em({
      id: `em.months.${n}`,
      name: `${n} ${n === 1 ? 'month' : 'months'} covered`,
      subtitle: `Savings cover ${n} ${n === 1 ? 'month' : 'months'} of spending, 30 days`,
      rank,
      shape: 'coin',
      design: 'em-umbrella',
      designStep: i + 1,
      engraving: `${n} ${n === 1 ? 'MONTH' : 'MONTHS'} COVERED`,
      defaultMode: 'today',
      ladder: 'em-months',
      rule: { kind: 'em_months_hold', months: n },
    }),
  ),
  ...EM_FUNDED.map(([n, rank], i) =>
    em({
      id: `em.funded.${n}`,
      name: `Fully funded ${n} months`,
      subtitle: `6 months covered every day for ${n} months in a row`,
      rank,
      shape: 'cup',
      design: 'em-umbrella-ring',
      designStep: i + 1,
      engraving: `${n} MONTHS FUNDED`,
      defaultMode: 'today',
      ladder: 'em-funded',
      rule: { kind: 'em_funded_streak', months: n },
    }),
  ),
  ...EM_SAVINGS.map(([line, rank], i) =>
    em({
      id: `em.savings.${idPart(line)}`,
      name: `Savings ${short(line)}`,
      subtitle: `${usd(line)} in savings, held 30 days`,
      rank,
      shape: 'coin',
      design: 'em-jars',
      designStep: i + 1,
      engraving: `${usd(line)} · SAVINGS`,
      defaultMode: 'history',
      ladder: 'em-savings',
      rule: { kind: 'em_savings_hold', lineCents: line },
    }),
  ),
  ...EM_INTEREST.map(([line, rank], i) =>
    em({
      id: `em.interest.${idPart(line)}`,
      name: `${shortSmall(line)} of interest`,
      subtitle: `${usd(line)} of interest earned, all time`,
      rank,
      shape: 'coin',
      design: 'em-interest',
      designStep: i + 1,
      engraving: `${usd(line)} · INTEREST`,
      defaultMode: 'history',
      ladder: 'em-interest',
      rule: { kind: 'em_interest', lineCents: line },
    }),
  ),
  em({
    id: 'em.refill',
    name: 'Refilled after using it',
    subtitle: 'Used the fund, then built it back to 6 months',
    rank: 'rose_gold',
    shape: 'statuette',
    design: 'em-refill',
    engraving: 'REFILLED',
    defaultMode: 'today',
    rule: { kind: 'em_refill' },
  }),
];

// ---------------------------------------------------------------- Spending habits (25, Round 3)

const SP_EARN: [number, RankId][] = [
  [3, 'bronze'],
  [6, 'silver'],
  [12, 'gold'],
  [24, 'obsidian'],
  [36, 'emerald'],
  [60, 'diamond'],
];
const SP_RATE_MONTH: [number, RankId][] = [
  [20, 'copper'],
  [30, 'silver'],
  [50, 'gold'],
  [70, 'platinum'],
];
const SP_RATE_YEAR: [number, RankId][] = [
  [25, 'platinum'],
  [40, 'emerald'],
  [50, 'diamond'],
];
const SP_BUDGET: [number, RankId][] = [
  [1, 'silver'],
  [3, 'gold'],
  [6, 'platinum'],
  [12, 'emerald'],
  [24, 'diamond'],
];
const SP_CUT: [number, RankId][] = [
  [1, 'copper'],
  [3, 'silver'],
  [5, 'gold'],
  [10, 'platinum'],
];
const months = (n: number) => `${n} ${n === 1 ? 'month' : 'months'}`;

/** Every Spending habits trophy suggests Start from today. */
const sp = (def: Omit<TrophyDef, 'group' | 'designStep' | 'defaultMode'> & { designStep?: number }): TrophyDef => ({
  group: 'spending',
  designStep: 1,
  defaultMode: 'today',
  ...def,
});

const spending: TrophyDef[] = [
  ...SP_EARN.map(([n, rank], i) =>
    sp({
      id: `sp.earn.${n}`,
      name: `Spent less than you earned, ${months(n)}`,
      subtitle: `Income above spending ${n} months in a row`,
      rank,
      shape: 'cup',
      design: 'sp-flame',
      designStep: i + 1,
      engraving: `${n} MONTHS IN A ROW`,
      ladder: 'sp-earn',
      rule: { kind: 'sp_earn_streak', months: n },
    }),
  ),
  ...SP_RATE_MONTH.map(([p, rank], i) =>
    sp({
      id: `sp.rate-month.${p}`,
      name: `Saved ${p}% in a month`,
      subtitle: `A savings rate of ${p}% or more in one month`,
      rank,
      shape: 'coin',
      design: 'sp-jar',
      designStep: i + 1,
      engraving: `${p}% · ONE MONTH`,
      ladder: 'sp-rate-month',
      rule: { kind: 'sp_rate_month', bp: p * 100 },
    }),
  ),
  ...SP_RATE_YEAR.map(([p, rank], i) =>
    sp({
      id: `sp.rate-year.${p}`,
      name: `Saved ${p}% in a year`,
      subtitle: `A savings rate of ${p}% or more for a whole year`,
      rank,
      shape: 'coin',
      design: 'sp-jar-calendar',
      designStep: i + 1,
      engraving: `${p}% · ONE YEAR`,
      ladder: 'sp-rate-year',
      rule: { kind: 'sp_rate_year', bp: p * 100 },
    }),
  ),
  ...SP_BUDGET.map(([n, rank], i) =>
    sp({
      id: `sp.budget.${n}`,
      name: n === 1 ? 'Under budget for a month' : `Under budget ${months(n)} in a row`,
      subtitle: `Every budgeted category at or under its limit, ${months(n)}`,
      rank,
      shape: 'cup',
      design: 'sp-bullseye',
      designStep: i + 1,
      engraving: n === 1 ? 'UNDER BUDGET' : `${n} MONTHS UNDER BUDGET`,
      ladder: 'sp-budget',
      rule: { kind: 'sp_budget_streak', months: n },
    }),
  ),
  ...SP_CUT.map(([n, rank], i) =>
    sp({
      id: `sp.cut.${n}`,
      name: n === 1 ? 'Cut a subscription' : `Cut ${n} subscriptions`,
      subtitle: `${n === 1 ? 'A subscription' : `${n} subscriptions`} marked cancelled on Recurring`,
      rank,
      shape: 'coin',
      design: 'sp-scissors',
      designStep: i + 1,
      engraving: n === 1 ? '1 CUT' : `${n} CUT`,
      ladder: 'sp-cut',
      rule: { kind: 'sp_subs_cut', count: n },
    }),
  ),
  sp({
    id: 'sp.cheaper-month',
    name: 'Cheaper than last year',
    subtitle: 'A month that cost less than the same month last year',
    rank: 'bronze',
    shape: 'statuette',
    design: 'sp-calendars',
    engraving: 'CHEAPER',
    rule: { kind: 'sp_cheaper_month' },
  }),
  sp({
    id: 'sp.subs-cheaper',
    name: 'Subscriptions cost less',
    subtitle: 'Subscriptions over 12 months cost less than the 12 before',
    rank: 'bronze',
    shape: 'statuette',
    design: 'sp-receipt',
    engraving: 'SUBSCRIPTIONS DOWN',
    rule: { kind: 'sp_subs_cheaper' },
  }),
  sp({
    id: 'sp.category-tamed',
    name: 'Category tamed',
    subtitle: 'One category 25% lower over 12 months',
    rank: 'silver',
    shape: 'statuette',
    design: 'sp-lasso',
    engraving: 'TAMED',
    rule: { kind: 'sp_category_tamed' },
  }),
];

// ---------------------------------------------------------------- Keeping things tidy (23, Round 4)

const TD_CLEAN: [number, RankId][] = [
  [1, 'iron'],
  [6, 'silver'],
  [12, 'gold'],
  [24, 'platinum'],
];
const TD_IMPORT: [number, RankId][] = [
  [12, 'gold'],
  [24, 'platinum'],
  [36, 'obsidian'],
];
const TD_TRACKED: [number, RankId][] = [
  [1000, 'bronze'],
  [5000, 'silver'],
  [10000, 'gold'],
  [25000, 'platinum'],
];
const TD_RULES: [number, RankId][] = [
  [10, 'copper'],
  [25, 'silver'],
  [50, 'gold'],
];
const TD_SORTED: [number, RankId][] = [
  [100, 'silver'],
  [500, 'gold'],
  [1000, 'platinum'],
];
const TD_BACKUP: [number, RankId][] = [
  [6, 'silver'],
  [12, 'gold'],
];
const num = (n: number) => n.toLocaleString('en-US');
const kNum = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));
const yearsOf = (m: number) => `${m / 12} ${m === 12 ? 'year' : 'years'}`;

/** Every Keeping things tidy trophy suggests Count my history. */
const td = (def: Omit<TrophyDef, 'group' | 'designStep' | 'defaultMode'> & { designStep?: number }): TrophyDef => ({
  group: 'tidy',
  designStep: 1,
  defaultMode: 'history',
  ...def,
});

const tidy: TrophyDef[] = [
  ...TD_CLEAN.map(([n, rank], i) =>
    td({
      id: `td.clean.${n}`,
      name: n === 1 ? 'Clean books for a month' : `Clean books, ${months(n)} in a row`,
      subtitle: `Nothing uncategorized, ${months(n)}${n === 1 ? '' : ' in a row'}`,
      rank,
      shape: 'cup',
      design: 'td-ledger',
      designStep: i + 1,
      engraving: n === 1 ? 'CLEAN BOOKS' : `${n} MONTHS CLEAN`,
      ladder: 'td-clean',
      rule: { kind: 'td_clean_streak', months: n },
    }),
  ),
  ...TD_IMPORT.map(([n, rank], i) =>
    td({
      id: `td.import.${n}`,
      name: `Imported every month for ${yearsOf(n)}`,
      subtitle: `An import saved every month, ${n} months in a row`,
      rank,
      shape: 'cup',
      design: 'td-calendar-checks',
      designStep: i + 1,
      engraving: `${n}-MONTH IMPORTS`,
      ladder: 'td-import',
      rule: { kind: 'td_import_streak', months: n },
    }),
  ),
  ...TD_TRACKED.map(([n, rank], i) =>
    td({
      id: `td.tracked.${kNum(n)}`,
      name: `${kNum(n)} transactions tracked`,
      subtitle: `${num(n)} rows on the Transactions page`,
      rank,
      shape: 'coin',
      design: 'td-receipts',
      designStep: i + 1,
      engraving: `${num(n)} · TRACKED`,
      ladder: 'td-tracked',
      rule: { kind: 'td_tracked', count: n },
    }),
  ),
  ...TD_RULES.map(([n, rank], i) =>
    td({
      id: `td.rules.${n}`,
      name: `${n} rules made`,
      subtitle: `${n} sorting rules you made yourself`,
      rank,
      shape: 'coin',
      design: 'td-gears',
      designStep: i + 1,
      engraving: `${n} RULES`,
      ladder: 'td-rules',
      rule: { kind: 'td_rules_made', count: n },
    }),
  ),
  ...TD_SORTED.map(([n, rank], i) =>
    td({
      id: `td.sorted.${n}`,
      name: `One rule sorted ${num(n)}`,
      subtitle: `One of your rules sorted ${num(n)} transactions`,
      rank,
      shape: 'coin',
      design: 'td-sort-gear',
      designStep: i + 1,
      engraving: `${num(n)} · ONE RULE`,
      ladder: 'td-sorted',
      rule: { kind: 'td_rule_sorted', count: n },
    }),
  ),
  ...TD_BACKUP.map(([n, rank], i) =>
    td({
      id: `td.backup.${n}`,
      name: `Backed up every month, ${months(n)}`,
      subtitle: `A backup every month, ${n} months in a row`,
      rank,
      shape: 'cup',
      design: 'td-boxes',
      designStep: i + 1,
      engraving: `${n}-MONTH BACKUPS`,
      ladder: 'td-backup',
      rule: { kind: 'td_backup_streak', months: n },
    }),
  ),
  td({
    id: 'td.first-split',
    name: 'First split',
    subtitle: 'The first transaction you split',
    rank: 'iron',
    shape: 'statuette',
    design: 'td-torn-receipt',
    engraving: 'FIRST SPLIT',
    rule: { kind: 'td_first_split' },
  }),
  td({
    id: 'td.transfers-linked',
    name: 'Every transfer linked',
    subtitle: 'A month where every transfer had its other side',
    rank: 'bronze',
    shape: 'statuette',
    design: 'td-chain-link',
    engraving: 'ALL LINKED',
    rule: { kind: 'td_transfers_linked' },
  }),
  td({
    id: 'td.first-backup',
    name: 'First backup',
    subtitle: 'Your first Arc40 backup',
    rank: 'iron',
    shape: 'statuette',
    design: 'td-box',
    engraving: 'FIRST BACKUP',
    rule: { kind: 'td_first_backup' },
  }),
  td({
    id: 'td.fidelity-clean',
    name: 'Fidelity check clean',
    subtitle: 'A positions file where every share count matched',
    rank: 'bronze',
    shape: 'statuette',
    design: 'td-magnifier',
    engraving: 'SHARES MATCH',
    rule: { kind: 'td_fidelity_clean' },
  }),
];

// ---------------------------------------------------------------- The long game (23, Round 4)

const LG_YEARS: [number, RankId][] = [
  [1, 'bronze'],
  [3, 'gold'],
  [5, 'obsidian'],
  [10, 'diamond'],
  [20, 'arc40'],
];
const LG_GOALS: [number, RankId][] = [
  [1, 'silver'],
  [5, 'platinum'],
  [10, 'obsidian'],
  [25, 'emerald'],
];
const LG_PERFECT: [number, RankId][] = [
  [1, 'gold'],
  [3, 'platinum'],
  [6, 'emerald'],
  [12, 'ruby'],
];
const LG_WRAPPED: [number, RankId][] = [
  [1, 'copper'],
  [5, 'gold'],
  [10, 'platinum'],
];
const LG_COLLECTOR: [number, RankId][] = [
  [25, 'gold'],
  [50, 'platinum'],
  [100, 'diamond'],
];
const yrs = (n: number) => `${n} ${n === 1 ? 'year' : 'years'}`;

/** Count my history, except Perfect months and Perfect year (they include spending). */
const lg = (def: Omit<TrophyDef, 'group' | 'designStep' | 'defaultMode'> & { designStep?: number; defaultMode?: TrophyMode }): TrophyDef => ({
  group: 'long_game',
  designStep: 1,
  defaultMode: 'history',
  ...def,
});

const longGame: TrophyDef[] = [
  ...LG_YEARS.map(([n, rank], i) =>
    lg({
      id: `lg.years.${n}`,
      name: `${yrs(n)} of history`,
      subtitle: `${yrs(n)} since your first money in Arc40`,
      rank,
      shape: 'coin',
      design: 'lg-rings',
      designStep: i + 1,
      engraving: `${n} ${n === 1 ? 'YEAR' : 'YEARS'} · HISTORY`,
      ladder: 'lg-years',
      rule: { kind: 'lg_years', years: n },
    }),
  ),
  lg({
    id: 'lg.goal-set',
    name: 'First goal set',
    subtitle: 'You made your first goal',
    rank: 'iron',
    shape: 'coin',
    design: 'lg-flags',
    designStep: 1,
    engraving: 'FIRST GOAL',
    ladder: 'lg-goals',
    rule: { kind: 'lg_goal_set' },
  }),
  ...LG_GOALS.map(([n, rank], i) =>
    lg({
      id: `lg.goals.${n}`,
      name: n === 1 ? 'First goal done' : `${n} goals done`,
      subtitle: `${n === 1 ? 'A goal' : `${n} goals`} at or above target for 30 days`,
      rank,
      shape: 'coin',
      design: 'lg-flags',
      designStep: i + 2,
      engraving: n === 1 ? 'GOAL DONE' : `${n} GOALS DONE`,
      ladder: 'lg-goals',
      rule: { kind: 'lg_goals_done', count: n },
    }),
  ),
  ...LG_PERFECT.map(([n, rank], i) =>
    lg({
      id: `lg.perfect.${n}`,
      name: n === 1 ? 'A perfect month' : `${n} perfect months`,
      subtitle: 'Earned more than spent, under budget, clean books, invested',
      rank,
      shape: 'coin',
      design: 'lg-star',
      designStep: i + 1,
      engraving: n === 1 ? 'PERFECT MONTH' : `${n} PERFECT MONTHS`,
      defaultMode: 'today',
      ladder: 'lg-perfect',
      rule: { kind: 'lg_perfect_months', count: n },
    }),
  ),
  lg({
    id: 'lg.perfect-year',
    name: 'A perfect year',
    subtitle: '12 perfect months in a row',
    rank: 'diamond',
    shape: 'cup',
    design: 'lg-star-cup',
    engraving: 'PERFECT YEAR',
    defaultMode: 'today',
    rule: { kind: 'lg_perfect_year' },
  }),
  ...LG_WRAPPED.map(([n, rank], i) =>
    lg({
      id: `lg.wrapped.${n}`,
      name: n === 1 ? 'First Wrapped watched' : `${n} years of Wrapped`,
      subtitle: n === 1 ? 'Watched a year of Arc40 Wrapped to the end' : `Watched ${n} different years of Arc40 Wrapped to the end`,
      rank,
      shape: 'coin',
      design: 'lg-ribbon-box',
      designStep: i + 1,
      engraving: n === 1 ? 'WRAPPED' : `${n} YEARS WRAPPED`,
      ladder: 'lg-wrapped',
      rule: { kind: 'lg_wrapped', count: n },
    }),
  ),
  lg({
    id: 'lg.anniversary',
    name: 'Arc40 anniversary {year}',
    subtitle: 'Another year since you set up Arc40',
    rank: 'rose_gold',
    shape: 'banner',
    design: 'lg-anniversary',
    engraving: 'ARC40',
    yearly: true,
    rule: { kind: 'lg_anniversary' },
  }),
  ...LG_COLLECTOR.map(([n, rank], i) =>
    lg({
      id: `lg.collector.${n}`,
      name: `Collector: ${n} trophies`,
      subtitle: `${n} trophies earned`,
      rank,
      shape: 'coin',
      design: 'lg-case',
      designStep: i + 1,
      engraving: `${n} TROPHIES`,
      ladder: 'lg-collector',
      rule: { kind: 'lg_collector', count: n },
    }),
  ),
  lg({
    id: 'lg.collector.all',
    name: 'Collector: every trophy',
    subtitle: 'Every trophy in the case earned at least once',
    rank: 'arc40',
    shape: 'coin',
    design: 'lg-case',
    designStep: 4,
    engraving: 'EVERY TROPHY',
    ladder: 'lg-collector',
    rule: { kind: 'lg_collector_all' },
  }),
];

// ---------------------------------------------------------------- The Arc (1, Round 4)

/** The one-of-a-kind trophy in the reserved spot at the top of the case (not on a shelf). */
const theArc: TrophyDef = {
  id: 'the-arc',
  group: 'the_arc',
  name: 'The Arc',
  subtitle: 'Arc40 all the way to age 40',
  rank: 'arc40',
  shape: 'arc',
  design: 'the-arc',
  designStep: 1,
  engraving: 'THE ARC · AGE 40',
  defaultMode: 'history',
  rule: { kind: 'the_arc' },
};

const COLLECTOR_KINDS = new Set<TrophyRule['kind']>(['lg_collector', 'lg_collector_all']);
/** Collector trophies count the others, so they never count themselves or each other. */
export const isCollector = (def: Pick<TrophyDef, 'rule'>) => COLLECTOR_KINDS.has(def.rule.kind);

/**
 * Every trophy, in shelf order within each group. Collector comes LAST so that, in one check, it is evaluated after every
 * other trophy (earning the 25th trophy and Collector 25 can happen together); The Arc just before it, so Collector's
 * "every trophy" sees it.
 */
export const TROPHIES: readonly TrophyDef[] = [
  ...netWorth,
  ...investing,
  ...roth,
  ...emergency,
  ...refereeing,
  ...spending,
  ...tidy,
  ...longGame.filter((d) => !isCollector(d)),
  theArc,
  ...longGame.filter((d) => isCollector(d)),
];

export function trophyDef(id: string): TrophyDef | undefined {
  return TROPHIES.find((t) => t.id === id);
}

/** 'roth.maxed:2026' -> { id: 'roth.maxed', year: 2026 }; null when the key does not name a trophy. */
export function parseTrophyKey(key: string): { def: TrophyDef; year: number | null } | null {
  if (typeof key !== 'string' || key.length > 80) return null;
  const m = /^([a-z0-9.-]+)(?::(\d{4}))?$/.exec(key);
  if (!m) return null;
  const def = trophyDef(m[1]!);
  if (!def) return null;
  const year = m[2] ? Number(m[2]) : null;
  if (!!def.yearly !== (year !== null)) return null;
  return { def, year };
}

export function trophyKey(def: TrophyDef, year: number | null): string {
  return year === null ? def.id : `${def.id}:${year}`;
}

export function trophyName(def: TrophyDef, year: number | null): string {
  return def.name.replace('{year}', year === null ? '' : String(year)).trim();
}
