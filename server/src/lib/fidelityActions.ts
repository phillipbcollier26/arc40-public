/**
 * The user's answers for Fidelity history actions Arc40 does not recognize.
 *
 * Arc40 never guesses what an unknown action means. The import preview flags it with its text,
 * The user picks "money put in", "money taken out", "growth" or "ignore", and the answer is
 * remembered (by action text with account-like numbers masked) for every later import.
 *
 * Saving an answer also applies it to rows ALREADY imported with that action, so history that
 * was imported before is corrected without re-importing:
 *   transfer_in / transfer_out: the activity row's kind changes and a matching `transfer`
 *     transaction is added (same import batch, so undoing that import still removes it);
 *   growth: the row stays 'other' (its cash is growth) and any transfer transaction goes;
 *   ignore: the imported rows (and their transfer transactions) are removed. Re-importing the
 *     file after changing the answer brings them back.
 * Rows Arc40 recognizes by itself are never touched.
 */
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import { actionKey, classifyAction, fidelityCashDescription, type TreatAs } from './fidelity.js';
import { autoLinkTransfers, insertTransaction, repairTransferLinks } from './transactions.js';

export function loadActionAnswers(db: DB): Map<string, TreatAs> {
  const rows = db.prepare('SELECT action_key, treat_as FROM fidelity_action_rules').all() as { action_key: string; treat_as: TreatAs }[];
  return new Map(rows.map((r) => [r.action_key, r.treat_as]));
}

export function listActionAnswers(db: DB): { action: string; treatAs: TreatAs; updatedAt: number }[] {
  return (
    db.prepare('SELECT action_key, treat_as, updated_at FROM fidelity_action_rules ORDER BY action_key').all() as {
      action_key: string;
      treat_as: TreatAs;
      updated_at: number;
    }[]
  ).map((r) => ({ action: r.action_key, treatAs: r.treat_as, updatedAt: r.updated_at }));
}

interface ActivityRow {
  id: number;
  account_id: number;
  date: string;
  kind: string;
  amount_cents: number;
  raw_action: string;
  import_batch_id: number | null;
  dedupe_key: string | null;
  tax_year: number | null;
}

/**
 * Saves the answer for one action and applies it to already-imported rows with that action.
 * Returns how many imported rows changed. `action` may be raw text; it is normalized to its key.
 */
export function saveActionAnswer(db: DB, action: string, treatAs: TreatAs, now: number): { key: string; rowsUpdated: number } {
  const key = actionKey(action);
  return transaction(db, () => {
    db.prepare(
      `INSERT INTO fidelity_action_rules (action_key, treat_as, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (action_key) DO UPDATE SET treat_as = excluded.treat_as, updated_at = excluded.updated_at`,
    ).run(key, treatAs, now);

    const rows = (
      db
        .prepare(
          `SELECT id, account_id, date, kind, amount_cents, raw_action, import_batch_id, dedupe_key, tax_year
           FROM investment_activity WHERE source = 'import'`,
        )
        .all() as unknown as ActivityRow[]
    ).filter((r) => classifyAction(r.raw_action) === 'other' && actionKey(r.raw_action) === key);

    const findTx = db.prepare('SELECT id FROM transactions WHERE account_id = ? AND dedupe_key = ?');
    const delTx = db.prepare('DELETE FROM transactions WHERE id = ?');
    let changed = 0;
    for (const r of rows) {
      const txKey = r.dedupe_key ? `fid:${r.dedupe_key}` : null;
      const tx = txKey ? (findTx.get(r.account_id, txKey) as { id: number } | undefined) : undefined;

      if (treatAs === 'ignore') {
        db.prepare('DELETE FROM investment_activity WHERE id = ?').run(r.id);
        if (tx) delTx.run(tx.id);
        changed++;
        continue;
      }
      const kind = treatAs === 'growth' ? 'other' : treatAs;
      if (kind !== r.kind) {
        db.prepare('UPDATE investment_activity SET kind = ? WHERE id = ?').run(kind, r.id);
        changed++;
      }
      const wantsTransfer = (kind === 'transfer_in' || kind === 'transfer_out') && r.amount_cents !== 0;
      if (wantsTransfer && !tx && txKey) {
        insertTransaction(
          db,
          {
            accountId: r.account_id,
            date: r.date,
            amountCents: r.amount_cents,
            description: fidelityCashDescription({ kind, taxYear: r.tax_year }) ?? 'Transfer',
            rawDescription: r.raw_action,
            type: 'transfer',
            categoryId: null,
            source: 'import',
            importBatchId: r.import_batch_id ?? undefined,
            dedupeKey: txKey,
          },
          now,
        );
      } else if (!wantsTransfer && tx) {
        delTx.run(tx.id);
      }
    }
    repairTransferLinks(db);
    autoLinkTransfers(db, now);
    return { key, rowsUpdated: changed };
  });
}
