/**
 * Work cost (V2 Phase 3), database side: jobs (migration 012) and the two settings. The math is in
 * shared/workCost.ts. Personal data: it lives only in the active database, so demo mode has its own.
 */
import type { DB } from '../db/database.js';
import { getSetting, setSetting } from './settings.js';
import { activeRate, type WorkJob, type WorkRate } from '../../../shared/workCost.js';

export * from '../../../shared/workCost.js';

interface JobRow {
  id: number;
  title: string;
  pay_kind: 'hourly' | 'salary';
  pay_cents: number;
}

export function listJobs(db: DB): WorkJob[] {
  return (db.prepare('SELECT id, title, pay_kind, pay_cents FROM work_jobs ORDER BY sort_order, id').all() as unknown as JobRow[]).map((r) => ({
    id: r.id,
    title: r.title,
    payKind: r.pay_kind,
    payCents: r.pay_cents,
  }));
}

export function addJob(db: DB, job: Omit<WorkJob, 'id'>, now: number): WorkJob {
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM work_jobs').get() as { n: number }).n;
  const r = db
    .prepare('INSERT INTO work_jobs (title, pay_kind, pay_cents, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(job.title, job.payKind, job.payCents, order, now, now);
  return { id: Number(r.lastInsertRowid), ...job };
}

export function updateJob(db: DB, id: number, job: Omit<WorkJob, 'id'>, now: number): boolean {
  return db.prepare('UPDATE work_jobs SET title = ?, pay_kind = ?, pay_cents = ?, updated_at = ? WHERE id = ?').run(job.title, job.payKind, job.payCents, now, id).changes > 0;
}

/** Deletes a job. If it was the picked pay, work cost goes back to Off (never to another job). */
export function deleteJob(db: DB, id: number): boolean {
  const gone = db.prepare('DELETE FROM work_jobs WHERE id = ?').run(id).changes > 0;
  if (gone && getSetting(db, 'work_cost_selection') === `job:${id}`) setSetting(db, 'work_cost_selection', 'off');
  return gone;
}

export interface WorkCostState {
  refPayPerGameCents: number | null;
  jobs: WorkJob[];
  selection: string;
  /** The rate every screen uses, or null = work cost is off (shown nowhere). */
  active: WorkRate | null;
}

export function workCostState(db: DB): WorkCostState {
  const refPayPerGameCents = getSetting(db, 'ref_pay_per_game_cents');
  const jobs = listJobs(db);
  const selection = getSetting(db, 'work_cost_selection');
  return { refPayPerGameCents, jobs, selection, active: activeRate(selection, refPayPerGameCents, jobs) };
}
