/**
 * The ONE way the page talks to the server. Adds the CSRF token to every
 * change, and tells the app to show the login screen if the session expired.
 */
let csrfToken: string | null = null;
let onAuthLost: () => void = () => {};

export type Mode = 'real' | 'demo';
/** The mode this tab is showing. Set from /api/auth/status. */
let tabMode: Mode | null = null;
let onModeChanged: () => void = () => window.location.reload();

export function setTabMode(mode: Mode | null) {
  tabMode = mode;
}
export function setOnModeChanged(fn: () => void) {
  onModeChanged = fn;
}

/**
 * Set once a switch between real and demo data has succeeded and this tab is about to reload. From then on
 * nothing more is sent: a request queued just before the reload (like the What if page's delayed one) would
 * otherwise go out with the old session's CSRF token and be refused.
 */
let reloading = false;
export function markReloading() {
  reloading = true;
}

/**
 * While a switch request (/api/demo/...) is being answered, other requests wait: the answer changes the session
 * cookie, and a request sent in that moment would carry the new cookie with the old CSRF token. If the switch
 * works the tab reloads and the waiting requests are dropped; if it fails (wrong password) they go out as normal.
 */
let gate: Promise<void> | null = null;
export async function duringSwitch<T>(fn: () => Promise<T>): Promise<T> {
  let release = () => {};
  gate = new Promise<void>((r) => (release = r));
  try {
    const out = await fn();
    reloading = true;
    return out;
  } finally {
    gate = null;
    release();
  }
}

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}
export function setOnAuthLost(fn: () => void) {
  onAuthLost = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  body?: unknown,
): Promise<T> {
  if (gate && !url.startsWith('/api/demo/')) await gate;
  if (reloading) throw new ApiError('Reloading...', 409, 'MODE_CHANGED');
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  // Every answer says which mode served it. If Arc40 switched modes in another tab, this tab
  // reloads BEFORE showing anything, so it never mixes real and demo data on one screen.
  const served = res.headers.get('x-arc40-mode');
  if (tabMode && served && served !== tabMode && url !== '/api/auth/status') {
    reloading = true;
    onModeChanged();
    throw new ApiError('Arc40 switched between real and demo data. Reloading...', 409, 'MODE_CHANGED');
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    if (res.status === 401 && data.code === 'AUTH_REQUIRED') onAuthLost();
    throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.code);
  }
  if (method !== 'GET' && changesMoney(url)) scheduleTrophyCheck();
  if (method === 'POST' && awardsTrophies(url)) unlockListeners.forEach((fn) => fn());
  return data as T;
}

/**
 * Trophies (Round 1): awarding is an explicit step. A few seconds after any successful change (an import, an
 * edit, a balance, a setting), the app asks the server to check every trophy that is On, once. Requests that cannot
 * change money (logging in, demo switches, the theme, trophies themselves) do not count.
 */
const NOT_MONEY = ['/api/auth/', '/api/demo/', '/api/preferences', '/api/trophies'];
function changesMoney(url: string): boolean {
  return url.startsWith('/api/') && !NOT_MONEY.some((p) => url.startsWith(p));
}
let trophyTimer: ReturnType<typeof setTimeout> | null = null;
const trophyListeners = new Set<() => void>();
/** Called after a trophy check that may have changed something (the Trophies page reloads). */
export function onTrophiesChecked(fn: () => void): () => void {
  trophyListeners.add(fn);
  return () => trophyListeners.delete(fn);
}
export function scheduleTrophyCheck(delayMs = 2500) {
  if (trophyTimer) clearTimeout(trophyTimer);
  trophyTimer = setTimeout(() => {
    trophyTimer = null;
    void checkTrophies();
  }, delayMs);
}
/** Asks the server to check On trophies now. Quiet: never throws, skipped when logged out or switching modes. */
export async function checkTrophies(): Promise<{ key: string }[]> {
  if (!csrfToken || reloading) return [];
  try {
    const r = await api<{ earned: { key: string }[] }>('POST', '/api/trophies/evaluate');
    trophyListeners.forEach((fn) => fn());
    return r.earned;
  } catch {
    return [];
  }
}

/**
 * Trophies Round 2: after any request that can award trophies (a check, turning one on, turning on a shelf), the unlock
 * pop-up asks the server what is waiting to be celebrated (components/TrophyUnlock.tsx).
 */
function awardsTrophies(url: string): boolean {
  return url === '/api/trophies/evaluate' || /^\/api\/trophies\/(groups\/[^/]+|[^/]+)\/on$/.test(url);
}
const unlockListeners = new Set<() => void>();
export function onTrophiesAwarded(fn: () => void): () => void {
  unlockListeners.add(fn);
  return () => unlockListeners.delete(fn);
}

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  csrfToken: string | null;
  idleTimeoutMinutes: number;
  mode: Mode;
  /** Saved theme, only when logged in. */
  theme: 'dark' | 'light' | 'system' | null;
}
