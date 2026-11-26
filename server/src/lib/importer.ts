/**
 * CSV import: analyze (preview) and commit. Preview never writes anything.
 * Commit re-analyzes the same text, so what you saw is what gets saved.
 */
import crypto from 'node:crypto';
import type { DB } from '../db/database.js';
import { transaction } from '../db/database.js';
import type { TxType } from '../../../shared/transactions.js';
import { parseCsv } from './csv.js';
import {
  applyMapping,
  detectPreset,
  endOfDayBalances,
  findHeaderRow,
  suggestMapping,
  validateMapping,
  type GenericMapping,
  type ParsedRow,
  type SkippedRow,
} from './importMapping.js';
import { actionKey, fidelityCashDescription, findFidelityHeader, parseFidelity, type FidelityRow, type TreatAs } from './fidelity.js';
import { loadActionAnswers } from './fidelityActions.js';
import { splitCountForBatch } from './splits.js';
import { savePriceIfMissing } from './prices.js';
import { fingerprint, planDedupe } from './dedupe.js';
import { classify } from './rules.js';
import { autoLinkTransfers, categoryKinds, insertTransaction, listRules, repairTransferLinks } from './transactions.js';
import { getAccount } from './accounts.js';

export class ImportError extends Error {}

export const REVERSAL_NOTE = 'Contribution reversal: this lowers your total';

export interface ImportInput {
  accountId: number;
  filename: string;
  text: string;
  /** Only for bank (generic) files. Omit to use the saved or suggested mapping. */
  mapping?: GenericMapping;
}

export interface PreviewRow {
  line: number;
  date: string;
  amountCents: number;
  description: string;
  type: TxType | null; // null = investment-only row (a trade or dividend)
  categoryId: number | null;
  status: 'new' | 'duplicate';
  detail?: string; // Fidelity: "Bought 3.865 FXAIX @ $258.70"
  /** Fidelity: Arc40 does not know this action (account-like numbers masked). Shown flagged. */
  unknownAction?: string;
  /** Fidelity: a contribution with a negative amount (a reversal). Imported; it lowers the totals (audit F-03). */
  reversal?: true;
  /** A short plain-language note shown on the row. */
  note?: string;
  /** Fidelity: decided by an answer the user saved. */
  treatedAs?: TreatAs;
}

/** One entry per Fidelity action Arc40 does not recognize, with the user's answer if one was given. */
export interface UnknownAction {
  action: string;
  rows: number;
  cashCents: number;
  treatAs: TreatAs | null;
}

export interface Analysis {
  format: 'generic' | 'fidelity';
  preset: string | null;
  headers: string[];
  headerRow: number;
  mapping: GenericMapping | null;
  mappingSource: 'saved' | 'preset' | 'suggested' | 'provided' | null;
  mappingProblem: string | null;
  sampleRows: string[][];
  rows: PreviewRow[];
  skipped: SkippedRow[];
  counts: { total: number; new: number; duplicate: number; skipped: number };
  balancesFound: number;
  /** Fidelity files only: actions Arc40 does not recognize (answered or not). */
  unknownActions: UnknownAction[];
  alreadyImported: { at: number; filename: string } | null;
  fileSha256: string;
  // internal, for commit
  _generic?: { parsed: ParsedRow[]; keys: string[]; isNew: boolean[] };
  _fidelity?: { parsed: FidelityRow[]; keys: string[]; isNew: boolean[] };
}

function savedMapping(db: DB, accountId: number): GenericMapping | null {
  const r = db.prepare("SELECT config FROM csv_mappings WHERE account_id = ? AND format = 'generic'").get(accountId) as
    | { config: string }
    | undefined;
  if (!r) return null;
  try {
    return JSON.parse(r.config) as GenericMapping;
  } catch {
    return null;
  }
}

const countTx = (db: DB, accountId: number) => {
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM transactions WHERE account_id = ? AND dedupe_key = ?');
  return (k: string) => (stmt.get(accountId, k) as { n: number }).n;
};
const countActivity = (db: DB, accountId: number) => {
  const stmt = db.prepare('SELECT COUNT(*) AS n FROM investment_activity WHERE account_id = ? AND dedupe_key = ?');
  return (k: string) => (stmt.get(accountId, k) as { n: number }).n;
};

