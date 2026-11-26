/**
 * The money river (V2 Phase 4): where money came from, which account it landed in, and where it went.
 * Pure functions, no database. The DB side is lib/moneyRiver.ts.
 *
 * Three columns, left to right:
 *   sources       income categories, Gifts, refunds, "From investments", money moved in,
 *                 "From money you already had"
 *   accounts      the accounts the money landed in (investment accounts only when money reached them
 *                 from outside your tracked bank accounts, or they had income, gifts or spending)
 *   destinations  spending categories, Invested, Kept as cash, money moved out
 *
 * Rules (all money is integer cents; income, spending and gifts come from lib/totals.ts lines):
 *   - Every account balances: what flows in on the left equals what flows out on the right.
 *     Left - right = the account's change; a positive change is "Kept as cash" (or "Invested" for an
 *     investment account), a negative change comes in on the left as "From money you already had".
 *   - Income and spending are netted per account and category (refunds lower spending; a category
 *     with more refunds than purchases shows on the left as "Refunds: X").
 *   - Transfers are NEVER income or spending. A transfer from a bank account into an investment
 *     account is "Invested" (counted once, on the bank side). Back out is "From investments".
 *     Between two bank accounts it is "Moved between your accounts" on both sides (they cancel).
 *   - Finding the other side of a transfer: linked first; else an unlinked transfer of the same size
 *     in another account within 7 days (never a pair the user unlinked); else a bank transfer whose text
 *     names an investment account's institution (e.g. "FIDELITY", "FID BKG SVC"). These guesses are
 *     ONLY for this picture: nothing is linked or changed. What is still unknown is shown as
 *     "Moved out (other side not found)" and listed in the notes.
 *   - Small income or spending categories (when there are 2 or more) are
 *     grouped into "Other sources" / "Other spending" (3% of that column's income or spending);
 *     the node lists what is inside.
 */
import { addDays, addMonths, startOfMonth, type IsoDate } from '../../../shared/dates.js';
import type { Cents } from './money.js';
import type { MoneyLine, TransferLeg } from './totals.js';
import { findTransferPairs } from './transfers.js';

export const RIVER_RANGES = ['month', '3m', 'ytd', '12m'] as const;
export type RiverRange = (typeof RIVER_RANGES)[number];

/** Window for unlinked transfers paired by amount and date (auto-linking at import uses 3). */
export const INFER_WINDOW_DAYS = 7;
/** How far an institution-name match may be from the investment side it claims. */
export const NAME_CLAIM_DAYS = 31;
/** Categories under this share of their column (basis points) are grouped into "Other". */
export const OTHER_THRESHOLD_BP = 300;

export function riverDates(range: RiverRange, today: IsoDate): { from: IsoDate; to: IsoDate } {
  const month = startOfMonth(today);
  const from =
    range === 'month' ? month : range === '3m' ? addMonths(month, -2) : range === 'ytd' ? `${today.slice(0, 4)}-01-01` : addMonths(month, -11);
  return { from, to: today };
}

/** The dates to load transfer legs for, so pairs that straddle the range edges are still found. */
export function legWindow(from: IsoDate, to: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(from, -NAME_CLAIM_DAYS), to: addDays(to, NAME_CLAIM_DAYS) };
}

export interface RiverAccount {
  id: number;
  name: string;
  institution: string;
  isInvestment: boolean;
  sortOrder: number;
}

export interface RiverCategory {
  id: number;
  name: string;
  color: string;
  /** Pay for work (Refereeing, Other Income roles): shown as gold in the river. */
  earned?: boolean;
}

export type LegRole =
  | 'invested'
  | 'fromInvestments'
  | 'movedOut'
  | 'movedIn'
  | 'unknownOut'
  | 'unknownIn'
  | 'outsideIn'
  | 'outsideOut'
  | 'skip';

export interface LegClass {
  txId: number;
  accountId: number;
  date: IsoDate;
  amountCents: Cents;
  role: LegRole;
  /** How the other side was found: linked, matched (amount + date), name (institution text), none. */
  how: 'linked' | 'matched' | 'name' | 'none';
  /** Same value on both sides of a pair found by amount and date (so a pair counts as ONE transfer). */
  pairKey?: string;
}

const words = (s: string) => ` ${s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()} `;

/**
 * Institution names that identify an investment account in bank text. An institution that a bank
 * account also uses is left out (it could be either). Fidelity's ACH text says "FID BKG SVC".
 */
