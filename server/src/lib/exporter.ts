/**
 * "Export everything": one ZIP with
 *   arc40.db          a complete copy of the database (restorable)
 *   csv/*.csv         readable tables for spreadsheets
 *   arc40.json        the same data as JSON
 *   README.txt        what is inside and how to restore
 * CSV safety: text cells starting with = + - @ (or tab / carriage return) get a leading
 * apostrophe so a spreadsheet never runs them as formulas. Numbers are written as plain
 * numbers (a negative amount like -12.34 is a number, not text, so it is left alone).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { copyDatabase } from './backup.js';
import { makeZip, type ZipEntry } from './zip.js';

type Cell = string | number | null | { num: string };

/** Escapes one CSV cell. `{ num }` marks an already-formatted number (never formula-escaped). */
export function csvCell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'object') s = v.num;
  else {
    s = v;
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map((c) => csvCell(c)).join(',')).join('\r\n') + '\r\n';
}

/** Integer cents -> {num: "-12.34"} with exact integer math. */
export function money(cents: number | null): Cell {
  if (cents === null) return null;
  const neg = cents < 0;
  const a = Math.abs(cents);
  return { num: `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}` };
}

function scaled(v: number | null, scale: number): Cell {
  if (v === null) return null;
  const neg = v < 0;
  const a = Math.abs(v);
  const div = 10 ** scale;
  const frac = String(a % div).padStart(scale, '0').replace(/0+$/, '');
  return { num: `${neg ? '-' : ''}${Math.floor(a / div)}${frac ? `.${frac}` : ''}` };
}

const all = <T>(db: DB, sql: string) => db.prepare(sql).all() as T[];

