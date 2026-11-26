/**
 * Work cost (V2 Phase 3): pay per game, other jobs and which pay every screen converts spending into.
 *   GET    /api/work-cost          { refPayPerGameCents, jobs, selection, active }
 *   PUT    /api/work-cost          { refPayPerGame?: TEXT | null, selection?: 'off' | 'ref' | 'job:<id>' }
 *   POST   /api/work-jobs          { title, payKind: 'hourly' | 'salary', pay: TEXT }
 *   PATCH  /api/work-jobs/:id      same body
 *   DELETE /api/work-jobs/:id      (if it was picked, work cost goes back to Off)
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { MoneyParseError, parseMoneyToCents } from '../lib/money.js';
import { setSetting } from '../lib/settings.js';
import {
  MAX_GAME_CENTS,
  MAX_HOURLY_CENTS,
  MAX_JOBS,
  MAX_SALARY_CENTS,
  MAX_TITLE,
  addJob,
  deleteJob,
  listJobs,
  updateJob,
  workCostState,
} from '../lib/workCost.js';

const money = z.string().trim().min(1).max(20);
const jobBody = z
  .object({
    title: z.string().trim().min(1, 'Type a job title.').max(MAX_TITLE, `Keep the title to ${MAX_TITLE} characters or fewer.`),
    payKind: z.enum(['hourly', 'salary']),
    pay: money,
  })
  .strict();
const settingsBody = z
  .object({
    refPayPerGame: money.nullable().optional(),
    selection: z
      .string()
      .regex(/^(off|ref|job:\d{1,9})$/)
      .optional(),
  })
  .strict();

/** Positive whole cents from text, within a cap; else a plain-language error. */
function parsePay(text: string, max: number, what: string): number | string {
  let cents: number;
  try {
    cents = parseMoneyToCents(text);
  } catch (e) {
    if (e instanceof MoneyParseError) return 'Enter an amount like 45 or 16.50.';
    throw e;
  }
  if (cents <= 0) return `Enter ${what} above $0.`;
  if (cents > max) return `That is more than Arc40 allows for ${what}.`;
  return cents;
}

export function registerWorkCostRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });

  app.get('/api/work-cost', async () => workCostState(db));

  app.put('/api/work-cost', async (req, reply) => {
    const b = settingsBody.safeParse(req.body);
    if (!b.success) return bad(reply, 'Pick Off, Refereeing games or one of your jobs.');
    if (b.data.refPayPerGame !== undefined) {
      if (b.data.refPayPerGame === null) {
        setSetting(db, 'ref_pay_per_game_cents', null);
      } else {
        const cents = parsePay(b.data.refPayPerGame, MAX_GAME_CENTS, 'pay per game');
        if (typeof cents === 'string') return bad(reply, cents);
        setSetting(db, 'ref_pay_per_game_cents', cents);
      }
    }
    if (b.data.selection !== undefined) {
      const sel = b.data.selection;
      const state = workCostState(db);
      if (sel === 'ref' && !state.refPayPerGameCents) return bad(reply, 'Set your pay per game first.');
      if (sel.startsWith('job:') && !state.jobs.some((j) => `job:${j.id}` === sel)) return bad(reply, 'That job no longer exists.');
      setSetting(db, 'work_cost_selection', sel);
    }
    // Clearing the pay per game while games are picked turns work cost off (never silently another pay).
    const after = workCostState(db);
    if (after.selection === 'ref' && !after.refPayPerGameCents) setSetting(db, 'work_cost_selection', 'off');
    return workCostState(db);
  });

  const parseJob = (body: unknown): { title: string; payKind: 'hourly' | 'salary'; payCents: number } | string => {
    const b = jobBody.safeParse(body);
    if (!b.success) {
      const issue = b.error.issues[0];
      return issue?.path[0] === 'title' ? issue.message : 'Add a title, hourly or yearly, and the pay.';
    }
    const cents = b.data.payKind === 'hourly' ? parsePay(b.data.pay, MAX_HOURLY_CENTS, 'hourly pay') : parsePay(b.data.pay, MAX_SALARY_CENTS, 'a yearly salary');
    if (typeof cents === 'string') return cents;
    return { title: b.data.title, payKind: b.data.payKind, payCents: cents };
  };

  app.post('/api/work-jobs', async (req, reply) => {
    const job = parseJob(req.body);
    if (typeof job === 'string') return bad(reply, job);
    if (listJobs(db).length >= MAX_JOBS) return bad(reply, `Arc40 keeps up to ${MAX_JOBS} jobs.`);
    return reply.code(201).send({ job: addJob(db, job, now()) });
  });

  app.patch('/api/work-jobs/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0) return bad(reply, 'Job not found.');
    const job = parseJob(req.body);
    if (typeof job === 'string') return bad(reply, job);
    if (!updateJob(db, id, job, now())) return reply.code(404).send({ error: 'Job not found.' });
    return workCostState(db);
  });

  app.delete('/api/work-jobs/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    if (!Number.isInteger(id) || id <= 0 || !deleteJob(db, id)) return reply.code(404).send({ error: 'Job not found.' });
    return workCostState(db);
  });
}