export function institutionAliases(accounts: readonly RiverAccount[]): Map<string, Set<number>> {
  const cashInst = new Set(accounts.filter((a) => !a.isInvestment).map((a) => words(a.institution).trim()).filter(Boolean));
  const out = new Map<string, Set<number>>();
  for (const a of accounts) {
    if (!a.isInvestment) continue;
    const inst = words(a.institution).trim();
    if (inst.length < 4 || cashInst.has(inst)) continue;
    const names = [inst];
    if (/\bFIDELITY\b/.test(inst)) names.push('FID BKG SVC');
    for (const n of names) out.set(n, new Set([...(out.get(n) ?? []), a.id]));
  }
  return out;
}

/** The investment accounts a piece of bank text names, if any. */
function namedInvestmentAccounts(text: string, aliases: Map<string, Set<number>>): Set<number> {
  const t = words(text);
  const hit = new Set<number>();
  for (const [alias, ids] of aliases) if (t.includes(` ${alias} `)) for (const id of ids) hit.add(id);
  return hit;
}

const dayNum = (d: IsoDate) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

/**
 * Decides what each transfer leg in [from, to] means for the river. `legs` should cover legWindow()
 * so the other side of a transfer near the range edge is still seen. A pair between a bank account and
 * an investment account counts once, on the bank side (its date decides the range).
 */
export function classifyTransfers(
  legs: readonly TransferLeg[],
  accounts: readonly RiverAccount[],
  from: IsoDate,
  to: IsoDate,
  blocked: ReadonlySet<string> = new Set(),
): LegClass[] {
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const isInv = (id: number) => acct.get(id)?.isInvestment ?? false;

  // 1. Partner account per leg: linked, else paired by amount and date (read-only guess).
  const partner = new Map<number, { accountId: number; how: 'linked' | 'matched'; key?: string }>();
  for (const l of legs) if (l.partnerAccountId !== null) partner.set(l.txId, { accountId: l.partnerAccountId, how: 'linked' });
  const open = legs.filter((l) => l.partnerAccountId === null && l.amountCents !== 0);
  const pairs = findTransferPairs(
    open.map((l) => ({ id: l.txId, accountId: l.accountId, date: l.date, amountCents: l.amountCents, type: 'transfer' as const, transferGroupId: null })),
    INFER_WINDOW_DAYS,
    blocked,
  );
  const byId = new Map(legs.map((l) => [l.txId, l]));
  for (const [o, i] of pairs) {
    const key = `${Math.min(o, i)}-${Math.max(o, i)}`;
    partner.set(o, { accountId: byId.get(i)!.accountId, how: 'matched', key });
    partner.set(i, { accountId: byId.get(o)!.accountId, how: 'matched', key });
  }

  // 2. Bank legs that name an investment institution. Each claims at most one unmatched investment-side
  //    leg of the same size (within NAME_CLAIM_DAYS), so the money is never counted twice.
  const aliases = institutionAliases(accounts);
  const named = new Map<number, 'invested' | 'fromInvestments'>();
  const claimed = new Set<number>();
  const invOpen = open.filter((l) => isInv(l.accountId) && !partner.has(l.txId));
  for (const l of open) {
    if (partner.has(l.txId) || isInv(l.accountId) || !acct.has(l.accountId)) continue;
    const ids = namedInvestmentAccounts(l.text, aliases);
    if (ids.size === 0) continue;
    named.set(l.txId, l.amountCents < 0 ? 'invested' : 'fromInvestments');
    const match = invOpen
      .filter((c) => !claimed.has(c.txId) && ids.has(c.accountId) && c.amountCents === -l.amountCents && Math.abs(dayNum(c.date) - dayNum(l.date)) <= NAME_CLAIM_DAYS)
      .sort((a, b) => Math.abs(dayNum(a.date) - dayNum(l.date)) - Math.abs(dayNum(b.date) - dayNum(l.date)) || a.txId - b.txId)[0];
    if (match) claimed.add(match.txId);
  }

  // 3. Roles for the legs inside the range.
  const out: LegClass[] = [];
  for (const l of legs) {
    if (l.date < from || l.date > to || l.amountCents === 0 || !acct.has(l.accountId)) continue;
    const mine = isInv(l.accountId);
    const isOut = l.amountCents < 0;
    const p = partner.get(l.txId);
    let role: LegRole;
    let how: LegClass['how'] = 'none';
    if (p) {
      how = p.how;
      const theirs = isInv(p.accountId);
      if (mine) role = 'skip'; // counted on the bank side, or moved between investment accounts
      else if (theirs) role = isOut ? 'invested' : 'fromInvestments';
      else role = isOut ? 'movedOut' : 'movedIn';
    } else if (named.has(l.txId)) {
      how = 'name';
      role = named.get(l.txId)!;
    } else if (mine) {
      role = claimed.has(l.txId) ? 'skip' : isOut ? 'outsideOut' : 'outsideIn';
    } else {
      role = isOut ? 'unknownOut' : 'unknownIn';
    }
    out.push({ txId: l.txId, accountId: l.accountId, date: l.date, amountCents: l.amountCents, role, how, ...(p?.key ? { pairKey: p.key } : {}) });
  }
  return out;
}

