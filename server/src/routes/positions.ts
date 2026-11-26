import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { CsvError, CSV_LIMITS } from '../lib/csv.js';
import { analyzePositions, commitPositions, PositionsError, samplePositionsFile } from '../lib/positionsImport.js';

const mapping = z
  .array(z.object({ name: z.string().trim().min(1).max(80), accountId: z.number().int().positive().nullable() }))
  .max(20)
  .default([]);
const previewBody = z.object({
  filename: z.string().max(200).default('positions.csv'),
  text: z.string().max(CSV_LIMITS.maxBytes),
  priceDate: z.string().max(10).optional(),
  mapping,
});
const commitBody = previewBody.extend({ priceDate: z.string().max(10) });
const sampleBody = z.object({ priceDate: z.string().max(10).optional(), mapping });
const sampleCommitBody = sampleBody.extend({ priceDate: z.string().max(10) });

/**
 * Fidelity positions file -> fund prices for a day, with share counts compared (lib/positionsImport.ts).
 * The sample routes are for demo mode only (lib/demoPolicy.ts): they use a fake file Arc40 builds itself.
 */
export function registerPositionRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bodyLimit = CSV_LIMITS.maxBytes * 2 + 64 * 1024;
  const today = () => toIsoDate(now());
  const run = <T>(reply: FastifyReply, fn: () => T) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CsvError || e instanceof PositionsError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  };
  const badBody = (reply: FastifyReply) => reply.code(400).send({ error: 'Choose a Fidelity positions file.' });

  app.post('/api/investments/positions/preview', { bodyLimit }, async (req, reply) => {
    const b = previewBody.safeParse(req.body);
    if (!b.success) return badBody(reply);
    return run(reply, () => analyzePositions(db, b.data, today()));
  });

  app.post('/api/investments/positions/commit', { bodyLimit }, async (req, reply) => {
    const b = commitBody.safeParse(req.body);
    if (!b.success) return badBody(reply);
    return run(reply, () => commitPositions(db, b.data, today(), now()));
  });

  app.post('/api/investments/positions/sample-preview', async (req, reply) => {
    const b = sampleBody.safeParse(req.body ?? {});
    if (!b.success) return badBody(reply);
    return run(reply, () => ({ ...analyzePositions(db, { ...b.data, text: samplePositionsFile(db, today()) }, today()), sample: true }));
  });

  app.post('/api/investments/positions/sample-commit', async (req, reply) => {
    const b = sampleCommitBody.safeParse(req.body);
    if (!b.success) return badBody(reply);
    return run(reply, () => commitPositions(db, { ...b.data, text: samplePositionsFile(db, today()) }, today(), now()));
  });
}
