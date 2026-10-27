// The two extra games (PLAN.md §10, phase 4). Both check themselves, so a short round works
// without a parent: Bubble Pop (hear a word, pop its bubble) and Build It (tap the letters in order).
// Only words she has met (level 1+) are asked; the reading game stays the main way words move up.
import { CONFIG } from './config.js';
import { applyPop } from './engine.js';
import { lookalikesOf } from './lists.js';
import { wordId, cheerId, letterId, CHEERS } from './voice-lines.js';
import { record } from './storage.js';
import * as audio from './audio.js';
import * as device from './device.js';

const $ = id => document.getElementById(id);
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const wait = ms => new Promise(r => setTimeout(r, ms));

let ctx = null;            // from main.js: { state, persist, go, show, pick, burst, setMascot, entries }
let game = null;           // { kind, words, round, token, firstTry, moved: [] }

// Words a game can ask: met (level 1+); Build It also needs two letters or more.
// Shaky words (1–3) come first so the practice lands where it helps.
function eligible(kind) {
  const levelOf = w => ctx.state().words[w]?.level ?? 0;
  return ctx.entries().map(e => e.word)
    .filter(w => levelOf(w) >= 1 && (kind !== 'build' || w.length >= 2));
}
export const canPlay = kind => ctx && eligible(kind).length > 0;

function pickWords(kind) {
  const levelOf = w => ctx.state().words[w]?.level ?? 0;
  const all = eligible(kind);
  const shaky = shuffle(all.filter(w => levelOf(w) <= 3));
  const known = shuffle(all.filter(w => levelOf(w) > 3));
  const order = [...shaky, ...known];
  const out = [];
  // Small pools repeat, but never the same word twice in a row.
  for (let i = 0; out.length < CONFIG.games.rounds && i < 50; i++) {
    const w = order[i % order.length];
    if (out[out.length - 1] !== w || order.length === 1) out.push(w);
  }
  return out;
}

export function initGames(context) {
  ctx = context;
  $('game-quit').addEventListener('click', () => quit());
  $('game-hear').addEventListener('click', () => { if (game) audio.say(wordId(current()), current()); });
}

const current = () => game.words[game.round];
const alive = token => game && game.token === token;

export function startGame(kind) {
  const words = pickWords(kind);
  if (!words.length) return;
  game = { kind, words, round: 0, token: {}, moved: [] };
  audio.preload(words.map(wordId));
  if (ctx.state().settings.wakeLock) device.keepAwake(true);
  $('pop-area').hidden = kind !== 'pop';
  $('build-area').hidden = kind !== 'build';
  ctx.go('game');
  showRound(true);
}

function quit() {
  audio.stop();
  device.keepAwake(false);
  game = null;
  $('pop-area').innerHTML = '';
  ctx.go('home');
}

function renderDots() {
  $('game-dots').innerHTML = game.words.map((_, i) => `<i class="${i < game.round ? 'on' : ''}"></i>`).join('');
}

async function showRound(first = false) {
  const token = game.token = {};
  game.firstTry = true;
  renderDots();
  ctx.setMascot($('game-mascot'), 'think');
  audio.chime.pop();
  const word = current();
  if (game.kind === 'pop') renderBubbles(word); else renderBuild(word);
  if (first) {
    await (game.kind === 'pop'
      ? audio.say('pop-start', 'Pop the bubble with the word you hear!')
      : audio.say('build-start', "Let's build the word! Tap the letters in order."));
  }
  if (alive(token)) audio.say(wordId(word), word);
}

async function roundWon() {
  const token = game.token;
  ctx.setMascot($('game-mascot'), 'cheer');
  audio.chime.correct();
  ctx.burst(['⭐', '💖', '✨'], 12, $('game-burst'));
  const t = ctx.pick(CHEERS);
  await audio.say(cheerId(t), t);
  if (!alive(token)) return;
  await wait(250);
  if (!alive(token)) return;
  game.round++;
  if (game.round >= game.words.length) finish();
  else showRound();
}

function finish() {
  renderDots();
  device.keepAwake(false);
  const { kind, moved } = game;
  game = null;
  $('end-title').textContent = kind === 'pop' ? 'Great popping!' : 'Great building!';
  $('end-sticker').innerHTML = '';
  $('end-hatched').textContent = moved.length ? `Getting it: ${moved.map(ctx.show).join(', ')}` : '';
  ctx.go('end');
  ctx.setMascot($('end-mascot'), 'cheer');
  audio.chime.sticker();
  audio.say(cheerId('You did it!'), 'You did it!');
}

