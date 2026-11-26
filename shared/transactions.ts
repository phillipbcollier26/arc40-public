/** Transaction types and how each one counts. See CLAUDE.md "Money rules". */

export const TX_TYPES = ['income', 'expense', 'transfer', 'gift'] as const;
export type TxType = (typeof TX_TYPES)[number];

export const TX_TYPE_LABELS: Record<TxType, string> = {
  income: 'Income',
  expense: 'Expense',
  transfer: 'Transfer',
  gift: 'Gift',
};

export const TX_TYPE_HELP: Record<TxType, string> = {
  income: 'Money you earned (refereeing pay, interest). Counts toward your savings rate.',
  expense: 'Money you spent. A positive amount here is a refund and lowers spending.',
  transfer: 'Moving your own money between your accounts. Never income or spending.',
  gift: 'Money given to you (for example from family). Adds to your balances, but is not earned income.',
};

export function isTxType(v: unknown): v is TxType {
  return typeof v === 'string' && (TX_TYPES as readonly string[]).includes(v);
}

/** Category colors are token names from tokens.css (never raw colors). */
export const CATEGORY_COLORS = ['gold', 'silver', 'bronze', 'platinum', 'copper', 'pewter', 'sage', 'garnet'] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];
