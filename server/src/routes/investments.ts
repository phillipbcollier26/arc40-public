import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { addMonths, isValidIsoDate, toIsoDate } from '../../../shared/dates.js';
import { DecimalParseError, parsePriceToE4, parseSharesToMicro } from '../../../shared/decimal.js';
import { ACCOUNT_TYPES } from '../../../shared/accounts.js';
import { getAccount, listAccounts, listSnapshots, toNw, upsertSnapshot } from '../lib/accounts.js';
import { chartDates, netWorthSeries } from '../lib/networth.js';
import {
  cashCents,
  growthBp,
  holdings,
  latestPrices,
  moneyPutIn,
  valueCents,
  type Activity,
} from '../lib/investments.js';
import { deletePrice, loadPricePoints, loadPrices, savePrice } from '../lib/prices.js';
import { priceLines, statesByDate } from '../lib/valuation.js';
import { historySummary } from '../lib/priceHistoryImport.js';

export { loadActivity } from '../lib/activity.js';
import { loadActivity } from '../lib/activity.js';

const pricesBody = z.object({
  asOf: z.string().optional(),
  prices: z.array(z.object({ symbol: z.string().trim().min(1).max(12), price: z.string().trim().min(1).max(20) })).min(1).max(50),
});

const sharesBody = z.object({
  accountId: z.number().int().positive(),
  symbol: z.string().trim().min(1).max(12),
  shares: z.string().trim().min(1).max(30),
  /** The day the share count is true for (a positions file's date). Default today. */
  asOf: z.string().max(10).optional(),
});