export async function buildExport(db: DB, now: number): Promise<{ filename: string; zip: Buffer }> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arc40-export-'));
  try {
    const dbFile = path.join(tmp, 'arc40.db');
    await copyDatabase(db, dbFile);

    type Acc = { id: number; name: string; institution: string; type: string; class: string; archived: number };
    const accounts = all<Acc>(db, 'SELECT id, name, institution, type, class, archived FROM accounts ORDER BY id');
    const accName = new Map(accounts.map((a) => [a.id, a.name]));
    const cats = all<{ id: number; name: string; group_name: string; kind: string; color: string; archived: number }>(db, 'SELECT * FROM categories ORDER BY sort_order, name');
    const catName = new Map(cats.map((c) => [c.id, c.name]));

    const files: Record<string, string> = {
      'accounts.csv': toCsv(
        ['id', 'name', 'institution', 'type', 'class', 'archived'],
        accounts.map((a) => [a.id, a.name, a.institution, a.type, a.class, a.archived ? 'yes' : 'no']),
      ),
      'balances.csv': toCsv(
        ['account', 'date', 'balance', 'source', 'note'],
        all<{ account_id: number; as_of: string; balance_cents: number; source: string; note: string }>(db, 'SELECT * FROM balance_snapshots ORDER BY account_id, as_of').map((r) => [
          accName.get(r.account_id) ?? r.account_id,
          r.as_of,
          money(r.balance_cents),
          r.source,
          r.note,
        ]),
      ),
      'transactions.csv': toCsv(
        ['date', 'account', 'description', 'bank_text', 'amount', 'type', 'category', 'gift_from', 'paid_by', 'notes', 'transfer_group', 'source'],
        all<{
          date: string;
          account_id: number;
          description: string;
          raw_description: string;
          amount_cents: number;
          type: string;
          category_id: number | null;
          gift_from: string;
          payer: string;
          notes: string;
          transfer_group_id: number | null;
          source: string;
        }>(db, 'SELECT * FROM transactions ORDER BY date, id').map((r) => [
          r.date,
          accName.get(r.account_id) ?? r.account_id,
          r.description,
          r.raw_description,
          money(r.amount_cents),
          r.type,
          r.category_id === null ? '' : (catName.get(r.category_id) ?? ''),
          r.gift_from,
          r.payer,
          r.notes,
          r.transfer_group_id,
          r.source,
        ]),
      ),
      'split_pieces.csv': toCsv(
        ['date', 'account', 'description', 'piece', 'of', 'category', 'amount', 'note'],
        all<{ date: string; account_id: number; description: string; position: number; n: number; category_id: number | null; amount_cents: number; note: string }>(
          db,
          `SELECT t.date, t.account_id, t.description, s.position, s.category_id, s.amount_cents, s.note,
                  (SELECT COUNT(*) FROM transaction_splits c WHERE c.transaction_id = t.id) AS n
           FROM transaction_splits s JOIN transactions t ON t.id = s.transaction_id ORDER BY t.date, t.id, s.position`,
        ).map((r) => [
          r.date,
          accName.get(r.account_id) ?? r.account_id,
          r.description,
          r.position,
          r.n,
          r.category_id === null ? '' : (catName.get(r.category_id) ?? ''),
          money(r.amount_cents),
          r.note,
        ]),
      ),
      'categories.csv': toCsv(
        ['name', 'group', 'kind', 'color', 'archived'],
        cats.map((c) => [c.name, c.group_name, c.kind, c.color, c.archived ? 'yes' : 'no']),
      ),
      'rules.csv': toCsv(
        ['match', 'text', 'money', 'account', 'set_type', 'set_category', 'gift_from', 'priority'],
        all<{ match_type: string; pattern: string; direction: string; account_id: number | null; set_type: string | null; set_category_id: number | null; set_gift_from: string; priority: number }>(
          db,
          'SELECT * FROM category_rules ORDER BY priority, id',
        ).map((r) => [r.match_type, r.pattern, r.direction, r.account_id ? (accName.get(r.account_id) ?? '') : 'any', r.set_type, r.set_category_id ? (catName.get(r.set_category_id) ?? '') : '', r.set_gift_from, r.priority]),
      ),
      'budgets.csv': toCsv(
        ['category', 'month', 'limit'],
        all<{ category_id: number; month: string; limit_cents: number }>(db, 'SELECT * FROM budgets ORDER BY category_id, month').map((r) => [
          catName.get(r.category_id) ?? r.category_id,
          r.month === '*' ? 'every month' : r.month,
          money(r.limit_cents),
        ]),
      ),
      'investment_activity.csv': toCsv(
        ['date', 'account', 'kind', 'symbol', 'shares', 'price', 'amount', 'tax_year', 'action', 'source'],
        all<{ date: string; account_id: number; kind: string; symbol: string; quantity_micro: number; price_e4: number | null; amount_cents: number; tax_year: number | null; raw_action: string; source: string }>(
          db,
          'SELECT * FROM investment_activity ORDER BY date, id',
        ).map((r) => [r.date, accName.get(r.account_id) ?? r.account_id, r.kind, r.symbol, scaled(r.quantity_micro, 6), scaled(r.price_e4, 4), money(r.amount_cents), r.tax_year, r.raw_action, r.source]),
      ),
      'prices.csv': toCsv(
        ['symbol', 'date', 'price', 'source'],
        all<{ symbol: string; as_of: string; price_e4: number; source: string }>(db, 'SELECT * FROM price_points ORDER BY symbol, as_of, source').map((r) => [r.symbol, r.as_of, scaled(r.price_e4, 4), r.source]),
      ),
      'goals.csv': toCsv(
        ['name', 'target', 'account', 'target_date', 'archived'],
        all<{ name: string; target_cents: number; account_id: number | null; target_date: string | null; archived: number }>(db, 'SELECT * FROM goals ORDER BY id').map((r) => [
          r.name,
          money(r.target_cents),
          r.account_id ? (accName.get(r.account_id) ?? '') : '',
          r.target_date,
          r.archived ? 'yes' : 'no',
        ]),
      ),
    };

    // JSON: every table except login data (password hash, sessions).
    const tables = all<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('app_user','sessions') AND name NOT LIKE 'sqlite_%' ORDER BY name");
    const json = Object.fromEntries(tables.map((t) => [t.name, all(db, `SELECT * FROM "${t.name}"`)]));

    const day = toIsoDate(now);
    const readme = [
      `Arc40 export, ${day}`,
      '',
      'arc40.db           Complete copy of your Arc40 database. To restore it, see "Restoring" in the Arc40 README',
      '                   (stop Arc40, then run: npm run restore -- /path/to/arc40.db).',
      'csv/               One spreadsheet-friendly file per table. Amounts are dollars (e.g. -12.34 = money out).',
      '                   Shares have up to 6 decimals, prices up to 4.',
      'arc40.json         The same data as JSON (login data left out).',
      '',
      'This file contains your private financial data. Keep it somewhere safe and never upload it.',
      '',
    ].join('\n');

    const entries: ZipEntry[] = [
      { name: 'README.txt', data: Buffer.from(readme) },
      { name: 'arc40.db', data: fs.readFileSync(dbFile) },
      { name: 'arc40.json', data: Buffer.from(JSON.stringify({ exportedAt: new Date(now).toISOString(), ...json }, null, 2)) },
      ...Object.entries(files).map(([n, text]) => ({ name: `csv/${n}`, data: Buffer.from('﻿' + text) })),
    ];
    return { filename: `arc40-export-${day}.zip`, zip: makeZip(entries, new Date(now)) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
