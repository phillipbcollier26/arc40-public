/**
 * Arc40 Wrapped sounds (V2 Phase 4), generated in the browser with the Web Audio API: a soft three-note
 * chime for the intro and a quiet "tink" between slides. Nothing is downloaded and no audio file exists,
 * so the security policy stays as it is. Off unless Settings > Arc40 Wrapped > Sound is on.
 *
 * Browsers only allow sound after a click or key press, so `unlockAudio()` is called from the click that
 * opens Wrapped.
 */
let ctx: AudioContext | null = null;

export function unlockAudio(): void {
  try {
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null; // no sound is fine
  }
}

/** One soft bell-like note: a sine with a quiet overtone, quick attack, slow fade. */
function note(freq: number, start: number, length: number, volume: number): void {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  gain.connect(ctx.destination);
  for (const [mult, share] of [
    [1, 1],
    [2, 0.18],
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

/** The intro: a rising major arpeggio (C6, E6, G6), soft. */
export function playIntro(): void {
  try {
    note(1046.5, 0.15, 1.6, 0.05);
    note(1318.5, 0.45, 1.6, 0.045);
    note(1568, 0.75, 2.2, 0.04);
  } catch {
    /* ignore */
  }
}

/** Between slides: one short, quiet note. */
export function playTick(): void {
  try {
    note(1760, 0, 0.35, 0.025);
  } catch {
    /* ignore */
  }
}
