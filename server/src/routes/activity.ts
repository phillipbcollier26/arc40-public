/**
 * The activity log (Trophies Round 4, lib/activityLog.ts). Wrapped itself stays read-only (routes/wrapped.ts has only
 * GET routes); the player tells Arc40 here when a year was watched to its last slide, so the Wrapped watched trophies
 * can count it.
 *   POST /api/activity/wrapped-watched   { year } -> { ok: true }. Stores the year and today's date, nothing else.
 * Allowed in demo mode: it writes to the active (demo) database only.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { logWrappedWatched } from '../lib/activityLog.js';
import { wrappedYears } from '../lib/wrapped.js';

const body = z.object({ year: z.number().int().min(2000).max(2200) }).strict();

export function registerActivityRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  app.post('/api/activity/wrapped-watched', async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Pick a year from the list.' });
    if (!wrappedYears(db, toIsoDate(now())).some((y) => y.year === b.data.year))
      return reply.code(400).send({ error: 'Arc40 Wrapped has no slides for that year.' });
    logWrappedWatched(db, b.data.year, now());
    return { ok: true };
  });
}