export type NodeKind =
  | 'income'
  | 'gift'
  | 'refund'
  | 'fromInvestments'
  | 'movedIn'
  | 'unknownIn'
  | 'outsideIn'
  | 'fromEarlier'
  | 'account'
  | 'spending'
  | 'other'
  | 'incomeBack'
  | 'giftOut'
  | 'invested'
  | 'kept'
  | 'movedOut'
  | 'unknownOut'
  | 'outsideOut';

export interface RiverNode {
  id: string;
  column: 0 | 1 | 2;
  kind: NodeKind;
  label: string;
  cents: Cents;
  /** Spending/income/refund category (null = uncategorized). Absent for other kinds. */
  categoryId?: number | null;
  color?: string;
  accountId?: number;
  isInvestment?: boolean;
  /** Income node: pay for work (gold) vs other income such as interest (bronze). */
  earned?: boolean;
  /** What "Other" holds, biggest first. */
  members?: { label: string; cents: Cents; categoryId: number | null }[];
}

export interface RiverLink {
  source: string;
  target: string;
  cents: Cents;
}

export interface RiverTotals {
  incomeCents: Cents;
  giftCents: Cents;
  spendingCents: Cents;
  investedCents: Cents;
  fromInvestmentsCents: Cents;
  keptCents: Cents;
  fromEarlierCents: Cents;
  movedCents: Cents;
  unknownOutCents: Cents;
  unknownInCents: Cents;
}

export interface River {
  nodes: RiverNode[];
  links: RiverLink[];
  totals: RiverTotals;
  /** Transfers matched without a link (amount + date or the bank's text), and ones still unknown. */
  matchedTransfers: number;
  unknownTransfers: number;
}

const LEFT_ROLE: Partial<Record<LegRole, [NodeKind, string]>> = {
  fromInvestments: ['fromInvestments', 'From investments'],
  movedIn: ['movedIn', 'Moved from your other accounts'],
  unknownIn: ['unknownIn', 'Moved in (other side not found)'],
  outsideIn: ['outsideIn', 'Put in from outside Arc40'],
};
const RIGHT_ROLE: Partial<Record<LegRole, [NodeKind, string]>> = {
  invested: ['invested', 'Invested'],
  movedOut: ['movedOut', 'Moved to your other accounts'],
  unknownOut: ['unknownOut', 'Moved out (other side not found)'],
  outsideOut: ['outsideOut', 'Taken out of investments'],
};

const LEFT_ORDER: NodeKind[] = ['income', 'other', 'gift', 'refund', 'fromInvestments', 'movedIn', 'unknownIn', 'outsideIn', 'fromEarlier'];
const RIGHT_ORDER: NodeKind[] = ['spending', 'other', 'incomeBack', 'giftOut', 'invested', 'kept', 'movedOut', 'unknownOut', 'outsideOut'];

/**
 * Builds the river from the range's money lines (lib/totals.ts) and classified transfer legs.
 * `lines` must be exactly the lines in the range; transfer lines in it are ignored (legs carry them).
 */
