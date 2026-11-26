/**
 * Trophy sounds (Trophies Round 2), generated in the browser with the Web Audio API, the same way as the Wrapped sounds:
 * no audio files, nothing downloaded. A soft chime as the trophy rises, richer as the rank climbs (more notes and a
 * longer shimmer), and a special one for the Arc40 tier (a warm swell under a longer run, plus a sparkle per star).
 * Every sound lasts about 1 to 2 seconds and stays quiet. On unless Settings > Trophy sounds (or the pop-up's mute) is off.
 *
 * Browsers only allow sound after a click or key press on the page. `installTrophyAudio()` listens for the first ones
 * and prepares the sound then; until that has happened, `playUnlock` plays nothing and shows no error (the pop-up still
 * shows, silently).
 */
let ctx: AudioContext | null = null;

/** Prepares (or wakes) the sound engine. Must run inside a click or key press. */
export function unlockTrophyAudio(): void {
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no sound is fine
  }
}

let installed = false;
/** Listens for clicks and key presses so sound is ready by the time a trophy is earned. Safe to call more than once. */
export function installTrophyAudio(): void {
  if (installed) return;
  installed = true;
  const wake = () => unlockTrophyAudio();
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
  window.addEventListener('keydown', wake, { capture: true });
}

/** True only when the browser lets this page make sound right now. */
export function audioReady(): boolean {
  return !!ctx && ctx.state === 'running';
}

/** One soft bell: a sine with a quiet overtone, quick attack, slow fade. */
function bell(freq: number, start: number, length: number, volume: number, overtone = 0.16): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  gain.connect(ctx.destination);
  for (const [mult, share] of [
    [1, 1],
    [2.01, overtone],
  ] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * mult, t0);
    g.gain.value = share;
    osc.connect(g).connect(gain);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }
}

/** A low, warm swell under the Arc40 chime (two quiet sines that rise and fall). */
function swell(freqs: readonly number[], start: number, length: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + length * 0.35);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  gain.connect(ctx.destination);
  for (const f of freqs) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f, t0);
    osc.connect(gain);
    osc.start(t0);
    osc.stop(t0 + length + 0.05);
  }
}

// A major pentatonic run from C6 (soft, bell-like, never clashes).
const RUN = [1046.5, 1318.5, 1568, 2093, 2637];

export interface Chime {
  notes: number[];
  last: number;
  arc: boolean;
  sparkles: number;
  /** Round 4: The Arc's grand version (a longer swell under a rising, then ringing run). */
  grand?: boolean;
  swell?: number;
}

/**
 * How a rank sounds: more notes and a longer shimmer as it climbs (pure, so it can be tested). `grand` = The Arc: the
 * Arc40 chime made longer and fuller (eight notes rising two octaves, a 3 s warm swell, six sparkles), about 3.3 s.
 */
export function chimeFor(level: number, stars: number, grand = false): Chime {
  if (grand) return { notes: [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093, 2637], last: 2.2, arc: true, sparkles: 6, grand: true, swell: 3.2 };
  if (level >= 12) return { notes: [1046.5, 1318.5, 1568, 1975.5, 2349.3], last: 1.4, arc: true, sparkles: 1 + Math.min(3, stars) };
  const n = Math.min(5, 2 + Math.floor((level - 1) / 3)); // ranks 1-3: 2 notes, 4-6: 3, 7-9: 4, 10-11: 5
  return { notes: RUN.slice(0, n), last: Math.min(1.3, 0.9 + level * 0.04), arc: false, sparkles: level >= 9 ? 1 : 0 };
}

/** The chime for one trophy, timed with its rise. Plays nothing (silently) when sound is not allowed yet. */
export function playUnlock(level: number, stars = 0, grand = false): void {
  try {
    if (!audioReady()) return;
    const c = chimeFor(level, stars, grand);
    const start = 0.25;
    const step = c.arc ? 0.11 : 0.12;
    if (c.grand) swell([130.8, 196, 261.6], start - 0.1, c.swell!, 0.026);
    else if (c.arc) swell([261.6, 392], start - 0.05, 1.8, 0.02);
    c.notes.forEach((f, i) => {
      const lastOne = i === c.notes.length - 1;
      bell(f, start + i * step, lastOne ? c.last : 0.7, lastOne ? 0.045 : 0.035);
    });
    for (let i = 0; i < c.sparkles; i++) bell(3136 + i * 392, start + c.notes.length * step + 0.12 + i * 0.09, 0.45, 0.012, 0);
  } catch {
    /* no sound is fine */
  }
}

/** Settings "Hear it": wakes the sound (this runs inside the click), waits until it is ready, then plays a Gold chime. */
export async function hearTrophySound(level = 5): Promise<void> {
  unlockTrophyAudio();
  try {
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  } catch {
    /* no sound is fine */
  }
  playUnlock(level, 0);
}