export function analyzeImport(db: DB, input: ImportInput): Analysis {
  const account = getAccount(db, input.accountId);
  if (!account) throw new ImportError('Pick an account to import into.');
  const rows = parseCsv(input.text);
  if (rows.length < 2) throw new ImportError('That file is empty or has no transactions.');

  const fileSha256 = crypto.createHash('sha256').update(input.text).digest('hex');
  const prior = db
    .prepare('SELECT created_at, filename FROM import_batches WHERE account_id = ? AND file_sha256 = ? ORDER BY id DESC LIMIT 1')
    .get(input.accountId, fileSha256) as { created_at: number; filename: string } | undefined;
  const alreadyImported = prior ? { at: prior.created_at, filename: prior.filename } : null;

  const rules = listRules(db);
  const kinds = categoryKinds(db);

  // ----- Fidelity -----
  const fidHeader = findFidelityHeader(rows);
  if (fidHeader !== null) {
    if (!account.isInvestment) {
      throw new ImportError('This looks like a Fidelity investment file. Import it into your Roth IRA or brokerage account.');
    }
    const answers = loadActionAnswers(db);
    const { parsed, skipped } = parseFidelity(rows, fidHeader, answers);
    // The fingerprint uses the exact action text (in memory only) so files imported before
    // masking existed still match as duplicates.
    const keys = parsed.map((p) =>
      fingerprint(['fid', p.date, p.actionForDedupe, p.symbol, p.quantityMicro, p.amountCents]),
    );
    const unknownActions = summarizeUnknown(rows, fidHeader, answers);
    const isNew = planDedupe(keys, countActivity(db, input.accountId));
    const previewRows: PreviewRow[] = parsed.map((p, i) => {
      const cash = fidelityCashDescription(p);
      return {
        line: p.line,
        date: p.date,
        amountCents: p.amountCents,
        description: cash ?? describeTrade(p),
        type: cash ? 'transfer' : null,
        categoryId: null,
        status: isNew[i] ? 'new' : 'duplicate',
        detail: p.kind,
        ...(p.unknown ? { unknownAction: actionKey(p.rawAction) } : {}),
        ...(p.treatedAs ? { treatedAs: p.treatedAs } : {}),
        ...(p.kind === 'contribution' && p.amountCents < 0 ? { reversal: true as const, note: REVERSAL_NOTE } : {}),
      };
    });
    return {
      format: 'fidelity',
      preset: 'Fidelity',
      headers: rows[fidHeader]!.map((h) => h.trim()),
      headerRow: fidHeader,
      mapping: null,
      mappingSource: null,
      mappingProblem: null,
      sampleRows: [],
      rows: previewRows,
      skipped,
      counts: summarize(isNew, skipped.length),
      balancesFound: 0,
      unknownActions,
      alreadyImported,
      fileSha256,
      _fidelity: { parsed, keys, isNew },
    };
  }

  // ----- Bank CSV with a column mapping -----
  const detectedHeader = findHeaderRow(rows);
  let mapping: GenericMapping;
  let mappingSource: Analysis['mappingSource'];
  const saved = savedMapping(db, input.accountId);
  if (input.mapping) {
    mapping = input.mapping;
    mappingSource = 'provided';
  } else if (saved && rows[saved.headerRow] && !validateMapping(saved, rows[saved.headerRow]!.map((h) => h.trim()))) {
    mapping = saved;
    mappingSource = 'saved';
  } else {
    mapping = suggestMapping(rows, detectedHeader);
    mappingSource = detectPreset((rows[detectedHeader] ?? []).map((h) => h.trim())) ? 'preset' : 'suggested';
  }

  const headers = (rows[mapping.headerRow] ?? []).map((h) => h.trim());
  const preset = detectPreset(headers)?.name ?? null;
  const sampleRows = rows.slice(mapping.headerRow + 1, mapping.headerRow + 7);
  const mappingProblem = validateMapping(mapping, headers);
  if (mappingProblem) {
    return {
      format: 'generic',
      preset,
      headers,
      headerRow: mapping.headerRow,
      mapping,
      mappingSource,
      mappingProblem,
      sampleRows,
      rows: [],
      skipped: [],
      counts: { total: 0, new: 0, duplicate: 0, skipped: 0 },
      balancesFound: 0,
      unknownActions: [],
      alreadyImported,
      fileSha256,
    };
  }

  const { parsed, skipped } = applyMapping(rows, mapping);
  const keys = parsed.map((p) => fingerprint(['row', p.date, p.amountCents, p.rawDescription, p.balanceCents]));
  const isNew = planDedupe(keys, countTx(db, input.accountId));
  const previewRows: PreviewRow[] = parsed.map((p, i) => {
    const c = classify({ accountId: input.accountId, ...p }, rules, kinds);
    return {
      line: p.line,
      date: p.date,
      amountCents: p.amountCents,
      description: p.description,
      type: c.type,
      categoryId: c.categoryId,
      status: isNew[i] ? 'new' : 'duplicate',
    };
  });

  return {
    format: 'generic',
    preset,
    headers,
    headerRow: mapping.headerRow,
    mapping,
    mappingSource,
    mappingProblem: null,
    sampleRows,
    rows: previewRows,
    skipped,
    counts: summarize(isNew, skipped.length),
    balancesFound: endOfDayBalances(parsed).size,
    unknownActions: [],
    alreadyImported,
    fileSha256,
    _generic: { parsed, keys, isNew },
  };
}

