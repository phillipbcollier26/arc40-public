/**
 * Trophy states in the database (migration 015). No row = Off. Nothing is ever deleted: every change is also
 * written to trophy_log, and Take it back keeps the award there.
 */
import type { DB } from '../../db/database.js';
import type { IsoDate } from '../../../../shared/dates.js';
import type { TrophyMode, TrophyState } from '../../../../shared/trophies.js';
import type { Award, RecordEntry, Story } from './types.js';

export interface StoredAward {
  sentence: string;
  story: Story | null;
}

export interface StateRow {
  key: string;
  state: TrophyState;
  mode: TrophyMode;
  since: IsoDate;
  turnedOnAt: number;
  award: number;
  earnedOn: IsoDate | null;
  earnedAt: number | null;
  detail: StoredAward | null;
}

interface RawState {
  trophy_key: string;
  state: TrophyState;
  mode: TrophyMode;
  since: string;
  turned_on_at: number;
  award: number;
  earned_on: string | null;
  earned_at: number | null;
  detail: string | null;
}

function parseDetail(s: string | null): StoredAward | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as StoredAward;
  } catch {
    return null;
  }
}

export function loadStates(db: DB): Map<string, StateRow> {
  const rows = db.prepare('SELECT * FROM trophy_states').all() as unknown as RawState[];
  return new Map(
    rows.map((r) => [
      r.trophy_key,
      {
        key: r.trophy_key,
        state: r.state,
        mode: r.mode,
        since: r.since,
        turnedOnAt: r.turned_on_at,
        award: r.award,
        earnedOn: r.earned_on,
        earnedAt: r.earned_at,
        detail: parseDetail(r.detail),
      },
    ]),
  );
}

/** Records of each trophy's CURRENT award, oldest first. */
export function loadRecords(db: DB): Map<string, RecordEntry[]> {
  const rows = db
    .prepare(
      `SELECT r.trophy_key, r.period, r.amount_cents, r.set_on FROM trophy_records r
       JOIN trophy_states s ON s.trophy_key = r.trophy_key AND s.award = r.award AND s.state = 'earned'
       ORDER BY r.trophy_key, r.period`,
    )
    .all() as { trophy_key: string; period: string; amount_cents: number; set_on: string }[];
  const out = new Map<string, RecordEntry[]>();
  for (const r of rows) {
    const list = out.get(r.trophy_key) ?? [];
    list.push({ period: r.period, amountCents: r.amount_cents, setOn: r.set_on });
    out.set(r.trophy_key, list);
  }
  return out;
}

function log(db: DB, key: string, action: string, now: number, extra: { mode?: string; onDate?: string; detail?: unknown } = {}) {
  db.prepare('INSERT INTO trophy_log (trophy_key, action, mode, on_date, detail, at) VALUES (?, ?, ?, ?, ?, ?)').run(
    key,
    action,
    extra.mode ?? null,
    extra.onDate ?? null,
    extra.detail === undefined ? null : JSON.stringify(extra.detail),
    now,
  );
}

/** Off -> On (also used to start fresh). Earned trophies are not touched. Returns false if it was already on/earned. */
export function turnOn(db: DB, key: string, mode: TrophyMode, today: IsoDate, now: number, inherited = false): boolean {
  const cur = db.prepare('SELECT state FROM trophy_states WHERE trophy_key = ?').get(key) as { state: TrophyState } | undefined;
  if (cur && cur.state !== 'off') return false;
  db.prepare(
    `INSERT INTO trophy_states (trophy_key, state, mode, since, turned_on_at, updated_at) VALUES (?, 'on', ?, ?, ?, ?)
     ON CONFLICT (trophy_key) DO UPDATE SET state = 'on', mode = excluded.mode, since = excluded.since,
       turned_on_at = excluded.turned_on_at, earned_on = NULL, earned_at = NULL, detail = NULL, updated_at = excluded.updated_at`,
  ).run(key, mode, today, now, now);
  log(db, key, 'turn_on', now, { mode, onDate: today, detail: inherited ? { inherited: true } : undefined });
  return true;
}

/** On -> Off. */
export function turnOff(db: DB, key: string, now: number): boolean {
  const r = db.prepare(`UPDATE trophy_states SET state = 'off', updated_at = ? WHERE trophy_key = ? AND state = 'on'`).run(now, key);
  if (r.changes) log(db, key, 'turn_off', now);
  return r.changes > 0;
}

/** Earned -> Off (never back to On, so it is not awarded again on the next check). The log keeps the award. */
export function takeBack(db: DB, key: string, now: number): boolean {
  const cur = db.prepare(`SELECT earned_on, detail, award FROM trophy_states WHERE trophy_key = ? AND state = 'earned'`).get(key) as
    | { earned_on: string; detail: string | null; award: number }
    | undefined;
  if (!cur) return false;
  db.prepare(`UPDATE trophy_states SET state = 'off', earned_on = NULL, earned_at = NULL, detail = NULL, updated_at = ? WHERE trophy_key = ?`).run(now, key);
  log(db, key, 'take_back', now, { onDate: cur.earned_on, detail: { award: cur.award, ...(parseDetail(cur.detail) ?? {}) } });
  return true;
}

/** On -> Earned with its date, sentence, story and (plaques) records. */
export function saveAward(db: DB, key: string, award: Award, records: readonly RecordEntry[] | undefined, now: number): void {
  const detail: StoredAward = { sentence: award.sentence, story: award.story };
  db.prepare(
    `UPDATE trophy_states SET state = 'earned', award = award + 1, earned_on = ?, earned_at = ?, detail = ?, updated_at = ?
     WHERE trophy_key = ? AND state = 'on'`,
  ).run(award.date, now, JSON.stringify(detail), now, key);
  const { award: n } = db.prepare('SELECT award FROM trophy_states WHERE trophy_key = ?').get(key) as { award: number };
  log(db, key, 'earned', now, { onDate: award.date, detail: { award: n, sentence: award.sentence } });
  if (records?.length) addRecords(db, key, n, records, now, false);
}

export function addRecords(db: DB, key: string, award: number, records: readonly RecordEntry[], now: number, logIt = true): void {
  const ins = db.prepare('INSERT OR IGNORE INTO trophy_records (trophy_key, award, period, amount_cents, set_on) VALUES (?, ?, ?, ?, ?)');
  for (const r of records) {
    if (ins.run(key, award, r.period, r.amountCents, r.setOn).changes && logIt) log(db, key, 'record', now, { onDate: r.setOn, detail: r });
  }
}

/** Earned trophies whose current award has not had its unlock pop-up yet (Round 2, migration 016). */
export function pendingCelebrations(db: DB): Map<string, number> {
  const rows = db
    .prepare("SELECT trophy_key, award FROM trophy_states WHERE state = 'earned' AND award > celebrated_award")
    .all() as { trophy_key: string; award: number }[];
  return new Map(rows.map((r) => [r.trophy_key, r.award]));
}

/**
 * Claims awards for a pop-up, each in ONE conditional UPDATE: only an award that is still earned, still the same award
 * and not celebrated yet is claimed. Returns the keys this call claimed (another tab may have claimed some first).
 */
export function claimCelebrations(db: DB, items: readonly { key: string; award: number }[]): string[] {
  const upd = db.prepare(
    "UPDATE trophy_states SET celebrated_award = ? WHERE trophy_key = ? AND state = 'earned' AND award = ? AND celebrated_award < ?",
  );
  return items.filter((i) => upd.run(i.award, i.key, i.award, i.award).changes > 0).map((i) => i.key);
}
