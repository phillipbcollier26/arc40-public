/**
 * V2 Phase 3 planning settings + the current-path baseline.
 *   GET/PUT /api/settings/planning  return rate (after inflation) and birth month/year
 *   GET     /api/planning/baseline  the current path's starting numbers (read-only)
 * Both settings live in the active database only (so demo mode has its own fake ones).
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { DecimalParseError, parseScaled } from '../../../shared/decimal.js';
import { getSetting, SETTING_DEFAULTS, setSetting } from '../lib/settings.js';
import { ageOn } from '../lib/projection.js';
import { BASELINE_MONTHS, buildBaseline, type BaselineMonths } from '../lib/planning.js';

/** Allowed range for the yearly return after inflation: 0% to 15%. */
export const RETURN_MIN_BP = 0;
export const RETURN_MAX_BP = 1_500;

const body = z
  .object({
    returnRate: z.string().max(12).optional(),
    birth: z
      .object({ year: z.number().int().min(1900).max(2200), month: z.number().int().min(1).max(12) })
      .strict()
      .nullable()
      .optional(),
    futureYouLine: z.boolean().optional(),
  })
  .strict();

/** "7", "6.5" or "7%" -> basis points. Throws a plain-language message. */
export function parseReturnRate(text: string): number {
  let bp: number;
  try {
    bp = parseScaled(text.trim().replace(/%$/, '').trim(), 2, 'percent');
  } catch (e) {
    if (e instanceof DecimalParseError) throw new Error('Enter a percent like 7 or 6.5.');
    throw e;
  }
  if (bp < RETURN_MIN_BP || bp > RETURN_MAX_BP) throw new Error('Pick a yearly return between 0% and 15%.');
  return bp;
}

export function registerPlanningRoutes(app: FastifyInstance, db: DB, now: () => number): void {
  const bad = (reply: FastifyReply, error: string) => reply.code(400).send({ error });
  const today = () => toIsoDate(now());

  const view = () => {
    const birth = getSetting(db, 'birth_month');
    return {
      returnRateBp: getSetting(db, 'planning_return_bp'),
      defaultReturnRateBp: SETTING_DEFAULTS.planning_return_bp,
      birth,
      age: birth ? ageOn(birth, today()) : null,
      futureYouLine: getSetting(db, 'future_you_line'),
      /** The server's today, so the browser's future-you math uses the same clock as everything else. */
      today: today(),
    };
  };

  app.get('/api/settings/planning', async () => view());

  app.put('/api/settings/planning', async (req, reply) => {
    const b = body.safeParse(req.body);
    if (!b.success) return bad(reply, 'Pick a birth month and year, and a return like 7.');
    if (b.data.returnRate !== undefined) {
      try {
        setSetting(db, 'planning_return_bp', parseReturnRate(b.data.returnRate));
      } catch (e) {
        return bad(reply, (e as Error).message);
      }
    }
    if (b.data.birth !== undefined) {
      const birth = b.data.birth;
      if (birth) {
        const t = today();
        const thisMonth = Number(t.slice(0, 4)) * 12 + Number(t.slice(5, 7));
        if (birth.year * 12 + birth.month > thisMonth) return bad(reply, 'That month is in the future.');
        if (ageOn(birth, t) > 120) return bad(reply, 'Pick a birth year after ' + (Number(t.slice(0, 4)) - 121) + '.');
      }
      setSetting(db, 'birth_month', birth);
    }
    if (b.data.futureYouLine !== undefined) setSetting(db, 'future_you_line', b.data.futureYouLine);
    return view();
  });

  app.get('/api/planning/baseline', async (req, reply) => {
    const m = Number((req.query as { months?: string }).months ?? getSetting(db, 'income_avg_months'));
    if (!BASELINE_MONTHS.includes(m as BaselineMonths)) return bad(reply, 'Average over 3, 6 or 12 months.');
    const b = buildBaseline(db, today(), m as BaselineMonths);
    return { ...b, returnRateBp: getSetting(db, 'planning_return_bp') };
  });
}