/** Every action in the file that Arc40 does not know, including ones answered with 'ignore'. */
function summarizeUnknown(rows: string[][], headerRow: number, answers: ReadonlyMap<string, TreatAs>): UnknownAction[] {
  const all = parseFidelity(rows, headerRow, new Map()).parsed.filter((p) => p.unknown);
  const out = new Map<string, UnknownAction>();
  for (const p of all) {
    const action = actionKey(p.rawAction);
    const cur = out.get(action) ?? { action, rows: 0, cashCents: 0, treatAs: answers.get(action) ?? null };
    cur.rows++;
    cur.cashCents += p.amountCents;
    out.set(action, cur);
  }
  return [...out.values()];
}

function summarize(isNew: boolean[], skipped: number) {
  const n = isNew.filter(Boolean).length;
  return { total: isNew.length + skipped, new: n, duplicate: isNew.length - n, skipped };
}

function describeTrade(p: FidelityRow): string {
  const shares = (p.quantityMicro / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 6 });
  const label = p.symbol || p.description || 'fund';
  switch (p.kind) {
    case 'buy':
      return `Bought ${shares} ${label}`;
    case 'sell':
      return `Sold ${shares} ${label}`;
    case 'reinvest':
      return `Reinvested dividend: ${shares} ${label}`;
    case 'dividend':
      return `Dividend from ${label}`;
    case 'interest':
      return 'Interest';
    case 'fee':
      return 'Fee';
    default:
      return p.rawAction.slice(0, 80) || 'Other activity';
  }
}

export interface CommitResult {
  batchId: number;
  imported: number;
  duplicates: number;
  skipped: number;
  balancesRecorded: number;
  transfersLinked: number;
}

