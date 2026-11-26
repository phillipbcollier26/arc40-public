/**
 * Pure rules for which requests are refused in each mode. Checked on the SERVER for every logged-in
 * request (auth/guard.ts), so hiding a button in the UI is never the only protection.
 */
export type Mode = 'real' | 'demo';

export const IMPORT_OFF_IN_DEMO =
  'Import is turned off in demo mode so real bank files never end up in demo data.';
export const BACKUP_OFF_IN_DEMO =
  'Back up now is turned off in demo mode, so demo data never ends up in your backups folder.';
export const REAL_MODE_ONLY = 'Change this in real mode. Leave demo mode first (Settings or the sidebar).';

/** "METHOD /route/pattern" -> message, for requests refused while demo mode is on. */
const BLOCKED_IN_DEMO: Record<string, string> = {
  'POST /api/import/preview': IMPORT_OFF_IN_DEMO,
  'POST /api/import/commit': IMPORT_OFF_IN_DEMO,
  'POST /api/investments/positions/preview': IMPORT_OFF_IN_DEMO,
  'POST /api/investments/positions/commit': IMPORT_OFF_IN_DEMO,
  'POST /api/investments/price-history/preview': IMPORT_OFF_IN_DEMO,
  'POST /api/investments/price-history/commit': IMPORT_OFF_IN_DEMO,
  'POST /api/backups': BACKUP_OFF_IN_DEMO,
  'POST /api/auth/setup': REAL_MODE_ONLY,
  'POST /api/auth/change-password': REAL_MODE_ONLY,
  'PUT /api/settings/session': REAL_MODE_ONLY,
  'POST /api/demo/enter': 'Demo mode is already on.',
};

/** Requests refused while in real mode. */
const BLOCKED_IN_REAL: Record<string, string> = {
  'POST /api/demo/reset': 'Reset only works in demo mode.',
  'POST /api/demo/exit': 'Demo mode is already off.',
  // The built-in FAKE sample file must never write into real data.
  'POST /api/investments/positions/sample-preview': 'The sample file only works in demo mode.',
  'POST /api/investments/positions/sample-commit': 'The sample file only works in demo mode.',
  'POST /api/investments/price-history/sample-preview': 'The sample file only works in demo mode.',
  'POST /api/investments/price-history/sample-commit': 'The sample file only works in demo mode.',
  // Trophies Round 2: "Play an unlock" replays demo trophies; it does not exist in real mode.
  'GET /api/trophies/demo-unlock': 'Play an unlock only works in demo mode.',
};

/** Returns the plain-language reason a request is refused in `mode`, or null if it is allowed. */
export function demoBlockReason(mode: Mode, method: string, route: string): string | null {
  const key = `${method.toUpperCase()} ${route}`;
  return (mode === 'demo' ? BLOCKED_IN_DEMO[key] : BLOCKED_IN_REAL[key]) ?? null;
}

/** Export file name: demo exports are clearly labeled so they are never mistaken for real data. */
export function exportFilename(base: string, mode: Mode): string {
  return mode === 'demo' ? base.replace(/^arc40-/, 'arc40-demo-') : base;
}
