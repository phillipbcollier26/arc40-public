/** Shapes of the JSON the server returns. Money fields are integer cents. */
import type { AccountGroup, AccountType } from '../../../shared/accounts';
import type { TxType } from '../../../shared/transactions';

export interface AccountSummary {
  id: number;
  name: string;
  institution: string;
  type: AccountType;
  typeLabel: string;
  group: AccountGroup;
  class: 'asset' | 'liability';
  isInvestment: boolean;
  archived: boolean;
  notes: string;
  balanceCents: number | null;
  balanceAsOf: string | null;
  change30dCents: number | null;
  trend: { date: string; cents: number | null }[];
}

export interface Snapshot {
  id: number;
  accountId: number;
  asOf: string;
  balanceCents: number;
  source: string;
  note: string;
}

export interface AccountDetail {
  account: Omit<AccountSummary, 'balanceCents' | 'balanceAsOf' | 'change30dCents' | 'trend' | 'group'>;
  snapshots: Snapshot[];
  /** Investment accounts: daily balance rebuilt from fund prices, with each day's price state. */
  history: { date: string; cents: number; state: PriceState | null; staleDays: number }[] | null;
}

export type PriceState = 'known' | 'estimated' | 'stale' | 'unavailable';

export type Range = '1m' | '3m' | '6m' | '1y' | 'all';

export interface NetWorth {
  today: string;
  range: Range;
  from: string;
  hasData: boolean;
  current: { totalCents: number; assetsCents: number; liabilitiesCents: number };
  change: { cents: number; basisPoints: number | null; since: string };
  /** priceState/staleDays only on days an investment value used an estimated, stale or missing price. */
  series: { date: string; totalCents: number; byAccount: Record<string, number>; priceState?: PriceState; staleDays?: number }[];
  allocation: { group: AccountGroup; label: string; cents: number }[];
  accounts: { id: number; name: string; type: AccountType; typeLabel: string; archived: boolean }[];
}

// ---------- Milestone 3 ----------

export interface Transaction {
  id: number;
  accountId: number;
  date: string;
  amountCents: number;
  description: string;
  rawDescription: string;
  type: TxType;
  categoryId: number | null;
  giftFrom: string;
  payer: string;
  notes: string;
  transferGroupId: number | null;
  source: 'manual' | 'import';
  importBatchId: number | null;
  /** In the list, one piece of a split transaction (amountCents/categoryId are the piece's). */
  split: { position: number; count: number; note: string; totalCents: number } | null;
}

/** One saved piece of a split transaction. */
export interface SplitPiece {
  id: number;
  position: number;
  categoryId: number;
  amountCents: number;
  note: string;
}

export interface TxList {
  transactions: Transaction[];
  total: number;
  sums: { incomeCents: number; spendingCents: number; transferCents: number; giftCents: number };
}

export interface Category {
  id: number;
  name: string;
  group: string;
  kind: 'income' | 'expense';
  color: string;
  sortOrder: number;
  archived: boolean;
  transactionCount: number;
}

export interface Rule {
  id: number;
  matchType: 'contains' | 'starts_with' | 'equals';
  pattern: string;
  accountId: number | null;
  direction: 'any' | 'in' | 'out';
  setType: TxType | null;
  setCategoryId: number | null;
  setGiftFrom: string;
  priority: number;
}

export interface Mapping {
  headerRow: number;
  dateColumn: string;
  dateFormat: 'MDY' | 'YMD' | 'DMY';
  descriptionColumns: string[];
  amountMode: 'single' | 'debitCredit' | 'indicator';
  amountColumn?: string;
  invertAmount?: boolean;
  debitColumn?: string;
  creditColumn?: string;
  indicatorColumn?: string;
  creditWord?: string;
  balanceColumn?: string;
}

export type TreatAs = 'transfer_in' | 'transfer_out' | 'growth' | 'ignore';

/** A Fidelity action Arc40 does not recognize (account-like numbers masked), with your answer. */
export interface UnknownAction {
  action: string;
  rows: number;
  cashCents: number;
  treatAs: TreatAs | null;
}

