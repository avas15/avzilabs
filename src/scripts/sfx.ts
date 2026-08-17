/**
 * Terminal sound effects.
 *
 * Kenney's CC0 interface sounds, served from /sfx/. Small, public domain, and
 * attributed in the footer anyway.
 *
 * Off by default and persisted, deliberately. Unexpected audio on someone
 * else's website is hostile, browsers block it before a user gesture, and a
 * portfolio site that beeps at a recruiter is worse than a silent one. It is a
 * thing you switch on because you want it.
 */

type SoundName = 'click' | 'key' | 'confirm' | 'error' | 'toggle' | 'glitch';

const STORAGE_KEY = 'avzi-sfx';
const BASE = '/sfx';

/** Per-sound relative gain, so nothing is jarringly louder than its neighbour. */
const GAIN: Record<SoundName, number> = {
  click: 0.35,
  key: 0.18,
  confirm: 0.4,
  error: 0.4,
  toggle: 0.35,
  glitch: 0.3,
};

let enabled = false;
let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const pending = new Map<SoundName, Promise<AudioBuffer | null>>();

export function isEnabled(): boolean {
  return enabled;
}

export function setEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* private mode */
  }
  document.documentElement.dataset.sfx = on ? 'on' : 'off';
  if (on) {
    // A user gesture is what makes this legal; warm the context now.
    ensureContext();
    void load('toggle').then(() => play('toggle'));
  }
}

export function toggle(): boolean {
  setEnabled(!enabled);
  return enabled;
}

function ensureContext(): AudioContext | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  }
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/**
 * Fetch and decode on first use. Nothing is downloaded until sound is switched
 * on, so the default visitor pays nothing for a feature they did not ask for.
 */
function load(name: SoundName): Promise<AudioBuffer | null> {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name)!);
  if (pending.has(name)) return pending.get(name)!;

  const p = (async () => {
    const c = ensureContext();
    if (!c) return null;
    try {
      const res = await fetch(`${BASE}/${name}.ogg`);
      if (!res.ok) return null;
      const buf = await c.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
      return buf;
    } catch {
      // Safari below 16.4 cannot decode Ogg Vorbis. Sound is decorative, so
      // failing silently is the correct behaviour rather than an error.
      return null;
    } finally {
      pending.delete(name);
    }
  })();

  pending.set(name, p);
  return p;
}

export function play(name: SoundName, gain = 1): void {
  if (!enabled) return;
  const c = ensureContext();
  if (!c) return;

  const fire = (buf: AudioBuffer) => {
    const src = c.createBufferSource();
    const vol = c.createGain();
    src.buffer = buf;
    vol.gain.value = GAIN[name] * gain;
    src.connect(vol).connect(c.destination);
    src.start(0);
  };

  const cached = buffers.get(name);
  if (cached) fire(cached);
  else void load(name).then((b) => b && fire(b));
}

/** Restore the saved preference. Never enables on its own. */
export function initSfx(): void {
  try {
    enabled = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    enabled = false;
  }
  document.documentElement.dataset.sfx = enabled ? 'on' : 'off';

  // Global click feedback on the things that look pressable.
  document.addEventListener(
    'click',
    (e) => {
      if (!enabled) return;
      const t = (e.target as HTMLElement | null)?.closest('a,button');
      if (t) play('click');
    },
    { passive: true }
  );
}
