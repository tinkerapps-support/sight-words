// Word Check (owner, 2026-10-28): once every word on the lists that are on has been introduced, a
// test that goes through every word once. Each question shows a fresh grid of 10 words; the voice
// says one and she taps it. Only the first tap counts. A score at the end, saved for the parent.
// It's a check only: it never changes a word's progress.
import { CONFIG } from './config.js';
import { wordId, cheerId, CHEERS } from './voice-lines.js';
import * as audio from './audio.js';
import * as device from './device.js';

const $ = id => document.getElementById(id);
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

let ctx = null;    // from main.js: { state, persist, go, show, entries, setMascot, burst }
let run = null;    // { words, i, right, missed, token }

export function initCheck(context) {
  ctx = context;
  $('check-quit').addEventListener('click', quit);
  $('check-hear').addEventListener('click', () => { if (run) audio.say(wordId(current()), current(), { now: true }); });
  $('check-done').addEventListener('click', () => { audio.stop(); ctx.go('home'); });
}

// Every word on the lists that are on has been met (a head start counts).
export function checkReady() {
  const ents = ctx.entries();
  return ents.length > 0 && ents.every(e => (ctx.state().words[e.word]?.level ?? 0) >= 1);
}

const current = () => run.words[run.i];

export function startCheck() {
  const words = shuffle(ctx.entries().map(e => e.word));
  run = { words, i: 0, right: 0, missed: [], token: null };
  audio.preload(words.map(wordId));
  if (ctx.state().settings.wakeLock) device.keepAwake(true);
  $('check-play').hidden = false;
  $('check-result').hidden = true;
  ctx.go('check');
  ask(true);
}

function quit() {
  audio.stop();
  device.keepAwake(false);
  run = null;
  ctx.go('home');
}

function renderProgress() {
  $('check-count').textContent = `${Math.min(run.i + 1, run.words.length)} / ${run.words.length}`;
  $('check-bar').style.width = `${(run.i / run.words.length) * 100}%`;
}

async function ask(first = false) {
  const token = run.token = {};
  renderProgress();
  ctx.setMascot($('check-mascot'), 'think');
  const word = current();
  const others = shuffle(run.words.filter(w => ctx.show(w) !== ctx.show(word))).slice(0, CONFIG.check.grid - 1);
  const grid = $('check-grid');
  grid.innerHTML = '';
  let answered = false;
  for (const w of shuffle([word, ...others])) {
    const b = document.createElement('button');
    b.className = 'check-word';
    b.textContent = ctx.show(w);
    b.addEventListener('click', () => {
      if (!run || run.token !== token || answered) return;
      answered = true;
      grid.querySelectorAll('.check-word').forEach(x => { x.disabled = true; });
      answer(token, b, w === word, grid);
    });
    grid.appendChild(b);
  }
  audio.chime.pop();
  if (first) await audio.say('check-start', 'Word check! Listen, then tap the word you hear.');
  if (run?.token === token) audio.say(wordId(word), word);
}

async function answer(token, b, right, grid) {
  const word = current();
  if (right) {
    run.right++;
    b.classList.add('right');
    ctx.setMascot($('check-mascot'), 'cheer');
    audio.chime.correct();
    await wait(650);
  } else {
    // No fuss: the right one glows and the voice says it once more.
    run.missed.push(word);
    b.classList.add('wrong');
    const correct = [...grid.children].find(x => x.textContent === ctx.show(word));
    correct?.classList.add('reveal');
    ctx.setMascot($('check-mascot'), 'gentle');
    audio.chime.gentle();
    await audio.say(wordId(word), word);
    await wait(500);
  }
  if (!run || run.token !== token) return;
  run.i++;
  if (run.i >= run.words.length) finish();
  else ask();
}

function finish() {
  device.keepAwake(false);
  const { right, words, missed } = run;
  run = null;
  const total = words.length;
  const st = ctx.state();
  st.checks = [...(st.checks || []), { t: Date.now(), right, total, missed, asked: words }].slice(-50);
  ctx.persist();
  $('check-bar').style.width = '100%';
  $('check-play').hidden = true;
  $('check-result').hidden = false;
  $('check-score').textContent = `You got ${right} of ${total}!`;
  const stars = right === total ? 3 : right / total >= 0.8 ? 2 : 1;
  $('check-stars').textContent = '⭐'.repeat(stars);
  $('check-missed').innerHTML = missed.length
    ? `<b>For the grown-up:</b> words to practice: ${missed.map(w => `<span>${ctx.show(w)}</span>`).join(' ')}`
    : '<b>For the grown-up:</b> every word right on the first try!';
  ctx.setMascot($('check-result-mascot'), 'cheer');
  ctx.burst(['⭐', '💖', '✨', '🌈'], 18, $('check-burst'));
  audio.chime.sticker();
  const line = right === total ? 'Awesome!' : CHEERS[Math.floor(Math.random() * CHEERS.length)];
  audio.say('check-end', 'You finished the word check!').then(() => {
    if (!$('check-result').hidden) audio.say(cheerId(line), line);
  });
}

// For the smoke test: the word being asked, as shown.
export const checkWord = () => (run ? ctx.show(current()) : null);
