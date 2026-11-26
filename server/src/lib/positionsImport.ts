/**
 * Fidelity positions import: preview (never writes) and save. Parsing is in lib/positions.ts.
 *
 *  - Prices: each fund's "Last price" is saved for the price date as source 'positions' (see
 *    lib/prices.ts for which source wins). The same fund in two accounts has one price.
 *  - Accounts: rows are matched to Arc40 accounts by Fidelity account NAME. The first time, the user
 *    picks the Arc40 account for each name; it is remembered (fidelity_account_names). Account numbers
 *    are never read, stored or returned.
 *  - Shares: Fidelity's share count for each fund is compared with Arc40's on the price date. A
 *    difference is only flagged; "Fix shares" (POST /api/investments/shares) records the existing
 *    signed adjustment when the user asks. Funds Arc40 shows in a mapped account that are missing from
 *    the file are flagged too.
 *  - Cash lines (money market / core) are compared with Arc40's uninvested cash and never saved as a price.
 */
import { logPositionsImport } from './activityLog.js';
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import { isValidIsoDate, type IsoDate } from '../../../shared/dates.js';
import { parseCsv } from './csv.js';
import { listAccounts } from './accounts.js';
import { cashCents, holdings, latestPrices } from './investments.js';
import { loadActivity } from './activity.js';
import { loadPrices, savePrice } from './prices.js';
import { accountNameKey, findPositionsHeader, inferPriceDate, parsePositions, type ParsedPositions } from './positions.js';
/** "$1234.56" without thousands commas (they would split a CSV column). */
const dollars = (cents: number) => `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

export class PositionsError extends Error {}

/** Share counts this close (0.0005 shares or less) count as matching: the file rounds to 3 decimals. */
export const SHARE_TOLERANCE_MICRO = 500;

export interface AccountChoice {
  /** Fidelity's account name, as in the file. */
  name: string;
  accountId: number | null;
}

function savedMapping(db: DB): Map<string, number> {
  const rows = db.prepare('SELECT name_key, account_id FROM fidelity_account_names').all() as { name_key: string; account_id: number }[];
  return new Map(rows.map((r) => [r.name_key, r.account_id]));
}

/** A first guess for a name nobody mapped yet: "ROTH" -> the only Roth IRA account, else the only brokerage. */
function suggest(name: string, invAccounts: { id: number; type: string }[]): number | null {
  const roth = invAccounts.filter((a) => a.type === 'roth_ira');
  const other = invAccounts.filter((a) => a.type !== 'roth_ira');
  if (/\bROTH\b/i.test(name)) return roth.length === 1 ? roth[0]!.id : null;
  return other.length === 1 ? other[0]!.id : null;
}

export function readPositionsFile(text: string): ParsedPositions {
  const rows = parseCsv(text);
  const header = findPositionsHeader(rows);
  if (header === null) {
    throw new PositionsError('This does not look like a Fidelity positions file. Download it from Positions (not Activity & Orders).');
  }
  const parsed = parsePositions(rows, header);
  if (!parsed.funds.length && !parsed.cash.length) throw new PositionsError('No positions were found in that file.');
  return parsed;
}

export function analyzePositions(
  db: DB,
  input: { text: string; priceDate?: IsoDate; mapping?: AccountChoice[] },
  today: IsoDate,
) {
  const parsed = readPositionsFile(input.text);
  const inferred = parsed.downloaded ? inferPriceDate(parsed.downloaded) : null;
  const priceDate = input.priceDate ?? inferred?.date ?? null;
  if (priceDate !== null && (!isValidIsoDate(priceDate) || priceDate > today)) {
    throw new PositionsError('Pick a price date that is not in the future.');
  }

  const inv = listAccounts(db, { includeArchived: false }).filter((a) => a.isInvestment);
  const invIds = new Set(inv.map((a) => a.id));
  const saved = savedMapping(db);
  const given = new Map((input.mapping ?? []).map((m) => [accountNameKey(m.name), m.accountId]));
  const names = [...new Set([...parsed.funds, ...parsed.cash].map((l) => l.accountName))];
  // Your choices and remembered names first; then a suggestion, but never an account another name in
  // this file already has (two Fidelity accounts are never quietly merged into one Arc40 account).
  const firstPass = names.map((name) => {
    const key = accountNameKey(name);
    const remembered = saved.get(key);
    const rememberedOk = remembered !== undefined && invIds.has(remembered);
    const chosen = given.has(key) ? given.get(key)! : rememberedOk ? remembered! : undefined;
    return { name, chosen, remembered: rememberedOk };
  });
  const used = new Set(firstPass.map((a) => a.chosen).filter((x): x is number => typeof x === 'number'));
  const accounts = firstPass.map((a) => {
    let id: number | null;
    if (a.chosen !== undefined) id = a.chosen;
    else {
      const s = suggest(a.name, inv);
      id = s !== null && !used.has(s) ? s : null;
      if (id !== null) used.add(id);
    }
    return { name: a.name, accountId: id !== null && invIds.has(id) ? id : null, remembered: a.remembered };
  });
  const accountOf = new Map(accounts.map((a) => [a.name, a.accountId]));

  const asOf = priceDate ?? today;
  const acts = loadActivity(db);
  const held = holdings(acts, asOf);
  const current = latestPrices(loadPrices(db), asOf);

  const funds = parsed.funds.map((f) => {
    const accountId = accountOf.get(f.accountName) ?? null;
    const arc40 = accountId === null ? null : (held.get(accountId)?.get(f.symbol) ?? 0);
    const prev = current.get(f.symbol);
    return {
      line: f.line,
      accountName: f.accountName,
      accountId,
      symbol: f.symbol,
      description: f.description,
      priceE4: f.priceE4,
      previousPrice: prev ? { priceE4: prev.priceE4, asOf: prev.asOf } : null,
      fidelitySharesMicro: f.quantityMicro,
      arc40SharesMicro: arc40,
      differenceMicro: arc40 === null ? null : f.quantityMicro - arc40,
      /** Fidelity shows 3 decimals, so anything under half a thousandth of a share is a match. */
      matches: arc40 !== null && Math.abs(f.quantityMicro - arc40) <= SHARE_TOLERANCE_MICRO,
      valueCents: f.valueCents,
    };
  });

  // Funds Arc40 shows in a mapped account that the file does not list.
  const listed = new Set(funds.map((f) => `${f.accountId}|${f.symbol}`));
  const missing: { accountId: number; accountName: string; symbol: string; arc40SharesMicro: number }[] = [];
  for (const a of accounts) {
    if (a.accountId === null) continue;
    for (const [symbol, sh] of held.get(a.accountId) ?? []) {
      if (sh !== 0 && !listed.has(`${a.accountId}|${symbol}`)) missing.push({ accountId: a.accountId, accountName: a.name, symbol, arc40SharesMicro: sh });
    }
  }

  const cash = parsed.cash.map((c) => {
    const accountId = accountOf.get(c.accountName) ?? null;
    return {
      line: c.line,
      kind: c.kind,
      accountName: c.accountName,
      symbol: c.symbol,
      description: c.description,
      valueCents: c.valueCents,
      arc40CashCents: c.kind === 'cash' && accountId !== null ? cashCents(acts, accountId, asOf) : null,
    };
  });

  // One price per fund (the first line wins if a fund is in two accounts at different prices).
  const prices = new Map<string, { symbol: string; description: string; priceE4: number }>();
  for (const f of parsed.funds) if (!prices.has(f.symbol)) prices.set(f.symbol, { symbol: f.symbol, description: f.description, priceE4: f.priceE4 });

  return {
    downloaded: parsed.downloaded ? { date: parsed.downloaded.date, text: parsed.downloaded.text } : null,
    priceDate,
    priceDateReason: input.priceDate && input.priceDate !== inferred?.date
      ? 'You picked this date.'
      : (inferred?.reason ?? 'The file does not say when it was downloaded. Pick the date of these prices.'),
    accounts,
    investmentAccounts: inv.map((a) => ({ id: a.id, name: a.name, type: a.type })),
    prices: [...prices.values()],
    funds,
    missing,
    cash,
    skipped: parsed.skipped,
  };
}

export type PositionsAnalysis = ReturnType<typeof analyzePositions>;

/**
 * Trophies Round 4 (Fidelity check clean): every fund in a matched account agrees with Arc40's share count and no fund
 * needs "Set to 0". Accounts marked "Not in Arc40" are left out; a file with no matched fund is not a clean check.
 */
export function shareCheckClean(a: Pick<PositionsAnalysis, 'funds' | 'missing'>): boolean {
  const mapped = a.funds.filter((f) => f.accountId !== null);
  return mapped.length > 0 && mapped.every((f) => f.matches) && a.missing.length === 0;
}

/** Saves the prices for the price date and remembers the account names. Never changes share counts. */
export function commitPositions(
  db: DB,
  input: { text: string; priceDate: IsoDate; mapping: AccountChoice[] },
  today: IsoDate,
  now: number,
): PositionsAnalysis & { saved: number } {
  const a = analyzePositions(db, input, today);
  if (!a.priceDate) throw new PositionsError('Pick the date of these prices.');
  const unmapped = a.accounts.filter((x) => x.accountId === null && !input.mapping.some((m) => accountNameKey(m.name) === accountNameKey(x.name)));
  if (unmapped.length) throw new PositionsError(`Pick an Arc40 account for "${unmapped[0]!.name}" (or "Not in Arc40").`);
  transaction(db, () => {
    for (const x of a.accounts) {
      if (x.accountId === null) continue;
      db.prepare(
        `INSERT INTO fidelity_account_names (name_key, account_id, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (name_key) DO UPDATE SET account_id = excluded.account_id, updated_at = excluded.updated_at`,
      ).run(accountNameKey(x.name), x.accountId, now);
    }
    for (const p of a.prices) savePrice(db, { symbol: p.symbol, asOf: a.priceDate!, priceE4: p.priceE4, source: 'positions', name: p.description }, now);
  });
  // Re-read so share comparisons use the newly saved prices.
  const after = analyzePositions(db, input, today);
  logPositionsImport(db, shareCheckClean(after), now); // the activity log keeps only yes/no and the date
  return { ...after, saved: a.prices.length };
}

/**
 * Demo mode only: a FAKE positions file built from the demo's own holdings, in Fidelity's layout, so
 * the import can be tried without bringing outside data in. One fund is 0.125 shares off on purpose so
 * the share difference and "Fix shares" can be seen. The account numbers are made up.
 */
export function samplePositionsFile(db: DB, today: IsoDate): string {
  const inv = listAccounts(db, { includeArchived: false }).filter((a) => a.isInvestment);
  const acts = loadActivity(db);
  const held = holdings(acts, today);
  const prices = latestPrices(loadPrices(db), today);
  const names = new Map((db.prepare('SELECT symbol, name FROM securities').all() as { symbol: string; name: string }[]).map((r) => [r.symbol, r.name]));
  const header =
    "Account number,Account name,Symbol,Description,Quantity,Last price,Last price change,Current value,Today's gain/loss dollar,Today's gain/loss percent,Total gain/loss dollar,Total gain/loss percent,Percent of account,Cost basis total,Average cost basis,Type,";
  const lines = [header];
  let first = true;
  inv.forEach((a, i) => {
    for (const [symbol, sh] of held.get(a.id) ?? []) {
      if (sh <= 0) continue;
      const p = prices.get(symbol);
      if (!p) continue;
      const priceE4 = Math.round((p.priceE4 * 1004) / 1000); // the fake "today" moved up 0.4%
      const shares = first ? sh + 125_000 : sh;
      first = false;
      // Fidelity shows prices to the cent and shares to 3 decimals; built from integers, no floats.
      const priceCents = Math.round(priceE4 / 100);
      const shares3 = Math.round(shares / 1000); // thousandths of a share
      const value = Number((BigInt(shares3 * 1000) * BigInt(priceCents * 100) + 50_000_000n) / 100_000_000n);
      const qty = `${Math.floor(shares3 / 1000)}.${String(shares3 % 1000).padStart(3, '0')}`;
      lines.push([`Z0000000${i + 1}`, a.name, symbol, names.get(symbol) ?? symbol, qty, dollars(priceCents), '+$0.10', dollars(value), '', '', '', '', '', '', '', 'Cash', ''].join(','));
    }
  });
  const [y, m, d] = today.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  lines.push(',,,,,,,,,,,,,,,,', '"Sample file made by Arc40 demo mode. Fake data.",,,,,,,,,,,,,,,,', ',,,,,,,,,,,,,,,,', `Date downloaded ${mon}-${d}-${y} 8:34 p.m ET,,,,,,,,,,,,,,,,`);
  return lines.join('\n');
}
