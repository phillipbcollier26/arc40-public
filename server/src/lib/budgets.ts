/**
 * Budget limits (the Budget page and the Spending habits trophies, Trophies Round 3). ONE place, so both agree:
 * a category's limit for a month is that month's override ('YYYY-MM-01'), else its every-month default ('*').
 * Limits have no history: an every-month default applies to past months too.
 */
import type { DB } from '../db/database.js';

export interface BudgetRow {
  categoryId: number;
  /** '*' = every month, 'YYYY-MM-01' = only that month. */
  month: string;
  limitCents: number;
}

export function loadBudgetRows(db: DB): BudgetRow[] {
  return (db.prepare('SELECT category_id, month, limit_cents FROM budgets ORDER BY category_id, month').all() as {
    category_id: number;
    month: string;
    limit_cents: number;
  }[]).map((r) => ({ categoryId: r.category_id, month: r.month, limitCents: r.limit_cents }));
}

/** Pure: effective limits for one month ('YYYY-MM-01'). */
export function effectiveLimits(rows: readonly BudgetRow[], month: string): Map<number, { limitCents: number; isOverride: boolean }> {
  const out = new Map<number, { limitCents: number; isOverride: boolean }>();
  for (const r of rows) if (r.month === '*') out.set(r.categoryId, { limitCents: r.limitCents, isOverride: false });
  for (const r of rows) if (r.month === month) out.set(r.categoryId, { limitCents: r.limitCents, isOverride: true });
  return out;
}

/** Effective limits for a month, read from the database. */
export function limitsFor(db: DB, month: string): Map<number, { limitCents: number; isOverride: boolean }> {
  return effectiveLimits(loadBudgetRows(db), month);
}
