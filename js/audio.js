// Voice clips + soft chimes (PLAN.md §5). One voice line at a time: a new line cancels the last.
import { VOICE_CLIPS } from './voice-clips.js';

let volume = 0.9;
let effects = true;
let ctx = null;
let current = null;      // { audio } or { utterance }
const cache = new Map();

export function configure({ voiceVolume, effects: fx }) {
  if (typeof voiceVolume === 'number') volume = voiceVolume;
  if (typeof fx === 'boolean') effects = fx;
}

// Call from a tap: Chrome on Android only allows sound after one.
export function unlock() {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* no Web Audio: chimes stay silent */ }
}

export function hasClip(id) {
  return Boolean(VOICE_CLIPS[id]);
}

export function preload(ids) {
  for (const id of ids) {
    if (!VOICE_CLIPS[id] || cache.has(id)) continue;
    const a = new Audio(`assets/voice/${VOICE_CLIPS[id]}`);
    a.preload = 'auto';
    cache.set(id, a);
  }
}

export function stop() {
  if (!current) return;
  if (current.audio) { current.audio.pause(); current.audio.currentTime = 0; }
  if (current.utterance && 'speechSynthesis' in window) speechSynthesis.cancel();
  current.resolve?.();
  current = null;
}

// Plays a clip by id, or speaks `text` with the device voice if the clip doesn't exist.
// Resolves when it ends, is cut off, or can't play at all (never hangs the game).
export function say(id, text) {
  stop();
  if (volume <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { if (current?.resolve === done) current = null; resolve(); };
    const file = VOICE_CLIPS[id];
    if (file) {
      const audio = cache.get(id) || new Audio(`assets/voice/${file}`);
      cache.set(id, audio);
      audio.currentTime = 0;
      audio.volume = volume;
      audio.onended = done;
      audio.onerror = () => speak(text, done);
      current = { audio, resolve: done };
      audio.play().catch(() => speak(text, done));
      return;
    }
    speak(text, done);
  });
}

function speak(text, done) {
  if (!('speechSynthesis' in window) || !text) { done(); return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = 0.85;
  u.pitch = 1.1;
  u.volume = volume;
  u.onend = done;
  u.onerror = done;
  current = { utterance: u, resolve: done };
  speechSynthesis.speak(u);
  setTimeout(done, 6000); // some Android voices never fire onend
}

// ---- Chimes (synthesized, no files) ----

function tone(freq, start, dur, type = 'sine', gain = 0.18) {
  if (!effects || !ctx) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export const chime = {
  correct() { tone(784, 0, 0.25); tone(1047, 0.1, 0.35); },
  fast() { tone(784, 0, 0.2); tone(988, 0.08, 0.2); tone(1319, 0.16, 0.4); },
  gentle() { tone(523, 0, 0.4, 'triangle', 0.1); },
  rainbow() { [523, 659, 784, 988, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.07, 0.35, 'sine', 0.12)); },
  hatch() { [659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.12)); },
  tap() { tone(1200, 0, 0.06, 'sine', 0.05); },
};
