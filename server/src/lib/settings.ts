import type { DB } from '../db/database.js';
import type { BirthMonth } from '../../../shared/projection.js';

/**
 * Every setting with its default. Add new settings here so they stay typed.
 * Values are stored JSON-encoded in the `settings` table.
 */
export const SETTING_DEFAULTS = {
  /** Minutes of inactivity before Arc40 logs you out. */
  session_idle_minutes: 60 as number,
  /** Months of past income averaged for the budget baseline (3, 6 or 12). */
  income_avg_months: 3 as number,
  /** Optional tax set-aside estimate for refereeing pay, in basis points (2500 = 25%). 0 = off. */
  tax_set_aside_bp: 0 as number,
  /** Apply the set-aside to refereeing pay minus Ref Gear & Fees (true) or to the full pay (false). */
  tax_set_aside_on_net: true as boolean,
  /**
   * IRA contribution limit (under age 50) and contribution deadline per tax year.
   * 2026: $7,500, deadline April 15, 2027. Source: IRS newsroom, "401(k) limit increases to
   * $24,500 for 2026, IRA limit increases to $7,500" (irs.gov). Editable on the Goals page.
   * Add new years only from irs.gov, never guessed.
   */
  ira_limits: { '2026': { limitCents: 750_000, deadline: '2027-04-15' } } as Record<string, { limitCents: number; deadline: string | null }>,
  /** Optional: what housing + food etc. would cost per month if the user paid them themselves. */
  emergency_essentials_cents: 0 as number,
  /**
   * V2 Phase 3 planning. Expected yearly investment return AFTER inflation, in basis points
   * (700 = 7%). Every projection is in today's dollars because of this. Editable in Settings.
   */
  planning_return_bp: 700 as number,
  /** Birth month and year (no day), for "at age 40 / 65". Personal: lives only in this database. */
  birth_month: null as BirthMonth | null,
  /** Show "This $50 could be $221 at age 40" on expenses (Transactions hover + edit window). Default off. */
  future_you_line: false as boolean,
  /** Work cost: pay per refereeing game before taxes (null = not set yet). Personal. */
  ref_pay_per_game_cents: null as number | null,
  /** Work cost: 'off' (default), 'ref' or 'job:<id>' (lib/workCost.ts). */
  work_cost_selection: 'off' as string,
  /** Trophies Round 4: the day Arc40 started keeping the activity log (lib/activityLog.ts). Set once, never moved. */
  activity_log_since: null as string | null,
};

export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

export function getSetting<K extends SettingKey>(db: DB, key: K): Settings[K] {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row ? (JSON.parse(row.value) as Settings[K]) : SETTING_DEFAULTS[key];
}

export function setSetting<K extends SettingKey>(db: DB, key: K, value: Settings[K]): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}
