/**
 * Fidelity account-history CSV ("Run Date, Action, Symbol, ... Amount ($)").
 * Recognized automatically; no column mapping needed.
 *
 * What each row becomes:
 *  - contributions and transfers in/out: an investment_activity row AND a
 *    `transfer` transaction (money moving between your own accounts)
 *  - buys, sells, reinvestments, dividends, fees: investment_activity only.
 *    Dividends are investment growth, never income.
 */
import { parseSharesToMicro, parsePriceToE4, DecimalParseError } from '../../../shared/decimal.js';
import type { IsoDate } from '../../../shared/dates.js';
import { parseMoneyToCents, type Cents } from './money.js';
import { parseBankDate, type SkippedRow } from './importMapping.js';
import { isBlankRow } from './csv.js';

export type ActivityKind =
  | 'contribution'
  | 'transfer_in'
  | 'transfer_out'
  | 'buy'
  | 'sell'
  | 'reinvest'
  | 'dividend'
  | 'interest'
  | 'fee'
  | 'other';

/**
 * The user's answer for an action Arc40 does not recognize (saved in fidelity_action_rules).
 *   transfer_in  = money put in        transfer_out = money taken out
 *   growth       = the cash is growth (kept as 'other')   ignore = do not import the row
 */
export const TREAT_AS = ['transfer_in', 'transfer_out', 'growth', 'ignore'] as const;
export type TreatAs = (typeof TREAT_AS)[number];

/**
 * Masks anything that could be an account number: any run of digits (hyphens allowed inside,
 * up to two letters in front) holding 5 or more digits. "FIDELITY 500 INDEX" keeps its 500.
 */
export function maskAccountNumbers(text: string): string {
  return text.replace(/\b[A-Za-z]{0,2}\d[\d-]*\d\b/g, (m) => (m.replace(/\D/g, '').length >= 5 ? '\u2022\u2022\u2022\u2022' : m));
}

/** The key an answer is remembered under: upper case, single spaces, account-like numbers masked. */
export function actionKey(rawAction: string): string {
  return maskAccountNumbers(rawAction.toUpperCase().replace(/\s+/g, ' ').trim()).slice(0, 300);
}

export interface FidelityRow {
  line: number;
  date: IsoDate;
  kind: ActivityKind;
  symbol: string;
  description: string;
  quantityMicro: number;
  priceE4: number | null;
  amountCents: Cents;
  taxYear: number | null;
  /** Action text as stored and shown: account-like numbers masked. */
  rawAction: string;
  /** The exact action text, only for the duplicate fingerprint (kept in memory, never stored). */
  actionForDedupe: string;
  /** Arc40 does not recognize this action and the user has not answered for it yet. */
  unknown: boolean;
  /** Set when the user's saved answer decided the kind. */
  treatedAs: TreatAs | null;
}

const REQUIRED = ['Run Date', 'Action', 'Amount ($)'];

export function findFidelityHeader(rows: string[][]): number | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i]!.map((c) => c.trim());
    if (REQUIRED.every((h) => cells.includes(h))) return i;
  }
  return null;
}

export function classifyAction(action: string): ActivityKind {
  const a = action.toUpperCase();
  if (a.includes('CONTRIBUTION')) return 'contribution';
  if (a.includes('REINVESTMENT')) return 'reinvest';
  if (a.includes('YOU BOUGHT')) return 'buy';
  if (a.includes('YOU SOLD')) return 'sell';
  if (a.includes('DIVIDEND')) return 'dividend';
  if (a.includes('INTEREST')) return 'interest';
  if (a.includes('FEE')) return 'fee';
  if (a.includes('TRANSFER') && (a.includes('RECEIVED') || a.includes(' IN '))) return 'transfer_in';
  if (a.includes('TRANSFER') && (a.includes('PAID') || a.includes('SENT') || a.includes(' OUT'))) return 'transfer_out';
  return 'other';
}

