import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { CsvError, CSV_LIMITS } from '../lib/csv.js';
import { analyzeImport, commitImport, ImportError, listImportBatches, undoImport, type Analysis } from '../lib/importer.js';
import type { GenericMapping } from '../lib/importMapping.js';
import { TREAT_AS } from '../lib/fidelity.js';
import { listActionAnswers, saveActionAnswer } from '../lib/fidelityActions.js';

const actionBody = z.object({
  action: z.string().trim().min(1).max(300),
  treatAs: z.enum(TREAT_AS),
});

const col = z.string().max(100);
const mappingSchema = z.object({
  headerRow: z.number().int().min(0).max(200),
  dateColumn: col,
  dateFormat: z.enum(['MDY', 'YMD', 'DMY']),
  descriptionColumns: z.array(col).min(1).max(5),
  amountMode: z.enum(['single', 'debitCredit', 'indicator']),
  amountColumn: col.optional(),
  invertAmount: z.boolean().optional(),
  debitColumn: col.optional(),
  creditColumn: col.optional(),
  indicatorColumn: col.optional(),
  creditWord: z.string().max(30).optional(),
  balanceColumn: col.optional(),
});

const body = z.object({
  accountId: z.number().int().positive(),
  filename: z.string().max(200).default('import.csv'),
  text: z.string().max(CSV_LIMITS.maxBytes),
  mapping: mappingSchema.optional(),
});

/** Strips internal fields; caps preview rows so the page stays fast with years of history. */
function publicAnalysis(a: Analysis) {
  const { _generic, _fidelity, ...rest } = a;
  void _generic;
  void _fidelity;
  return { ...rest, rows: rest.rows.slice(0, 500), rowsTruncated: rest.rows.length > 500 };
}

export function registerImportRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bodyLimit = CSV_LIMITS.maxBytes * 2 + 64 * 1024; // JSON escaping can grow text a bit

  const run = <T>(fn: () => T, reply: import('fastify').FastifyReply) => {
    try {
      return fn();
    } catch (e) {
      if (e instanceof CsvError || e instanceof ImportError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  };

  app.post('/api/import/preview', { bodyLimit }, async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Choose an account and a CSV file.' });
    return run(() => publicAnalysis(analyzeImport(db, { ...b.data, mapping: b.data.mapping as GenericMapping | undefined })), reply);
  });

  app.post('/api/import/commit', { bodyLimit }, async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Choose an account and a CSV file.' });
    return run(() => commitImport(db, { ...b.data, mapping: b.data.mapping as GenericMapping | undefined }, now()), reply);
  });

  app.get('/api/import/batches', async (req) => {
    const accountId = Number((req.query as { accountId?: string }).accountId) || undefined;
    return { batches: listImportBatches(db, accountId) };
  });

  app.delete('/api/import/batches/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isSafeInteger(id) || !undoImport(db, id)) return reply.code(404).send({ error: 'Import not found.' });
    return { ok: true };
  });

  /** Answers for Fidelity actions Arc40 does not recognize (see lib/fidelityActions.ts). */
  app.get('/api/import/fidelity-actions', async () => ({ answers: listActionAnswers(db) }));

  app.put('/api/import/fidelity-actions', async (req, reply) => {
    const b = actionBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Pick what this Fidelity action means.' });
    return saveActionAnswer(db, b.data.action, b.data.treatAs, now());
  });
}