export interface ImportPreview {
  format: 'generic' | 'fidelity';
  preset: string | null;
  headers: string[];
  headerRow: number;
  mapping: Mapping | null;
  mappingSource: 'saved' | 'preset' | 'suggested' | 'provided' | null;
  mappingProblem: string | null;
  sampleRows: string[][];
  rows: {
    line: number;
    date: string;
    amountCents: number;
    description: string;
    type: TxType | null;
    categoryId: number | null;
    status: 'new' | 'duplicate';
    detail?: string;
    unknownAction?: string;
    /** A negative contribution (audit F-03): imported, lowers the totals. */
    reversal?: true;
    note?: string;
    treatedAs?: TreatAs;
  }[];
  rowsTruncated: boolean;
  unknownActions: UnknownAction[];
  skipped: { line: number; reason: string }[];
  counts: { total: number; new: number; duplicate: number; skipped: number };
  balancesFound: number;
  alreadyImported: { at: number; filename: string } | null;
}

export interface ImportResult {
  batchId: number;
  imported: number;
  duplicates: number;
  skipped: number;
  balancesRecorded: number;
  transfersLinked: number;
}

export interface ImportBatch {
  id: number;
  accountId: number;
  filename: string;
  format: string;
  rowsTotal: number;
  rowsImported: number;
  rowsDuplicate: number;
  rowsSkipped: number;
  createdAt: number;
  /** Split transactions this import brought in (undo deletes their splits too). */
  splitCount: number;
}

// ---------- Milestone 4 ----------

export interface BudgetCategory {
  id: number;
  name: string;
  group: string;
  color: string;
  spentCents: number;
  limitCents: number | null;
  isOverride: boolean;
}

export interface BudgetMonth {
  month: string;
  categories: BudgetCategory[];
  uncategorizedCents: number;
  uncategorizedIncomeCents: number;
  totals: { limitCents: number; spentCents: number; budgetedSpentCents: number };
  income: { thisMonthCents: number; avgCents: number | null; avgMonths: number; monthsUsed: number; overAverage: boolean };
  savingsRateBp: number | null;
}

export interface CashflowMonth {
  month: string;
  incomeCents: number;
  spendingCents: number;
  giftCents: number;
  savingsRateBp: number | null;
}

export interface Cashflow {
  months: CashflowMonth[];
  ytd: { incomeCents: number; spendingCents: number; giftCents: number; savingsRateBp: number | null; year: number; uncategorizedIncomeCents: number };
  gig: { payCents: number; costsCents: number; netCents: number; setAsideBp: number; setAsideOnNet: boolean; setAsideCents: number };
}

export interface AppSettings {
  idleTimeoutMinutes: number;
  incomeAvgMonths: number;
  taxSetAsideBp: number;
  taxSetAsideOnNet: boolean;
}

// ---------- V2 Phase 3: planning ----------

export type PaceStatus = 'maxed' | 'ahead' | 'on_pace' | 'behind_slightly' | 'behind_well' | 'closed' | 'not_started';
export interface PaceTarget {
  targetCents: number;
  leftCents: number;
  neededPerMonthCents: number | null;
}
export interface RothPace {
  status: PaceStatus;
  start: string;
  deadline: string;
  contributedCents: number;
  idealTodayCents: number;
  gapCents: number;
  monthOfPaceCents: number;
  totalMonths: number;
  monthsLeft: number;
  limit: PaceTarget;
  earned: PaceTarget;
  overEarned: boolean;
  actual: { date: string; cents: number }[];
  ideal: { date: string; cents: number }[];
}

export interface PlanningSettings {
  returnRateBp: number;
  defaultReturnRateBp: number;
  birth: { year: number; month: number } | null;
  age: number | null;
  futureYouLine: boolean;
  today: string;
}

// ---------- V2 Phase 3: What if ----------

export type WhatIfRange = '1y' | '5y' | '10y' | 'to40' | 'to65';
export type WhatIfChange =
  | { kind: 'spending'; categoryId: number; direction: 'up' | 'down'; amount: string }
  | { kind: 'roth'; monthly: string }
  | { kind: 'return'; rate: string };
