/**
 * Account types. The database does NOT restrict the type column (SQLite cannot
 * change a CHECK constraint without rebuilding the table), so new types are
 * added here only. `available: false` types exist in the model but are hidden
 * in the UI until their feature is built.
 */

export type AccountClass = 'asset' | 'liability';
export type AccountGroup = 'cash' | 'investments' | 'debt';

export interface AccountTypeInfo {
  label: string;
  group: AccountGroup;
  class: AccountClass;
  isInvestment: boolean;
  available: boolean;
}

export const ACCOUNT_TYPES = {
  checking: { label: 'Checking', group: 'cash', class: 'asset', isInvestment: false, available: true },
  savings: { label: 'Savings', group: 'cash', class: 'asset', isInvestment: false, available: true },
  cash: { label: 'Cash', group: 'cash', class: 'asset', isInvestment: false, available: true },
  roth_ira: { label: 'Roth IRA', group: 'investments', class: 'asset', isInvestment: true, available: true },
  traditional_ira: { label: 'Traditional IRA', group: 'investments', class: 'asset', isInvestment: true, available: true },
  brokerage: { label: 'Brokerage', group: 'investments', class: 'asset', isInvestment: true, available: true },
  '401k': { label: '401(k)', group: 'investments', class: 'asset', isInvestment: true, available: true },
  credit_card: { label: 'Credit card', group: 'debt', class: 'liability', isInvestment: false, available: false },
  loan: { label: 'Loan', group: 'debt', class: 'liability', isInvestment: false, available: false },
  other: { label: 'Other', group: 'cash', class: 'asset', isInvestment: false, available: true },
} as const satisfies Record<string, AccountTypeInfo>;

export type AccountType = keyof typeof ACCOUNT_TYPES;

export const ACCOUNT_TYPE_KEYS = Object.keys(ACCOUNT_TYPES) as AccountType[];

export function isAccountType(v: unknown): v is AccountType {
  return typeof v === 'string' && Object.hasOwn(ACCOUNT_TYPES, v);
}

export const GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  investments: 'Investments',
  debt: 'Debt',
};
