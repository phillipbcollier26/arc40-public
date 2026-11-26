/**
 * Display preferences: the theme, (V2 Phase 4) the Arc40 Wrapped sound, off by default, and (Trophies Round 2) the
 * trophy sound, on by default. Stored in a small JSON file NEXT TO the real database
 * (data/preferences.json), not inside arc40.db, so changing the theme while demo mode is on never
 * writes to real financial data. The same choice applies in real and demo mode and in every tab.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PREFERENCES_FILE = 'preferences.json';

/** 'system' = Match Mac (follows the macOS appearance setting). */
export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export interface Preferences {
  theme: Theme;
  /** Soft sounds for the Arc40 Wrapped intro and slide changes. Off unless turned on in Settings. */
  wrappedSound: boolean;
  /** Trophies Round 2: the soft chime when a trophy is earned. ON unless turned off (Settings or the pop-up's mute). */
  trophySound: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = { theme: 'dark', wrappedSound: false, trophySound: true };

export const isTheme = (v: unknown): v is Theme => typeof v === 'string' && (THEMES as readonly string[]).includes(v);

/** Pure: keeps only known, valid values; anything else falls back to the default. */
export function sanitizePreferences(raw: unknown): Preferences {
  const o = raw && typeof raw === 'object' ? (raw as { theme?: unknown; wrappedSound?: unknown; trophySound?: unknown }) : {};
  return {
    theme: isTheme(o.theme) ? o.theme : DEFAULT_PREFERENCES.theme,
    wrappedSound: o.wrappedSound === true,
    // Missing or damaged = the default (on); only an explicit false turns it off.
    trophySound: o.trophySound !== false,
  };
}

export function readPreferences(dir: string): Preferences {
  try {
    return sanitizePreferences(JSON.parse(fs.readFileSync(path.join(dir, PREFERENCES_FILE), 'utf8')));
  } catch {
    return { ...DEFAULT_PREFERENCES }; // missing or damaged file: use the defaults
  }
}

/** Writes atomically (temp file + rename), readable only by this Mac user. */
export function writePreferences(dir: string, prefs: Preferences): Preferences {
  const clean = sanitizePreferences(prefs);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, PREFERENCES_FILE);
  const tmp = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return clean;
}
