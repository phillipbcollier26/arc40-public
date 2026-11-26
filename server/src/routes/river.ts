/**
 * V2 Phase 4 money river.
 *   GET /api/river?range=month|3m|ytd|12m   read-only; see lib/river.ts for the rules
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { RIVER_RANGES } from '../lib/river.js';
import { moneyRiver } from '../lib/moneyRiver.js';

const query = z.object({ range: z.enum(RIVER_RANGES).default('month') }).strict();

export function registerRiverRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  app.get('/api/river', async (req, reply) => {
    const q = query.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: 'Pick this month, last 3 months, year to date or last 12 months.' });
    return moneyRiver(db, q.data.range, toIsoDate(now()));
  });
}
