import crypto from 'node:crypto';

/**
 * Duplicate detection for re-imports.
 *
 * Each row gets a fingerprint from its own fields. Two genuinely identical
 * rows (say, two $7.51 charges on the same day) share a fingerprint, so we
 * compare COUNTS: if the database already has N rows with a fingerprint and
 * the file has M, only the extra (M - N) are new. Re-importing the same file,
 * or an overlapping date range, never creates duplicates and never drops a
 * real repeated charge.
 */
export function fingerprint(parts: readonly (string | number | null)[]): string {
  return crypto
    .createHash('sha256')
    .update(parts.map((p) => (p === null ? '' : String(p).trim().toUpperCase())).join('␟'))
    .digest('hex')
    .slice(0, 40);
}

export function planDedupe(keys: readonly string[], existingCount: (key: string) => number): boolean[] {
  const seen = new Map<string, number>();
  return keys.map((k) => {
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return n >= existingCount(k); // true = new
  });
}