/**
 * Built-in kind first; when Arc40 does not know the action, the user's saved answer (if any).
 * 'ignore' comes back as null (the row is not imported).
 */
export function resolveAction(
  rawAction: string,
  answers: ReadonlyMap<string, TreatAs>,
): { kind: ActivityKind | null; unknown: boolean; treatedAs: TreatAs | null } {
  const builtIn = classifyAction(rawAction);
  if (builtIn !== 'other') return { kind: builtIn, unknown: false, treatedAs: null };
  const answer = answers.get(actionKey(rawAction));
  if (!answer) return { kind: 'other', unknown: true, treatedAs: null };
  if (answer === 'ignore') return { kind: null, unknown: false, treatedAs: answer };
  return { kind: answer === 'growth' ? 'other' : answer, unknown: false, treatedAs: answer };
}

export function parseFidelity(
  rows: string[][],
  headerRow: number,
  answers: ReadonlyMap<string, TreatAs> = new Map(),
): { parsed: FidelityRow[]; skipped: SkippedRow[] } {
  const headers = rows[headerRow]!.map((h) => h.trim());
  const idx = (h: string) => headers.indexOf(h);
  const iDate = idx('Run Date');
  const iAction = idx('Action');
  const iSymbol = idx('Symbol');
  const iDesc = idx('Description');
  const iPrice = idx('Price ($)');
  const iQty = idx('Quantity');
  const iAmount = idx('Amount ($)');

  const parsed: FidelityRow[] = [];
  const skipped: SkippedRow[] = [];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r]!;
    if (isBlankRow(row) || row.filter((c) => c.trim()).length <= 1) continue; // spacer/footer lines
    const cell = (i: number) => (i >= 0 ? (row[i] ?? '').trim() : '');
    const line = r + 1;

    const date = parseBankDate(cell(iDate), 'MDY');
    if (!date) {
      skipped.push({ line, reason: `"${cell(iDate).slice(0, 30)}" is not a date` });
      continue;
    }
    const rawAction = cell(iAction);
    const resolved = resolveAction(rawAction, answers);
    if (resolved.kind === null) {
      skipped.push({ line, reason: `Ignored, as you chose: "${actionKey(rawAction).slice(0, 60)}"` });
      continue;
    }
    const kind = resolved.kind;

    let amountCents = 0;
    let quantityMicro = 0;
    let priceE4: number | null = null;
    try {
      amountCents = cell(iAmount) ? parseMoneyToCents(cell(iAmount)) : 0;
      quantityMicro = cell(iQty) ? parseSharesToMicro(cell(iQty)) : 0;
      priceE4 = cell(iPrice) ? parsePriceToE4(cell(iPrice)) : null;
    } catch (e) {
      skipped.push({ line, reason: e instanceof DecimalParseError ? e.message : 'A number on this row is not valid' });
      continue;
    }

    const year = Number(date.slice(0, 4));
    const taxYear =
      kind === 'contribution' ? (rawAction.toUpperCase().includes('PRIOR YEAR') ? year - 1 : year) : null;

    parsed.push({
      line,
      date,
      kind,
      symbol: cell(iSymbol),
      description: cell(iDesc) === 'No Description' ? '' : cell(iDesc),
      quantityMicro,
      priceE4,
      amountCents,
      taxYear,
      rawAction: maskAccountNumbers(rawAction).slice(0, 300),
      actionForDedupe: rawAction,
      unknown: resolved.unknown,
      treatedAs: resolved.treatedAs,
    });
  }
  return { parsed, skipped };
}

/** Readable text for the transaction list, e.g. "Contribution (2026 tax year)". */
export function fidelityCashDescription(r: Pick<FidelityRow, "kind" | "taxYear">): string | null {
  switch (r.kind) {
    case 'contribution':
      return `Contribution (${r.taxYear} tax year)`;
    case 'transfer_in':
      return 'Transfer in';
    case 'transfer_out':
      return 'Transfer out';
    default:
      return null; // trades and dividends stay inside the account
  }
}
