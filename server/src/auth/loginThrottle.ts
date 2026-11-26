/**
 * Light brute-force brake: after 5 wrong passwords in a row, wait 30 seconds.
 * In memory only (resets when the app restarts). Deliberately gentle.
 */
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 30_000;

export class LoginThrottle {
  private failures = 0;
  private lockedUntil = 0;

  /** Milliseconds left before another attempt is allowed (0 = allowed now). */
  retryAfterMs(now: number): number {
    return Math.max(0, this.lockedUntil - now);
  }

  recordFailure(now: number): void {
    this.failures += 1;
    if (this.failures >= MAX_FAILURES) {
      this.lockedUntil = now + LOCKOUT_MS;
      this.failures = 0;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}