export function commitImport(db: DB, input: ImportInput, now: number): CommitResult {
  const a = analyzeImport(db, input);
  if (a.mappingProblem) throw new ImportError(a.mappingProblem);

  return transaction(db, () => {
    const batchId = Number(
      db
        .prepare(
          `INSERT INTO import_batches (account_id, filename, file_sha256, format, rows_total, rows_imported, rows_duplicate, rows_skipped, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.accountId,
          input.filename.slice(0, 200),
          a.fileSha256,
          a.format,
          a.counts.total,
          a.counts.new,
          a.counts.duplicate,
          a.counts.skipped,
          now,
        ).lastInsertRowid,
    );

    let balancesRecorded = 0;
    const rules = listRules(db);
    const kinds = categoryKinds(db);

    if (a._generic) {
      const { parsed, keys, isNew } = a._generic;
      parsed.forEach((p, i) => {
        if (!isNew[i]) return;
        const c = classify({ accountId: input.accountId, ...p }, rules, kinds);
        insertTransaction(
          db,
          {
            accountId: input.accountId,
            date: p.date,
            amountCents: p.amountCents,
            description: p.description,
            rawDescription: p.rawDescription,
            type: c.type,
            categoryId: c.categoryId,
            giftFrom: c.giftFrom,
            source: 'import',
            importBatchId: batchId,
            dedupeKey: keys[i],
          },
          now,
        );
      });

      // Running balances -> balance history, without overwriting balances you typed in.
      // A balance an earlier import already recorded with the SAME value keeps that import as its
      // owner (audit F-01): undoing a re-import that added nothing must never remove it. Only a new
      // day, or a day whose end balance changed, is claimed by this import.
      const existing = db.prepare('SELECT source, balance_cents FROM balance_snapshots WHERE account_id = ? AND as_of = ?');
      const upsert = db.prepare(
        `INSERT INTO balance_snapshots (account_id, as_of, balance_cents, source, created_at, import_batch_id)
         VALUES (?, ?, ?, 'import', ?, ?)
         ON CONFLICT (account_id, as_of) DO UPDATE SET balance_cents = excluded.balance_cents,
           import_batch_id = excluded.import_batch_id WHERE balance_snapshots.source = 'import'`,
      );
      for (const [date, cents] of endOfDayBalances(parsed)) {
        const cur = existing.get(input.accountId, date) as { source: string; balance_cents: number } | undefined;
        if (cur && cur.source !== 'import') continue;
        if (cur && cur.balance_cents === cents) continue;
        upsert.run(input.accountId, date, cents, now, batchId);
        balancesRecorded++;
      }

      db.prepare(
        `INSERT INTO csv_mappings (account_id, format, config, updated_at) VALUES (?, 'generic', ?, ?)
         ON CONFLICT (account_id) DO UPDATE SET format = excluded.format, config = excluded.config, updated_at = excluded.updated_at`,
      ).run(input.accountId, JSON.stringify(a.mapping), now);
    }

    if (a._fidelity) {
      const { parsed, keys, isNew } = a._fidelity;
      const ins = db.prepare(
        `INSERT INTO investment_activity (account_id, date, kind, symbol, description, quantity_micro, price_e4, amount_cents,
           tax_year, raw_action, source, import_batch_id, dedupe_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?, ?)`,
      );
      const addSec = db.prepare('INSERT INTO securities (symbol, name) VALUES (?, ?) ON CONFLICT (symbol) DO NOTHING');
      // Prices from buys/reinvests, kept as their own source ('trade'); see lib/prices.ts for which wins.
      for (const p of parsed) {
        if (!p.symbol) continue;
        addSec.run(p.symbol, p.description);
        if (p.priceE4 && p.priceE4 > 0) savePriceIfMissing(db, { symbol: p.symbol, asOf: p.date, priceE4: p.priceE4, source: 'trade' }, now);
      }
      parsed.forEach((p, i) => {
        if (!isNew[i]) return;
        ins.run(
          input.accountId,
          p.date,
          p.kind,
          p.symbol,
          p.description,
          p.quantityMicro,
          p.priceE4,
          p.amountCents,
          p.taxYear,
          p.rawAction,
          batchId,
          keys[i]!,
          now,
        );
        const cash = fidelityCashDescription(p);
        if (cash && p.amountCents !== 0) {
          insertTransaction(
            db,
            {
              accountId: input.accountId,
              date: p.date,
              amountCents: p.amountCents,
              description: cash,
              rawDescription: p.rawAction,
              type: 'transfer',
              categoryId: null,
              source: 'import',
              importBatchId: batchId,
              dedupeKey: `fid:${keys[i]}`,
            },
            now,
          );
        }
      });
    }

    const transfersLinked = autoLinkTransfers(db, now);
    return {
      batchId,
      imported: a.counts.new,
      duplicates: a.counts.duplicate,
      skipped: a.counts.skipped,
      balancesRecorded,
      transfersLinked,
    };
  });
}

/** Undo: removes everything an import added (transactions, activity, balances). */
export function undoImport(db: DB, batchId: number): boolean {
  return transaction(db, () => {
    const ok = db.prepare('DELETE FROM import_batches WHERE id = ?').run(batchId).changes > 0;
    if (ok) repairTransferLinks(db);
    return ok;
  });
}

export function listImportBatches(db: DB, accountId?: number) {
  const rows = (
    accountId
      ? db.prepare('SELECT * FROM import_batches WHERE account_id = ? ORDER BY id DESC').all(accountId)
      : db.prepare('SELECT * FROM import_batches ORDER BY id DESC LIMIT 50').all()
  ) as {
    id: number;
    account_id: number;
    filename: string;
    format: string;
    rows_total: number;
    rows_imported: number;
    rows_duplicate: number;
    rows_skipped: number;
    created_at: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    filename: r.filename,
    format: r.format,
    rowsTotal: r.rows_total,
    rowsImported: r.rows_imported,
    rowsDuplicate: r.rows_duplicate,
    rowsSkipped: r.rows_skipped,
    createdAt: r.created_at,
    /** Split transactions this import brought in: undoing it deletes their splits too. */
    splitCount: splitCountForBatch(db, r.id),
  }));
}
