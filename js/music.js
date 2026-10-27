// Soft background music: a music-box loop synthesized with Web Audio (no files, nothing to license).
// I–vi–IV–V in C, pentatonic bells over a quiet bass. The tune is fixed (seeded), so it is the
// same every time. It dips while a voice line plays so words stay clear.
import { audioContext } from './audio.js';

const BPM = 84;
const EIGHTH = 60 / BPM / 2;
const LEVEL = 0.07;       // music sits well under the voice and chimes
const DUCKED = 0.018;

// Two bars per chord, eight bars in all.
const CHORDS = [
  { root: 48, tones: [60, 64, 67, 72, 76] },  // C
  { root: 45, tones: [57, 60, 64, 69, 72] },  // Am
  { root: 41, tones: [60, 65, 69, 72, 77] },  // F
  { root: 43, tones: [59, 62, 67, 71, 74] },  // G
];
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76, 79];

function seeded(seed) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
}

// 64 eighth-note steps: each step is a melody note (MIDI) or null.
const TUNE = (() => {
  const rnd = seeded(20261026);
  const steps = [];
  let last = 67;
  for (let bar = 0; bar < 8; bar++) {
    const chord = CHORDS[Math.floor(bar / 2)];
    for (let e = 0; e < 8; e++) {
      const strong = e % 2 === 0;
      if (!strong && rnd() < 0.55) { steps.push(null); continue; }
      if (e === 7 && bar % 2 === 1) { steps.push(null); continue; } // breathe at phrase ends
      const pool = strong ? chord.tones : PENTA;
      // Prefer small steps from the last note, so it sings rather than jumps.
      const near = pool.filter(n => Math.abs(n - last) <= 5);
      const pick = (near.length ? near : pool)[Math.floor(rnd() * (near.length || pool.length))];
      steps.push(pick);
      last = pick;
    }
  }
  return steps;
})();

const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

let bus = null, enabled = true, playing = false, timer = null, step = 0, nextTime = 0, ducked = false;

function ensureBus() {
  const ctx = audioContext();
  if (!ctx) return null;
  if (bus) return ctx;
  bus = ctx.createGain();
  bus.gain.value = 0;
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3200;
  // A short echo gives the bells a little room.
  const delay = ctx.createDelay(2);
  delay.delayTime.value = EIGHTH * 3;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.28;
  bus.connect(lowpass).connect(ctx.destination);
  lowpass.connect(delay).connect(feedback).connect(delay);
  feedback.connect(ctx.destination);
  return ctx;
}

function bell(ctx, t, midi) {
  const f = hz(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.5, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  g.connect(bus);
  for (const [mult, amp] of [[1, 1], [2, 0.25], [3.01, 0.08]]) {
    const o = ctx.createOscillator();
    const a = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = f * mult;
    a.gain.value = amp;
    o.connect(a).connect(g);
    o.start(t);
    o.stop(t + 1.5);
  }
}

function bass(ctx, t, midi, dur) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = hz(midi);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.35, t + 0.04);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function schedule() {
  const ctx = audioContext();
  if (!ctx || !playing) return;
  while (nextTime < ctx.currentTime + 0.4) {
    const s = step % TUNE.length;
    if (TUNE[s] != null) bell(ctx, nextTime, TUNE[s]);
    if (s % 4 === 0) bass(ctx, nextTime, CHORDS[Math.floor(s / 16)].root, EIGHTH * 4);
    nextTime += EIGHTH;
    step++;
  }
}

function fadeTo(level, secs = 0.6) {
  const ctx = audioContext();
  if (!ctx || !bus) return;
  bus.gain.cancelScheduledValues(ctx.currentTime);
  bus.gain.setValueAtTime(bus.gain.value, ctx.currentTime);
  bus.gain.linearRampToValueAtTime(level, ctx.currentTime + secs);
}

export function start() {
  if (!enabled || playing || document.hidden) return;
  const ctx = ensureBus();
  if (!ctx) return;
  playing = true;
  nextTime = ctx.currentTime + 0.1;
  timer = setInterval(schedule, 100);
  schedule();
  fadeTo(ducked ? DUCKED : LEVEL, 1.5);
}

export function stop() {
  if (!playing) return;
  playing = false;
  clearInterval(timer);
  fadeTo(0, 0.4);
}

export function setEnabled(on) {
  enabled = on;
  if (on) start(); else stop();
}

export function duck(on) {
  ducked = on;
  if (playing) fadeTo(on ? DUCKED : LEVEL, on ? 0.15 : 0.8);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop(); else start();
});