export function buildRiver(
  lines: readonly MoneyLine[],
  legs: readonly LegClass[],
  accounts: readonly RiverAccount[],
  categories: readonly RiverCategory[],
): River {
  const acct = new Map(accounts.map((a) => [a.id, a]));
  const cat = new Map(categories.map((c) => [c.id, c]));
  // Per account: flow key -> signed cents (+ = into the account).
  const flows = new Map<number, Map<string, Cents>>();
  const add = (accountId: number, key: string, cents: Cents) => {
    if (!acct.has(accountId)) return;
    const m = flows.get(accountId) ?? new Map<string, Cents>();
    m.set(key, (m.get(key) ?? 0) + cents);
    flows.set(accountId, m);
  };
  for (const l of lines) {
    if (l.type === 'income') add(l.accountId, `income:${l.categoryId ?? 'none'}`, l.amountCents);
    else if (l.type === 'expense') add(l.accountId, `expense:${l.categoryId ?? 'none'}`, l.amountCents);
    else if (l.type === 'gift') add(l.accountId, 'gift', l.amountCents);
  }
  const matched = new Set<string>();
  let unknown = 0;
  for (const g of legs) {
    if (g.how === 'matched' || g.how === 'name') matched.add(g.pairKey ?? `${g.txId}`);
    if (g.role === 'skip') continue;
    if (g.role === 'unknownIn' || g.role === 'unknownOut') unknown += 1;
    add(g.accountId, `role:${g.role}`, g.amountCents);
  }

  const nodes = new Map<string, RiverNode>();
  const links = new Map<string, RiverLink>();
  const node = (id: string, make: () => Omit<RiverNode, 'id' | 'cents'>) => {
    if (!nodes.has(id)) nodes.set(id, { id, cents: 0, ...make() });
    return nodes.get(id)!;
  };
  const link = (source: string, target: string, cents: Cents) => {
    if (cents <= 0) return;
    const k = `${source}>${target}`;
    const cur = links.get(k) ?? { source, target, cents: 0 };
    cur.cents += cents;
    links.set(k, cur);
  };
  const catLabel = (id: number | null, income: boolean) =>
    id === null ? (income ? 'Uncategorized income' : 'Uncategorized') : (cat.get(id)?.name ?? 'Unknown category');

  const ordered = [...flows.keys()].sort((a, b) => {
    const x = acct.get(a)!;
    const y = acct.get(b)!;
    return Number(x.isInvestment) - Number(y.isInvestment) || x.sortOrder - y.sortOrder || x.id - y.id;
  });
  for (const accountId of ordered) {
    const a = acct.get(accountId)!;
    const m = flows.get(accountId)!;
    if ([...m.values()].every((v) => v === 0)) continue;
    const aId = `acct:${accountId}`;
    node(aId, () => ({ column: 1, kind: 'account', label: a.name, accountId, isInvestment: a.isInvestment }));
    let change = 0;
    for (const [key, v] of m) {
      if (v === 0) continue;
      change += v;
      const [kind, rest] = key.split(/:(.*)/s) as [string, string];
      if (kind === 'income' || kind === 'expense') {
        const categoryId = rest === 'none' ? null : Number(rest);
        const color = categoryId === null ? 'pewter' : (cat.get(categoryId)?.color ?? 'pewter');
        const base = catLabel(categoryId, kind === 'income');
        if (kind === 'income' && v > 0) {
          const earned = categoryId !== null && cat.get(categoryId)?.earned === true;
          link(node(`src:income:${rest}`, () => ({ column: 0, kind: 'income', label: base, categoryId, color, earned })).id, aId, v);
        } else if (kind === 'income') {
          link(aId, node(`dst:incomeBack:${rest}`, () => ({ column: 2, kind: 'incomeBack', label: `${base} (paid back)`, categoryId, color })).id, -v);
        } else if (v < 0) {
          link(aId, node(`dst:spend:${rest}`, () => ({ column: 2, kind: 'spending', label: base, categoryId, color })).id, -v);
        } else {
          link(node(`src:refund:${rest}`, () => ({ column: 0, kind: 'refund', label: `Refunds: ${base}`, categoryId, color })).id, aId, v);
        }
      } else if (kind === 'gift') {
        if (v > 0) link(node('src:gift', () => ({ column: 0, kind: 'gift', label: 'Gifts' })).id, aId, v);
        else link(aId, node('dst:giftOut', () => ({ column: 2, kind: 'giftOut', label: 'Gifts sent back' })).id, -v);
      } else {
        const role = rest as LegRole;
        // A role's direction is fixed by its leg's sign, but sum in and out separately per side.
        const spec = v > 0 ? LEFT_ROLE[role] : RIGHT_ROLE[role];
        if (spec) {
          const [nk, label] = spec;
          if (v > 0) link(node(`src:${nk}`, () => ({ column: 0, kind: nk, label })).id, aId, v);
          else link(aId, node(`dst:${nk}`, () => ({ column: 2, kind: nk, label })).id, -v);
        }
      }
    }
    if (change > 0) {
      const id = a.isInvestment ? 'dst:invested' : 'dst:kept';
      link(aId, node(id, () => (a.isInvestment ? { column: 2, kind: 'invested', label: 'Invested' } : { column: 2, kind: 'kept', label: 'Kept as cash' })).id, change);
    } else if (change < 0) {
      link(node('src:fromEarlier', () => ({ column: 0, kind: 'fromEarlier', label: 'From money you already had' })).id, aId, -change);
    }
  }

  // Node sizes from their links.
  for (const l of links.values()) {
    const s = nodes.get(l.source)!;
    const t = nodes.get(l.target)!;
    if (s.column === 0) s.cents += l.cents;
    if (t.column === 2) t.cents += l.cents;
    if (t.column === 1) t.cents += l.cents;
  }

  groupSmall(nodes, links, 0, 'income', 'src:other', 'Other sources');
  groupSmall(nodes, links, 2, 'spending', 'dst:other', 'Other spending');

  const list = [...nodes.values()];
  const rank = (n: RiverNode) => (n.column === 0 ? LEFT_ORDER.indexOf(n.kind) : n.column === 2 ? RIGHT_ORDER.indexOf(n.kind) : 0);
  const sizeSorted = (n: RiverNode) => n.kind === 'income' || n.kind === 'spending' || n.kind === 'refund' || n.kind === 'incomeBack';
  const accountOrder = new Map(ordered.map((id, i) => [`acct:${id}`, i]));
  list.sort((x, y) => {
    if (x.column !== y.column) return x.column - y.column;
    if (x.column === 1) return accountOrder.get(x.id)! - accountOrder.get(y.id)!;
    return rank(x) - rank(y) || (sizeSorted(x) ? y.cents - x.cents : 0) || (x.label < y.label ? -1 : x.label > y.label ? 1 : 0);
  });

  const sumKind = (kinds: NodeKind[]) => list.filter((n) => kinds.includes(n.kind)).reduce((s, n) => s + n.cents, 0);
  const memberSum = (col: 0 | 2) => list.find((n) => n.kind === 'other' && n.column === col)?.cents ?? 0;
  const totals: RiverTotals = {
    incomeCents: sumKind(['income']) + memberSum(0) - sumKind(['incomeBack']),
    giftCents: sumKind(['gift']) - sumKind(['giftOut']),
    spendingCents: sumKind(['spending']) + memberSum(2) - sumKind(['refund']),
    investedCents: sumKind(['invested']),
    fromInvestmentsCents: sumKind(['fromInvestments']),
    keptCents: sumKind(['kept']),
    fromEarlierCents: sumKind(['fromEarlier']),
    movedCents: sumKind(['movedOut']),
    unknownOutCents: sumKind(['unknownOut']),
    unknownInCents: sumKind(['unknownIn']),
  };
  const linkOrder = new Map(list.map((n, i) => [n.id, i]));
  const linkList = [...links.values()].sort(
    (a, b) => linkOrder.get(a.source)! - linkOrder.get(b.source)! || linkOrder.get(a.target)! - linkOrder.get(b.target)!,
  );
  return { nodes: list, links: linkList, totals, matchedTransfers: matched.size, unknownTransfers: unknown };
}