// ---------------------------------------------------------------- Bubble Pop

// Wrong choices come from the word's look-alikes, then any other word on the lists that are on.
function distractors(word) {
  const words = ctx.entries().map(e => e.word);
  const shown = new Set([ctx.show(word)]);
  const out = [];
  const like = shuffle([...lookalikesOf(word, ctx.entries())].filter(w => words.includes(w)));
  for (const w of [...like, ...shuffle(words)]) {
    if (out.length >= 2) break;
    if (shown.has(ctx.show(w))) continue;
    shown.add(ctx.show(w));
    out.push(w);
  }
  return out;
}

// Three spots, loosely a triangle, shuffled each round.
const SPOTS = [[6, 8], [52, 20], [26, 52]];

function renderBubbles(word) {
  const area = $('pop-area');
  area.innerHTML = '';
  const choices = shuffle([word, ...distractors(word)]);
  const spots = shuffle(SPOTS);
  choices.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'bubble';
    b.textContent = ctx.show(w);
    const [x, y] = spots[i];
    b.style.left = `${x + Math.random() * 6}%`;
    b.style.top = `${y + Math.random() * 6}%`;
    b.style.setProperty('--d', `${i * 0.15}s`);
    b.addEventListener('click', () => popBubble(b, w === word));
    area.appendChild(b);
  });
}

async function popBubble(b, right) {
  if (!game || b.disabled) return;
  const token = game.token;
  if (right) {
    area().querySelectorAll('.bubble').forEach(x => { x.disabled = true; });
    b.classList.add('popped');
    audio.chime.pop();
    // Only a first-try pop counts (half a Got it); picking the last bubble left proves nothing.
    if (game.firstTry) {
      const word = current();
      const res = applyPop(record(ctx.state(), word), Date.now());
      if (res.after > res.before) game.moved.push(word);
      ctx.persist();
    }
    roundWon();
    return;
  }
  game.firstTry = false;
  b.disabled = true;
  b.classList.add('nope');
  ctx.setMascot($('game-mascot'), 'gentle');
  audio.chime.gentle();
  await audio.say('try-again', 'Try another one!');
  if (alive(token)) audio.say(wordId(current()), current());
}
const area = () => $('pop-area');

// ---------------------------------------------------------------- Build It

function renderBuild(word) {
  const letters = [...ctx.show(word)];
  const level = ctx.state().words[word]?.level ?? 0;
  // The word shows faintly in the slots while it's still a Learning / Getting it word.
  const ghost = level <= 2;
  $('build-slots').className = 'build-slots';
  $('build-slots').innerHTML = letters.map(ch => `<span class="slot"><span class="ghost">${ghost ? ch : ''}</span></span>`).join('');
  let order = shuffle(letters);
  for (let i = 0; i < 5 && order.join('') === letters.join(''); i++) order = shuffle(letters);
  const tiles = $('build-tiles');
  tiles.innerHTML = '';
  game.filled = 0;
  for (const ch of order) {
    const t = document.createElement('button');
    t.className = 'tile';
    t.textContent = ch;
    t.addEventListener('click', () => placeTile(t, ch, letters));
    tiles.appendChild(t);
  }
}

function placeTile(t, ch, letters) {
  if (!game || t.disabled || game.filled >= letters.length) return;
  if (ch !== letters[game.filled]) {
    game.firstTry = false;
    t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope');
    audio.chime.gentle();
    return;
  }
  t.disabled = true;
  t.classList.add('used');
  const slot = $('build-slots').children[game.filled];
  slot.textContent = ch;
  slot.classList.add('filled');
  game.filled++;
  audio.chime.tap();
  if (game.filled < letters.length) { audio.say(letterId(ch), ch.toUpperCase()); return; }
  // Built: the whole word lights up and is said, then the cheer.
  $('build-slots').classList.add('done');
  const token = game.token;
  audio.say(wordId(current()), current()).then(() => { if (alive(token)) roundWon(); });
}

// The word being asked, as shown (for the smoke test).
export const gameWord = () => (game ? ctx.show(current()) : null);