export interface WhatIfReach {
  month: number | null;
  date: string | null;
  age: number | null;
}
export interface WhatIfPath {
  name: string;
  incomeCents: number;
  spendingCents: number;
  savingsCents: number;
  savingsRateBp: number | null;
  savingsRateChangeBp: number | null;
  returnRateBp: number;
  rothMonthlyCents: number;
  investedMonthlyCents: number;
  series: { month: number; date: string; netWorthCents: number; investedCents: number; cashCents: number }[];
  end: { netWorthCents: number; investedCents: number; cashCents: number };
  fi: { numberCents: number | null } & WhatIfReach;
  goals: {
    custom: ({ id: number; name: string; targetCents: number; accountName: string | null; currentCents: number } & WhatIfReach)[];
    roth: ({ year: number; limitCents: number; contributedCents: number; monthlyCents: number; beforeDeadline: boolean } & WhatIfReach) | null;
    emergency: ({ targetCents: number; currentCents: number } & WhatIfReach) | null;
  };
  notes: string[];
}
export interface WhatIfResult {
  today: string;
  range: WhatIfRange;
  rangeMonths: number;
  fiHorizon: { months: number; label: string };
  age: number | null;
  defaultReturnRateBp: number;
  rothRules: { year: number; limitCents: number | null; deadline: string | null; contributedCents: number; laterLimitCents: number | null };
  baseline: {
    monthsRequested: number;
    monthsUsed: number;
    from: string | null;
    to: string | null;
    incomeCents: number;
    spendingCents: number;
    savingsCents: number;
    toInvestedCents: number;
    rothMonthlyCents: number;
    cashCents: number;
    investedCents: number;
  };
  categories: { id: number; name: string; color: string; avgCents: number }[];
  current: WhatIfPath;
  scenarios: WhatIfPath[];
}

// ---------- Milestone 5 ----------

export interface Holding {
  symbol: string;
  name: string;
  sharesMicro: number;
  priceE4: number | null;
  priceDate: string | null;
  /** Where the price shown came from (history file > positions file > Fidelity trade > typed in). */
  priceSource: PriceSource | null;
  /** The price shown is an emergency edit that can be removed. */
  priceIsManual: boolean;
  /** Today's price state for this fund and, when stale, how old the price is. */
  priceState: PriceState;
  priceAgeDays: number;
  /** Imported daily price history for this fund. */
  history: { count: number; first: string; last: string } | null;
  valueCents: number | null;
  accounts: { accountId: number; sharesMicro: number }[];
}

export type PriceSource = 'history' | 'positions' | 'trade' | 'manual';

/** Preview (and, after saving, the result) of a Fidelity positions file. Never holds account numbers. */
export interface PositionsPreview {
  downloaded: { date: string; text: string } | null;
  priceDate: string | null;
  priceDateReason: string;
  accounts: { name: string; accountId: number | null; remembered: boolean }[];
  investmentAccounts: { id: number; name: string; type: string }[];
  prices: { symbol: string; description: string; priceE4: number }[];
  funds: {
    line: number;
    accountName: string;
    accountId: number | null;
    symbol: string;
    description: string;
    priceE4: number;
    previousPrice: { priceE4: number; asOf: string } | null;
    fidelitySharesMicro: number;
    arc40SharesMicro: number | null;
    differenceMicro: number | null;
    matches: boolean;
  }[];
  missing: { accountId: number; accountName: string; symbol: string; arc40SharesMicro: number }[];
  cash: { line: number; kind: 'cash' | 'pending'; accountName: string; symbol: string; valueCents: number | null; arc40CashCents: number | null }[];
  skipped: { line: number; reason: string }[];
  sample?: boolean;
  saved?: number;
}

export interface Investments {
  accounts: { id: number; name: string; typeLabel: string }[];
  selected: number | null;
  totals: { valueCents: number; putInCents: number; growthCents: number; growthBp: number | null };
  perAccount: { id: number; name: string; typeLabel: string; recordedCents: number | null; holdingsValueCents: number | null; putInCents: number }[];
  holdings: Holding[];
  series: {
    date: string;
    valueCents: number;
    putInCents: number;
    priceState: PriceState | null;
    staleDays: number;
    estimated: string[];
    stale: string[];
    missing: string[];
  }[];
  activity: { id: number; accountId: number; date: string; kind: string; symbol: string; quantityMicro: number; priceE4: number | null; amountCents: number; taxYear: number | null }[];
}

