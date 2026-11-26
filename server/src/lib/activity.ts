/** Reads investment activity rows (Fidelity history, share adjustments) for the pure investment math. */
import type { DB } from '../db/database.js';
import type { Activity } from './investments.js';

export function loadActivity(db: DB): Activity[] {
  const rows = db
    .prepare('SELECT account_id, date, kind, symbol, quantity_micro, amount_cents, tax_year FROM investment_activity ORDER BY date, id')
    .all() as { account_id: number; date: string; kind: Activity['kind']; symbol: string; quantity_micro: number; amount_cents: number; tax_year: number | null }[];
  return rows.map((r) => ({
    accountId: r.account_id,
    date: r.date,
    kind: r.kind,
    symbol: r.symbol,
    quantityMicro: r.quantity_micro,
    amountCents: r.amount_cents,
    taxYear: r.tax_year,
  }));
}
