/**
 * Trophy Case (Trophies Round 1).
 *   GET  /api/trophies                       READ-ONLY: counts, shelves, every trophy with state and progress
 *   GET  /api/trophies/:key                  READ-ONLY: one trophy for the close-up (story, next rung)
 *   POST /api/trophies/evaluate              checks On trophies, saves new awards -> { earned }
 *   POST /api/trophies/:key/on               { mode: 'history' | 'today' } -> { earned }
 *   POST /api/trophies/:key/off              On -> Off
 *   POST /api/trophies/:key/take-back        Earned -> Off (never re-awarded until turned on again)
 *   POST /api/trophies/groups/:group/on      every Off trophy in the group, each with its suggested mode
 *                                            -> { turnedOn, earned }
 *   Round 2, the unlock pop-up:
 *   GET  /api/trophies/unseen                READ-ONLY: awards still waiting for their pop-up, in pop-up order
 *   POST /api/trophies/celebrate             { items: [{ key, award }] } claims them (each award shown exactly once,
 *                                            across reloads and tabs) -> { claimed: [keys] }
 *   GET  /api/trophies/shelf                 READ-ONLY: the Dashboard card (counts, 5 most recently awarded, closest)
 *   GET  /api/trophies/demo-unlock           DEMO ONLY, READ-ONLY ("Play an unlock"): 3 demo trophies; refused in real
 *                                            mode (lib/demoPolicy.ts); awards nothing, marks nothing
 * Allowed in demo mode: they only touch the active (demo) database.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { DB } from '../db/database.js';
import { toIsoDate } from '../../../shared/dates.js';
import { TROPHY_GROUPS, type TrophyGroup } from '../../../shared/trophies.js';
import type { TrophyEnv } from '../lib/trophies/data.js';
import {
  TrophyError,
  celebrate,
  demoUnlockTrophies,
  evaluateTrophies,
  takeBackTrophy,
  trophyDetail,
  trophyShelf,
  trophyViews,
  turnOffTrophy,
  turnOnGroup,
  turnOnTrophy,
  unseenTrophies,
} from '../lib/trophies/engine.js';

const onBody = z.object({ mode: z.enum(['history', 'today']) }).strict();
const keyParam = z.object({ key: z.string().min(1).max(80) });
const celebrateBody = z
  .object({ items: z.array(z.object({ key: z.string().min(1).max(80), award: z.number().int().min(1).max(1_000_000) }).strict()).min(1).max(500) })
  .strict();

export function registerTrophyRoutes(app: FastifyInstance, db: DB, now: () => number, envOf: () => TrophyEnv = () => ({})): void {
  const today = () => toIsoDate(now());
  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof TrophyError) return reply.code(e.message.includes('does not exist') ? 404 : 400).send({ error: e.message });
    throw e;
  };
  const keyOf = (req: { params: unknown }) => keyParam.safeParse(req.params);

  app.get('/api/trophies', async () => trophyViews(db, today(), envOf()));

  // Static paths are matched before /api/trophies/:key.
  app.get('/api/trophies/unseen', async () => ({ trophies: unseenTrophies(db, today(), envOf()) }));

  app.post('/api/trophies/celebrate', async (req, reply) => {
    const b = celebrateBody.safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'Send the trophies that were shown.' });
    return { claimed: celebrate(db, b.data.items) };
  });

  app.get('/api/trophies/shelf', async () => trophyShelf(db, today(), envOf()));

  app.get('/api/trophies/demo-unlock', async () => ({ trophies: demoUnlockTrophies(db, today()) }));

  app.get('/api/trophies/:key', async (req, reply) => {
    const p = keyOf(req);
    const d = p.success ? trophyDetail(db, today(), p.data.key, envOf()) : null;
    if (!d) return reply.code(404).send({ error: 'That trophy does not exist.' });
    return d;
  });

  app.post('/api/trophies/evaluate', async () => ({ earned: evaluateTrophies(db, today(), now(), undefined, envOf()) }));

  app.post('/api/trophies/:key/on', async (req, reply) => {
    const p = keyOf(req);
    const b = onBody.safeParse(req.body);
    if (!p.success) return reply.code(404).send({ error: 'That trophy does not exist.' });
    if (!b.success) return reply.code(400).send({ error: 'Pick Count my history or Start from today.' });
    try {
      return { earned: turnOnTrophy(db, p.data.key, b.data.mode, today(), now(), envOf()) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/trophies/:key/off', async (req, reply) => {
    const p = keyOf(req);
    if (!p.success) return reply.code(404).send({ error: 'That trophy does not exist.' });
    try {
      turnOffTrophy(db, p.data.key, today(), now());
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/trophies/:key/take-back', async (req, reply) => {
    const p = keyOf(req);
    if (!p.success) return reply.code(404).send({ error: 'That trophy does not exist.' });
    try {
      takeBackTrophy(db, p.data.key, today(), now());
      return { ok: true };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.post('/api/trophies/groups/:group/on', async (req, reply) => {
    const group = (req.params as { group: string }).group;
    if (!TROPHY_GROUPS.some((g) => g.id === group)) return reply.code(404).send({ error: 'That shelf does not exist.' });
    return turnOnGroup(db, group as TrophyGroup, today(), now(), envOf());
  });
}