export interface Goals {
  today: string;
  roth: {
    year: number;
    years: number[];
    hasRothAccount: boolean;
    limitCents: number | null;
    deadline: string | null;
    contributedCents: number;
    remainingCents: number | null;
    earnedIncomeCents: number;
    pace: RothPace | null;
  };
  custom: { id: number; name: string; targetCents: number; accountId: number | null; accountName: string | null; targetDate: string | null; currentCents: number }[];
  emergency: {
    avgMonthlySpendingCents: number | null;
    monthsUsed: number;
    essentialsCents: number;
    targetCents: number | null;
    savingsCents: number;
    savingsAccounts: { id: number; name: string; balanceCents: number }[];
  };
}

// ---------- Milestone 6 ----------

export interface DashboardExtras {
  from: string;
  today: string;
  calendarFrom: string;
  spendingByCategory: { categoryId: number | null; name: string; group: string; color: string; cents: number }[];
  daily: { date: string; cents: number }[];
  incomeByPayer: { payer: string; cents: number }[];
  incomeBySource: { months: string[]; sources: { name: string; color: string; cents: number[] }[] };
}

// ---------- V2 Phase 2: recurring charges ----------

export type Schedule = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type Tier = 'gold' | 'silver' | 'bronze';

interface RecurringCost {
  name: string;
  schedule: Schedule;
  scheduleLabel: string;
  amountCents: number;
  yearlyCents: number;
  monthlyCents: number;
  nextDue: string | null;
  categoryId: number | null;
  splitCategoryIds: number[];
  chargeCount: number;
  firstSeen: string | null;
  lastCharge: { date: string; amountCents: number; txId: number } | null;
  isNew: boolean;
  priceIncrease: { fromCents: number; toCents: number } | null;
  varies: { lowCents: number; highCents: number } | null;
}

export interface RecurringItem extends RecurringCost {
  id: number;
  source: 'detected' | 'manual';
  status: 'confirmed' | 'cancelled';
  anchorDate: string;
  cancelledOn: string | null;
  tier: Tier | null;
}

export interface RecurringSuggestion extends RecurringCost {
  key: string;
}

export interface RecurringOverview {
  today: string;
  items: RecurringItem[];
  cancelled: RecurringItem[];
  suggestions: RecurringSuggestion[];
  totals: { yearlyCents: number; monthlyCents: number; count: number };
}

/** One expected charge on one day (confirmed or manual items only). */
export interface Bill {
  date: string;
  itemId: number;
  name: string;
  amountCents: number;
  tier: Tier | null;
  schedule: Schedule;
  scheduleLabel: string;
  categoryId: number | null;
  splitCategoryIds: number[];
}

export interface UpcomingBills {
  from: string;
  to: string;
  totalCents: number;
  bills: Bill[];
  checking: { balanceCents: number; accounts: number } | null;
  overChecking: boolean;
}

export interface BillsMonth {
  month: string;
  today: string;
  bills: Bill[];
  totalCents: number;
}

/** Preview of a daily price history file for one fund (the fund comes from the page, never the file). */
export interface PriceHistoryPreview {
  symbol: string;
  name: string;
  headers: string[];
  sampleRows: string[][];
  columns: { dateColumn: string; priceColumn: string } | null;
  columnsSource: 'provided' | 'saved' | 'recognized' | null;
  existing: { count: number; first: string; last: string } | null;
  needsColumns: boolean;
  prices: { date: string; priceE4: number }[];
  skipped: { line: number; reason: string }[];
  skippedCount?: number;
  count: number;
  first: string | null;
  last: string | null;
  adjustedWarning: boolean;
  mismatch: { comparedDays: number; typicalDiffBp: number } | null;
  sample?: boolean;
}

/** GET /api/river (V2 Phase 4 money river). */
export type RiverRange = 'month' | '3m' | 'ytd' | '12m';
export interface RiverNode {
  id: string;
  column: 0 | 1 | 2;
  kind: string;
  label: string;
  cents: number;
  categoryId?: number | null;
  color?: string;
  accountId?: number;
  isInvestment?: boolean;
  earned?: boolean;
  members?: { label: string; cents: number; categoryId: number | null }[];
}
export interface RiverLink {
  source: string;
  target: string;
  cents: number;
}
export interface RiverData {
  range: RiverRange;
  from: string;
  to: string;
  nodes: RiverNode[];
  links: RiverLink[];
  totals: {
    incomeCents: number;
    giftCents: number;
    spendingCents: number;
    investedCents: number;
    fromInvestmentsCents: number;
    keptCents: number;
    fromEarlierCents: number;
    movedCents: number;
    unknownOutCents: number;
    unknownInCents: number;
  };
  matchedTransfers: number;
  unknownTransfers: number;
}

