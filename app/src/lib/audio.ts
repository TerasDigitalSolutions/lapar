// WebAudio alerts for staff and kitchen. Every function is a no-op without WebAudio.
let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function getCtx(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    typeof window === 'undefined'
      ? undefined
      : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    ctx.addEventListener('statechange', () => listeners.forEach((l) => l()));
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Call from a user gesture (e.g. Start shift); resolves true when sound can play. */
export async function unlockAudio(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  try {
    if (c.state !== 'running') await c.resume();
  } catch {
    /* blocked until a gesture */
  }
  return c.state === 'running';
}

/** Calls `cb` whenever the AudioContext changes state (e.g. suspended -> running). Returns an unsubscribe. */
export function onAudioStateChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

export const isAudioRunning = (): boolean => ctx?.state === 'running';

function tone(freq: number, start: number, dur: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = freq;
  const t = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** New order: two short high tones. */
export function playOrderAlert(): void {
  if (!isAudioRunning()) return;
  tone(988, 0, 0.14);
  tone(988, 0.2, 0.14);
}

/** Server call: one long low tone. */
export function playCallAlert(): void {
  if (!isAudioRunning()) return;
  tone(330, 0, 0.7);
}

export function vibrate(pattern: number | number[] = 200): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}
