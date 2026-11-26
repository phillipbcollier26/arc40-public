import { createContext, useContext } from 'react';
import { api, duringSwitch, markReloading, type Mode } from './api';
import { broadcast } from './tabSync';

/** Which data this tab shows. Comes from /api/auth/status; never stored in the browser. */
export const ModeContext = createContext<Mode>('real');
export const useMode = () => useContext(ModeContext);

/**
 * After a switch, tell the other tabs and reload this one. A full reload is the safest way to make
 * sure nothing from the previous mode stays on screen (cached lists, open editors, charts).
 */
function afterSwitch(): void {
  markReloading(); // nothing queued in this tab may go out with the old session now
  broadcast({ type: 'mode-changed' });
  window.location.reload();
}

export async function enterDemo(): Promise<void> {
  await duringSwitch(() => api('POST', '/api/demo/enter'));
  afterSwitch();
}

/** Needs the REAL password. Throws ApiError ("Wrong password...", or "Too many tries...") on failure. */
export async function leaveDemo(password: string): Promise<void> {
  await duringSwitch(() => api('POST', '/api/demo/exit', { password }));
  afterSwitch();
}

export async function resetDemo(): Promise<void> {
  await duringSwitch(() => api('POST', '/api/demo/reset'));
  afterSwitch();
}
