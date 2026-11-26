/**
 * Trophies Round 2: the trophy chime (web/src/lib/trophySound.ts) gets richer as the rank climbs, has its own Arc40
 * version, and stays short and soft. The sound is made in the browser; preferences.test.ts checks no audio file exists.
 */
import { describe, expect, it } from 'vitest';
import { chimeFor } from '../../web/src/lib/trophySound';

describe('trophy chime', () => {
  it('more notes (never fewer) and a longer shimmer as the rank climbs; Arc40 is its own chime with a sparkle per star', () => {
    let notes = 0;
    let shimmer = 0;
    for (let level = 1; level <= 11; level++) {
      const c = chimeFor(level, 0);
      expect(c.arc).toBe(false);
      expect(c.notes.length).toBeGreaterThanOrEqual(notes);
      expect(c.last).toBeGreaterThanOrEqual(shimmer);
      notes = c.notes.length;
      shimmer = c.last;
    }
    expect(chimeFor(1, 0).notes).toHaveLength(2); // Iron
    expect(chimeFor(5, 0).notes).toHaveLength(3); // Gold
    expect(chimeFor(11, 0).notes).toHaveLength(5); // Diamond
    const arc = chimeFor(12, 0);
    expect(arc.arc).toBe(true);
    expect(chimeFor(12, 3).sparkles).toBe(arc.sparkles + 3);
  });

  it('every chime is short: about 1 to 2 seconds from the first note to the end of the shimmer', () => {
    for (let level = 1; level <= 12; level++) {
      for (const stars of [0, 1, 2, 3]) {
        const c = chimeFor(level, stars);
        const end = 0.25 + (c.notes.length - 1) * (c.arc ? 0.11 : 0.12) + c.last;
        expect(end, `level ${level}`).toBeGreaterThanOrEqual(1);
        expect(end, `level ${level}`).toBeLessThanOrEqual(2.1);
      }
    }
  });

  it("Round 4: The Arc's grand chime is the longest and fullest (a longer Arc40 chime), still under 3.5 seconds", () => {
    const grand = chimeFor(12, 0, true);
    const end = (c: ReturnType<typeof chimeFor>) => 0.25 + (c.notes.length - 1) * (c.arc ? 0.11 : 0.12) + c.last;
    expect(grand).toMatchObject({ arc: true, grand: true });
    for (let level = 1; level <= 12; level++)
      for (const stars of [0, 3]) {
        expect(grand.notes.length).toBeGreaterThan(chimeFor(level, stars).notes.length);
        expect(end(grand)).toBeGreaterThan(end(chimeFor(level, stars)));
        expect(grand.sparkles).toBeGreaterThan(chimeFor(level, stars).sparkles);
      }
    expect(end(grand)).toBeLessThanOrEqual(3.5);
    expect(grand.swell!).toBeLessThanOrEqual(3.5);
  });
});