export function registerInvestmentRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const today = () => toIsoDate(now());

  /** Everything for the Investments page. ?accountId=N narrows to one account; omit for all. */
  app.get('/api/investments', async (req, reply) => {
    const t = today();
    const invAccounts = listAccounts(db, { includeArchived: true }).filter((a) => a.isInvestment);
    const pick = Number((req.query as { accountId?: string }).accountId) || null;
    if (pick && !invAccounts.some((a) => a.id === pick)) return bad(reply, 'Pick an investment account.');
    const ids = new Set(pick ? [pick] : invAccounts.map((a) => a.id));

    const acts = loadActivity(db);
    const prices = loadPrices(db);
    const latest = latestPrices(prices, t);
    const held = holdings(acts, t);
    const names = new Map((db.prepare('SELECT symbol, name FROM securities').all() as { symbol: string; name: string }[]).map((r) => [r.symbol, r.name]));

    // Holdings rows (merged across the selected accounts)
    const bySymbol = new Map<string, { sharesMicro: number; accounts: { accountId: number; sharesMicro: number }[] }>();
    for (const [accountId, m] of held) {
      if (!ids.has(accountId)) continue;
      for (const [symbol, sh] of m) {
        if (sh === 0) continue;
        const row = bySymbol.get(symbol) ?? { sharesMicro: 0, accounts: [] };
        row.sharesMicro += sh;
        row.accounts.push({ accountId, sharesMicro: sh });
        bySymbol.set(symbol, row);
      }
    }
    const lines = priceLines(prices);
    const histories = historySummary(db);
    const holdingsRows = [...bySymbol.entries()].map(([symbol, r]) => {
      const p = latest.get(symbol);
      const today = lines.get(symbol)?.at(t);
      return {
        /** Today's price state for this fund (known / estimated / stale / unavailable) and its age if stale. */
        priceState: today?.state ?? 'unavailable',
        priceAgeDays: today?.ageDays ?? 0,
        /** Imported daily price history for this fund, if any. */
        history: histories.get(symbol) ?? null,
        priceSource: p?.source ?? null,
        /** True when the price shown is an emergency edit that can be removed. */
        priceIsManual: p?.source === 'manual',
        symbol,
        name: names.get(symbol) ?? '',
        sharesMicro: r.sharesMicro,
        priceE4: p?.priceE4 ?? null,
        priceDate: p?.asOf ?? null,
        valueCents: p ? valueCents(r.sharesMicro, p.priceE4) : null,
        accounts: r.accounts,
      };
    });

    // Value comes from the same place as net worth (balances + transactions), so screens agree.
    const all = listAccounts(db, { includeArchived: true });
    const nw = toNw(db, all, listSnapshots(db), t);
    const earliest = [...acts.filter((a) => ids.has(a.accountId)).map((a) => a.date), ...nw.snapshots.filter((s) => ids.has(s.accountId)).map((s) => s.asOf)].sort()[0];
    const from = earliest && earliest < t ? earliest : addMonths(t, -1);
    const series = netWorthSeries(nw.accounts.filter((a) => ids.has(a.id)), nw.snapshots, chartDates(nw.changeDates.concat(acts.map((a) => a.date)), from, t), nw.flows);
    const valueNow = series.at(-1)!.totalCents;
    const states = statesByDate(nw.valuation, ids);
    const putIn = moneyPutIn(acts, t, ids);

    // Per-account comparison: recorded balance vs holdings x latest price (+ uninvested cash).
    const perAccount = invAccounts
      .filter((a) => ids.has(a.id))
      .map((a) => {
        const m = held.get(a.id) ?? new Map<string, number>();
        let priced = true;
        let hv = 0;
        for (const [sym, sh] of m) {
          if (sh === 0) continue;
          const p = latest.get(sym);
          if (!p) priced = false;
          else hv += valueCents(sh, p.priceE4);
        }
        const hasHoldings = [...m.values()].some((x) => x !== 0);
        return {
          id: a.id,
          name: a.name,
          type: a.type,
          typeLabel: ACCOUNT_TYPES[a.type].label,
          recordedCents: series.at(-1)!.byAccount[a.id] ?? null,
          holdingsValueCents: hasHoldings && priced ? hv + cashCents(acts, a.id, t) : null,
          putInCents: moneyPutIn(acts, t, new Set([a.id])),
        };
      });

    return {
      accounts: invAccounts.map((a) => ({ id: a.id, name: a.name, typeLabel: ACCOUNT_TYPES[a.type].label })),
      selected: pick,
      totals: { valueCents: valueNow, putInCents: putIn, growthCents: valueNow - putIn, growthBp: growthBp(valueNow, putIn) },
      perAccount,
      holdings: holdingsRows.sort((x, y) => (y.valueCents ?? 0) - (x.valueCents ?? 0)),
      series: series.map((p) => {
        const s = states.get(p.date);
        return {
          date: p.date,
          valueCents: p.totalCents,
          putInCents: moneyPutIn(acts, p.date, ids),
          // How sure the fund prices behind this day's value are (lib/valuation.ts). null = no funds held.
          priceState: s?.state ?? null,
          staleDays: s?.staleDays ?? 0,
          estimated: s?.estimated ?? [],
          stale: s?.stale ?? [],
          missing: s?.missing ?? [],
        };
      }),
      activity: (
        db
          .prepare(
            `SELECT id, account_id, date, kind, symbol, quantity_micro, price_e4, amount_cents, tax_year FROM investment_activity
             ORDER BY date DESC, id DESC LIMIT 200`,
          )
          .all() as { id: number; account_id: number; date: string; kind: string; symbol: string; quantity_micro: number; price_e4: number | null; amount_cents: number; tax_year: number | null }[]
      )
        .filter((r) => ids.has(r.account_id))
        .slice(0, 50)
        .map((r) => ({
          id: r.id,
          accountId: r.account_id,
          date: r.date,
          kind: r.kind,
          symbol: r.symbol,
          quantityMicro: r.quantity_micro,
          priceE4: r.price_e4,
          amountCents: r.amount_cents,
          taxYear: r.tax_year,
        })),
    };
  });

  /** Save today's (or a given day's) fund prices typed in by hand. */
  app.put('/api/prices', async (req, reply) => {
    const b = pricesBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Enter a price for each fund.');
    const asOf = b.data.asOf ?? today();
    if (!isValidIsoDate(asOf) || asOf > today()) return bad(reply, 'Pick a valid date that is not in the future.');
    const parsed: { symbol: string; e4: number }[] = [];
    for (const p of b.data.prices) {
      try {
        const e4 = parsePriceToE4(p.price);
        if (e4 <= 0) return bad(reply, `The price for ${p.symbol} must be above zero.`);
        parsed.push({ symbol: p.symbol.toUpperCase(), e4 });
      } catch (e) {
        if (e instanceof DecimalParseError) return bad(reply, `"${p.price}" is not a valid price for ${p.symbol}.`);
        throw e;
      }
    }
    db.exec('BEGIN');
    try {
      // Typed prices are the lowest-ranked source: a price from a file for the same day still wins.
      for (const p of parsed) savePrice(db, { symbol: p.symbol, asOf, priceE4: p.e4, source: 'manual' }, now());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
    return { ok: true, saved: parsed.length };
  });

  /** Remove an emergency price edit; any price from a file for that day shows again. */
  app.delete('/api/prices/:symbol/:asOf', async (req, reply) => {
    const { symbol, asOf } = req.params as { symbol: string; asOf: string };
    if (!/^[A-Za-z0-9.]{1,12}$/.test(symbol) || !isValidIsoDate(asOf)) return bad(reply, 'Pick a price.');
    return deletePrice(db, symbol.toUpperCase(), asOf, 'manual') ? { ok: true } : reply.code(404).send({ error: 'No typed price for that day.' });
  });

  /** Use holdings x price (+ cash) as today's balance for one account. */
  app.post('/api/investments/:id/use-holdings-value', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const acct = getAccount(db, id);
    if (!acct || !acct.isInvestment) return reply.code(404).send({ error: 'Investment account not found.' });
    const t = today();
    const acts = loadActivity(db);
    const latest = latestPrices(loadPrices(db), t);
    const m = holdings(acts, t).get(id);
    if (!m) return bad(reply, 'This account has no holdings yet.');
    let total = cashCents(acts, id, t);
    for (const [sym, sh] of m) {
      if (sh === 0) continue;
      const p = latest.get(sym);
      if (!p) return bad(reply, `Enter a price for ${sym} first.`);
      total += valueCents(sh, p.priceE4);
    }
    upsertSnapshot(db, id, t, total, now(), { source: 'computed', note: 'Holdings x price' });
    return { ok: true, balanceCents: total };
  });

  /** Fix a share count by hand (adds a signed adjustment row; imported history is never edited). */
  app.post('/api/investments/shares', async (req, reply) => {
    const b = sharesBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Enter the number of shares.');
    const acct = getAccount(db, b.data.accountId);
    if (!acct || !acct.isInvestment) return bad(reply, 'Pick an investment account.');
    let target: number;
    try {
      target = parseSharesToMicro(b.data.shares);
    } catch {
      return bad(reply, 'Enter shares like 12.345.');
    }
    if (target < 0) return bad(reply, 'Shares cannot be negative.');
    const symbol = b.data.symbol.toUpperCase();
    const asOf = b.data.asOf ?? today();
    if (!isValidIsoDate(asOf) || asOf > today()) return bad(reply, 'Pick a valid date that is not in the future.');
    const current = holdings(loadActivity(db), asOf).get(acct.id)?.get(symbol) ?? 0;
    const delta = target - current;
    if (delta !== 0) {
      db.prepare('INSERT INTO securities (symbol) VALUES (?) ON CONFLICT (symbol) DO NOTHING').run(symbol);
      db.prepare(
        `INSERT INTO investment_activity (account_id, date, kind, symbol, quantity_micro, amount_cents, raw_action, source, created_at)
         VALUES (?, ?, 'other', ?, ?, 0, 'Manual share adjustment', 'manual', ?)`,
      ).run(acct.id, asOf, symbol, delta, now());
    }
    return { ok: true, sharesMicro: target, adjustedMicro: delta };
  });
}