/**
 * Groups the small category nodes of one column into one "Other" node (only when 2+ are small).
 * Small = under OTHER_THRESHOLD_BP of the column's income (sources) or spending (destinations).
 */
function groupSmall(nodes: Map<string, RiverNode>, links: Map<string, RiverLink>, column: 0 | 2, kind: NodeKind, id: string, label: string) {
  const col = [...nodes.values()].filter((n) => n.column === column && n.kind === kind);
  const total = col.reduce((s, n) => s + n.cents, 0);
  if (total <= 0) return;
  const small = col.filter((n) => n.cents * 10_000 < total * OTHER_THRESHOLD_BP);
  if (small.length < 2) return;
  const ids = new Set(small.map((n) => n.id));
  const other: RiverNode = {
    id,
    column,
    kind: 'other',
    label,
    cents: small.reduce((s, n) => s + n.cents, 0),
    members: small
      .map((n) => ({ label: n.label, cents: n.cents, categoryId: n.categoryId ?? null }))
      .sort((a, b) => b.cents - a.cents || (a.label < b.label ? -1 : 1)),
  };
  for (const n of small) nodes.delete(n.id);
  nodes.set(id, other);
  for (const [k, l] of [...links]) {
    if (!ids.has(l.source) && !ids.has(l.target)) continue;
    links.delete(k);
    const source = ids.has(l.source) ? id : l.source;
    const target = ids.has(l.target) ? id : l.target;
    const nk = `${source}>${target}`;
    const cur = links.get(nk) ?? { source, target, cents: 0 };
    cur.cents += l.cents;
    links.set(nk, cur);
  }
}

/** Every account node: cents in from the left equal cents out to the right. */
export function accountBalances(river: River): { accountId: number; inCents: Cents; outCents: Cents }[] {
  return river.nodes
    .filter((n) => n.kind === 'account')
    .map((n) => ({
      accountId: n.accountId!,
      inCents: river.links.filter((l) => l.target === n.id).reduce((s, l) => s + l.cents, 0),
      outCents: river.links.filter((l) => l.source === n.id).reduce((s, l) => s + l.cents, 0),
    }));
}
