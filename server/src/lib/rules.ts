/**
 * Auto-categorization rules. Pure functions.
 * Matching is plain text, case-insensitive, on the cleaned AND raw description.
 * Lower priority runs first; the first matching rule wins.
 */
import type { TxType } from '../../../shared/transactions.js';

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

export interface RuleTarget {
  accountId: number;
  amountCents: number;
  description: string;
  rawDescription: string;
}

export interface CategoryKind {
  id: number;
  kind: 'income' | 'expense';
}

export function ruleMatches(rule: Rule, tx: RuleTarget): boolean {
  if (rule.accountId !== null && rule.accountId !== tx.accountId) return false;
  if (rule.direction === 'in' && tx.amountCents <= 0) return false;
  if (rule.direction === 'out' && tx.amountCents >= 0) return false;
  const p = rule.pattern.trim().toUpperCase();
  if (!p) return false;
  const texts = [tx.description, tx.rawDescription].map((t) => t.trim().toUpperCase());
  switch (rule.matchType) {
    case 'contains':
      return texts.some((t) => t.includes(p));
    case 'starts_with':
      return texts.some((t) => t.startsWith(p));
    case 'equals':
      return texts.some((t) => t === p);
  }
}

export function sortRules(rules: readonly Rule[]): Rule[] {
  return [...rules].sort((a, b) => a.priority - b.priority || b.id - a.id);
}

export interface Classification {
  type: TxType;
  categoryId: number | null;
  giftFrom: string;
  ruleId: number | null;
}

/**
 * Picks type + category for a transaction. Without a matching rule:
 * money in = income, money out = expense, both uncategorized.
 */
export function classify(
  tx: RuleTarget,
  rules: readonly Rule[],
  categories: readonly CategoryKind[],
): Classification {
  const kindOf = new Map(categories.map((c) => [c.id, c.kind]));
  const fallback: TxType = tx.amountCents > 0 ? 'income' : 'expense';
  for (const rule of sortRules(rules)) {
    if (!ruleMatches(rule, tx)) continue;
    const catKind = rule.setCategoryId !== null ? kindOf.get(rule.setCategoryId) : undefined;
    const type: TxType = rule.setType ?? catKind ?? fallback;
    const categoryId =
      (type === 'income' || type === 'expense') && catKind === type ? rule.setCategoryId : null;
    return { type, categoryId, giftFrom: type === 'gift' ? rule.setGiftFrom : '', ruleId: rule.id };
  }
  // Refunds: money IN from a merchant that a money-OUT rule files under an expense
  // category (e.g. "KROGER REFUND" with the Kroger -> Food rule) is a refund. It is an
  // expense-type row with a positive amount, so it lowers spending instead of counting
  // as income.
  if (tx.amountCents > 0) {
    const asSpending = { ...tx, amountCents: -tx.amountCents };
    for (const rule of sortRules(rules)) {
      if (rule.direction !== 'out' || rule.setCategoryId === null) continue;
      if (rule.setType !== null && rule.setType !== 'expense') continue;
      if (kindOf.get(rule.setCategoryId) !== 'expense' || !ruleMatches(rule, asSpending)) continue;
      return { type: 'expense', categoryId: rule.setCategoryId, giftFrom: '', ruleId: rule.id };
    }
  }
  return { type: fallback, categoryId: null, giftFrom: '', ruleId: null };
}