/** GET /api/wrapped/years and /api/wrapped?year= (V2 Phase 4 Arc40 Wrapped). */
export interface WrappedYears {
  today: string;
  years: { year: number; soFar: boolean }[];
}
export type WrappedSlide =
  | { kind: 'topMerchant'; name: string; cents: number; visits: number; shareBp: number; runnersUp: { name: string; cents: number }[] }
  | { kind: 'biggestMonth'; month: string; cents: number; averageCents: number; months: { month: string; cents: number }[] }
  | { kind: 'refereeing'; totalCents: number; byPayer: { payer: string; cents: number }[]; busiestMonth: { month: string; cents: number }; months: { month: string; cents: number }[] }
  | { kind: 'netWorth'; startDate: string; endDate: string; startCents: number; endCents: number; changeCents: number; changeBp: number | null; firstYear: boolean }
  | { kind: 'savingsRate'; incomeCents: number; spendingCents: number; keptCents: number; rateBp: number }
  | {
      kind: 'investments';
      startDate: string;
      endDate: string;
      startValueCents: number;
      endValueCents: number;
      putInCents: number;
      growthCents: number;
      estimated: boolean;
      notes: string[];
    }
  | { kind: 'subscriptions'; totalCents: number; chargeCount: number; items: { name: string; cents: number; charges: number; status: 'confirmed' | 'cancelled' }[]; manualNotCounted: number }
  | { kind: 'roth'; taxYear: number; contributedCents: number; limitCents: number | null; percentBp: number | null; earnedCents: number }
  | { kind: 'topCategory'; categoryId: number | null; name: string; color: string; cents: number; shareBp: number; spendingCents: number; next: { name: string; cents: number }[] }
  | { kind: 'workCost'; spendingCents: number; tenths: number; text: string; unit: 'game' | 'hour'; title: string | null }
  | { kind: 'futureYou'; investedCents: number; age: number; months: number; valueCents: number; returnRateBp: number };
export interface Wrapped {
  year: number;
  soFar: boolean;
  from: string;
  to: string;
  today: string;
  slides: WrappedSlide[];
}

// ------------------------------------------------------------------ Trophy Case (Trophies Round 1)

export type TrophyStateName = 'off' | 'on' | 'earned';

export interface TrophyProgress {
  fraction: number;
  score: number;
  text: string;
  need: string | null;
}

export interface TrophyView {
  key: string;
  id: string;
  year: number | null;
  group: import('../../../shared/trophies').TrophyGroup;
  name: string;
  subtitle: string;
  rank: import('../../../shared/trophies').RankId;
  stars: number;
  rankLabel: string;
  shape: import('../../../shared/trophies').Shape;
  kindLabel: string;
  design: string;
  designStep: number;
  engraving: string;
  defaultMode: 'history' | 'today';
  state: TrophyStateName;
  mode: 'history' | 'today' | null;
  since: string | null;
  earnedOn: string | null;
  howCounted: string | null;
  sentence: string | null;
  progress: TrophyProgress | null;
  blocked: string | null;
  records: { period: string; amountCents: number; setOn: string }[];
  isNew: boolean;
}

/** Trophies Round 2: a trophy as the unlock pop-up shows it (GET /api/trophies/unseen, /demo-unlock). */
export interface UnlockItem extends TrophyView {
  award: number;
  groupLabel: string;
}

/** Trophies Round 2: GET /api/trophies/shelf (the Dashboard card). */
export interface TrophyShelfData {
  counts: { earned: number; on: number };
  recent: TrophyView[];
  closest: TrophyView | null;
}

export interface TrophiesResponse {
  today: string;
  counts: { earned: number; on: number; off: number; total: number };
  groups: { id: TrophyView['group']; label: string; earned: number; off: number; total: number }[];
  trophies: TrophyView[];
  closest: string[];
}

export interface TrophyDetail extends TrophyView {
  story: { label: string; points: { date: string; cents: number }[]; lineCents: number | null } | null;
  next: { key: string; name: string; rankLabel: string; fraction: number; text: string } | null;
  preview: TrophyProgress | null;
}

export interface TrophyEarned {
  key: string;
  name: string;
  rankLabel: string;
  earnedOn: string;
}
