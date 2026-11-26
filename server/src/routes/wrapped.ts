/**
 * V2 Phase 4 Arc40 Wrapped. Both routes only READ; there is no export, save or share route on purpose.
 *   GET /api/wrapped/years          years with data, newest first ({ year, soFar })
 *   GET /api/wrapped?year=YYYY      the slides for that year (see lib/wrapped.ts)
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { MIN_YEAR, WrappedError, wrappedYear, wrappedYears } from '../lib/wrapped.js';

const query = z.object({ year: z.string().regex(/^\d{4}$/) }).strict();

export function registerWrappedRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  app.get('/api/wrapped/years', async () => {
    const today = toIsoDate(now());
    return { today, years: wrappedYears(db, today) };
  });

  app.get('/api/wrapped', async (req, reply) => {
    const q = query.safeParse(req.query);
    const year = q.success ? Number(q.data.year) : NaN;
    if (!q.success || year < MIN_YEAR || year > 2200) return reply.code(400).send({ error: 'Pick a year from the list.' });
    try {
      return wrappedYear(db, year, toIsoDate(now()));
    } catch (e) {
      if (e instanceof WrappedError) return reply.code(404).send({ error: e.message });
      throw e;
    }
  });
}
