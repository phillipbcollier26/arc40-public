import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { CsvError, CSV_LIMITS } from '../lib/csv.js';
import { analyzePriceHistory, commitPriceHistory, deletePriceHistory, PriceHistoryError, samplePriceHistory } from '../lib/priceHistoryImport.js';

/** A fund symbol as Arc40 stores it. The fund is ALWAYS named by the request, never read from the file. */
const symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9.]{1,12}$/, 'Pick a fund.');
const columns = z.object({ dateColumn: z.string().trim().min(1).max(100), priceColumn: z.string().trim().min(1).max(100) }).optional();
const fileBody = z.object({ symbol, filename: z.string().max(200).default('history.csv'), text: z.string().max(CSV_LIMITS.maxBytes), columns });
const sampleBody = z.object({ symbol, columns });

/** Daily price history per fund (lib/priceHistory.ts + lib/priceHistoryImport.ts). Sample routes: demo mode only. */
export function registerPriceHistoryRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bodyLimit = CSV_LIMITS.maxBytes * 2 + 64 * 1024;
  const today = () => toIsoDate(now());
  const run = <T>(reply: FastifyReply, fn: () => T) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CsvError || e instanceof PriceHistoryError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  };
  const bad = (reply: FastifyReply, issues?: { path: PropertyKey[] }[]) =>
    reply.code(400).send({ error: issues?.some((i) => i.path[0] === 'symbol' || i.path.length === 0) ? 'Pick a fund.' : 'Choose a price history file.' });

  app.post('/api/investments/price-history/preview', { bodyLimit }, async (req, reply) => {
    const b = fileBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues);
    return run(reply, () => analyzePriceHistory(db, b.data, today()));
  });

  app.post('/api/investments/price-history/commit', { bodyLimit }, async (req, reply) => {
    const b = fileBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues);
    return run(reply, () => commitPriceHistory(db, b.data, today(), now()));
  });

  app.delete('/api/investments/price-history/:symbol', async (req, reply) => {
    const s = symbol.safeParse((req.params as { symbol: string }).symbol);
    if (!s.success) return bad(reply, s.error.issues);
    return { removed: deletePriceHistory(db, s.data) };
  });

  app.post('/api/investments/price-history/sample-preview', async (req, reply) => {
    const b = sampleBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues);
    return run(reply, () => ({ ...analyzePriceHistory(db, { ...b.data, text: samplePriceHistory(db, b.data.symbol, today()) }, today()), sample: true }));
  });

  app.post('/api/investments/price-history/sample-commit', async (req, reply) => {
    const b = sampleBody.safeParse(req.body);
    if (!b.success) return bad(reply, b.error.issues);
    return run(reply, () => commitPriceHistory(db, { ...b.data, text: samplePriceHistory(db, b.data.symbol, today()) }, today(), now()));
  });
}
