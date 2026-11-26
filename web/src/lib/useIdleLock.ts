import { useEffect, useRef } from 'react';
import { api } from './api';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'scroll'] as const;
const KEEPALIVE_EVERY_MS = 4 * 60_000;
const CHECK_EVERY_MS = 15_000;

/**
 * While you're using Arc40 it quietly tells the server you're still here.
 * If you walk away for longer than the timeout, the screen locks itself
 * (the server would reject the session anyway; this just hides the data sooner).
 */
export function useIdleLock(timeoutMinutes: number, onIdle: () => void) {
  const lastActivity = useRef(Date.now());
  const lastPing = useRef(Date.now());

  useEffect(() => {
    const mark = () => {
      lastActivity.current = Date.now();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));

    const timer = window.setInterval(() => {
      const now = Date.now();
      if (now - lastActivity.current > timeoutMinutes * 60_000) {
        onIdle();
        return;
      }
      if (lastActivity.current > lastPing.current && now - lastPing.current > KEEPALIVE_EVERY_MS) {
        lastPing.current = now;
        api('POST', '/api/auth/keepalive').catch(() => {});
      }
    }, CHECK_EVERY_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(timer);
    };
  }, [timeoutMinutes, onIdle]);
}
