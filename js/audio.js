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
  warmSpeech();
}

export const audioContext = () => ctx;

// Called with true when a voice line starts and false when it ends (the music dips under it).
let voiceHook = null;
export function onVoice(fn) { voiceHook = fn; }

// Android's speech engine starts cold (seconds of silence on the first line), so wake it on
// the first tap with a silent utterance, and pick an English voice once the list loads.
let warmed = false;
let lastCancel = 0;
let voice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice = voices.find(v => /en[-_]US/i.test(v.lang) && /google/i.test(v.name))
    || voices.find(v => /en[-_]US/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang)) || null;
}
function warmSpeech() {
  if (warmed || !('speechSynthesis' in window)) return;
  warmed = true;
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
  const u = new SpeechSynthesisUtterance(' ');
  u.volume = 0;
  speechSynthesis.speak(u);
}

export const clipCount = () => Object.keys(VOICE_CLIPS).length;

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
  pending = null;
  if (!current) return;
  lastEnd = performance.now();
  if (current.audio) { current.audio.pause(); current.audio.currentTime = 0; }
  if (current.utterance && 'speechSynthesis' in window) { speechSynthesis.cancel(); lastCancel = performance.now(); }
  current.resolve?.();
  current = null;
}

// Plays a clip by id, or speaks `text` with the device voice if the clip doesn't exist.
// Resolves when it ends, is cut off, or can't play at all (never hangs the game).
// Lines never run together: a new line starts at least GAP ms after the last one ended.
const GAP = 320;
let lastEnd = 0;
let pending = null;

// opts.onTime(seconds, duration) is called every frame while the line plays (word highlighting).
export function say(id, text, opts = {}) {
  stop();
  if (volume <= 0) return Promise.resolve();
  const token = {};
  pending = token;
  const wait = Math.max(0, GAP - (performance.now() - lastEnd));
  return new Promise(resolve => {
    const start = () => {
      if (pending !== token) { resolve(); return; } // replaced by another line during the gap
      pending = null;
      play(id, text, resolve, opts);
    };
    if (wait) setTimeout(start, wait); else start();
  });
}

function play(id, text, resolve, opts) {
  {
    const follow = (getTime, getDuration) => {
      if (!opts.onTime) return;
      const mine = current;
      const tick = () => {
        if (current !== mine) return;
        opts.onTime(getTime(), getDuration());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    voiceHook?.(true);
    const done = () => {
      if (current?.resolve === done) { current = null; lastEnd = performance.now(); voiceHook?.(false); }
      resolve();
    };
    const file = VOICE_CLIPS[id];
    if (file) {
      const audio = cache.get(id) || new Audio(`assets/voice/${file}`);
      cache.set(id, audio);
      audio.currentTime = 0;
      audio.volume = volume;
      audio.onended = done;
      // Fall back to device speech only if the clip itself can't play: a clip cut off by the next
      // line (pause() → AbortError) must stay cut off, not be re-read in the robotic voice.
      const stillMine = () => current?.audio === audio;
      audio.onerror = () => { if (stillMine()) speak(text, done); else done(); };
      current = { audio, resolve: done };
      follow(() => audio.currentTime, () => audio.duration || 0);
      audio.play().catch(err => {
        if (err?.name === 'AbortError' || !stillMine()) { done(); return; }
        speak(text, done);
      });
      return;
    }
    speak(text, done);
    // Device voice: no clock to read, so estimate from the text.
    const t0 = performance.now();
    follow(() => (performance.now() - t0) / 1000, () => 0.5 + text.length * 0.075);
  }
}

function speak(text, done) {
  if (!('speechSynthesis' in window) || !text) { done(); return; }
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  if (voice) u.voice = voice;
  u.rate = 0.85;
  u.pitch = 1.1;
  u.volume = volume;
  u.onend = done;
  u.onerror = done;
  current = { utterance: u, resolve: done };
  // Chrome on Android drops an utterance queued in the same tick as cancel(), and a paused
  // engine stays silent until resumed. Cancel only when something is playing, then wait a beat.
  const busy = speechSynthesis.speaking || speechSynthesis.pending;
  if (busy) { speechSynthesis.cancel(); lastCancel = performance.now(); }
  speechSynthesis.resume();
  const wait = performance.now() - lastCancel < 150 ? 120 : 0;
  setTimeout(() => { if (current?.utterance === u) speechSynthesis.speak(u); }, wait);
  // Some Android voices never fire onend: give up after about how long the line takes to say.
  setTimeout(done, 900 + text.length * 110);
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

function sweep(from, to, start, dur, gain = 0.08, type = 'sine') {
  if (!effects || !ctx) return;
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t);
  o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.015);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.1);
}

export const chime = {
  correct() { tone(784, 0, 0.25); tone(1047, 0.1, 0.35); },
  fast() { tone(784, 0, 0.2); tone(988, 0.08, 0.2); tone(1319, 0.16, 0.4); },
  gentle() { tone(523, 0, 0.4, 'triangle', 0.1); },
  rainbow() { [523, 659, 784, 988, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.07, 0.35, 'sine', 0.12)); },
  hatch() { [659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.12, 0.5, 'triangle', 0.12)); },
  tap() { tone(1200, 0, 0.06, 'sine', 0.05); },
  // A new card: a soft rising pop.
  pop() { sweep(330, 660, 0, 0.12, 0.09); },
  // The first-letter hint: a tiny twinkle.
  twinkle() { [1568, 2093, 2637].forEach((f, i) => tone(f, i * 0.06, 0.25, 'sine', 0.05)); },
  // Tapping a creature in the meadow.
  squeak() { sweep(700, 1100, 0, 0.09, 0.08); sweep(900, 1300, 0.11, 0.08, 0.06); },
  sticker() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.4, 'triangle', 0.1)); tone(2093, 0.4, 0.6, 'sine', 0.07); },
  // Before a hatch: a soft rising drumroll of taps.
  drumroll() { for (let i = 0; i < 16; i++) tone(180 + i * 12, i * 0.1, 0.07, 'triangle', 0.03 + i * 0.004); },
  // The hatch: a bright little brass fanfare and a sparkle on top.
  fanfare() {
    const notes = [[523, 0, 0.16], [659, 0.15, 0.16], [784, 0.3, 0.16], [1047, 0.45, 0.7]];
    for (const [f, t, d] of notes) { tone(f, t, d, 'sawtooth', 0.05); tone(f, t, d, 'triangle', 0.08); }
    [523, 659, 784].forEach(f => tone(f, 0.45, 0.9, 'triangle', 0.06));
    [1568, 2093, 2637, 3136].forEach((f, i) => tone(f, 0.6 + i * 0.07, 0.4, 'sine', 0.04));
  },
  whoosh() { sweep(900, 300, 0, 0.18, 0.04, 'triangle'); },
};
