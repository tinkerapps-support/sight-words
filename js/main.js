// Screens and wiring. The learning rules live in engine.js; this file only drives the UI.
import { CONFIG, LEVEL_NAMES } from './config.js';
import { applyResult, applyPlacement, buildSession, Session, markHeadStart, unmarkHeadStart, newRecord, dayKey, needsIntro, applyIntro, supportLevel, restWord } from './engine.js';
import { LISTS, activeWords, wordEntry } from './lists.js';
import { load, save, record, exportText, importText, defaultState } from './storage.js';
import * as audio from './audio.js';
import * as music from './music.js';
import { wordId, sentenceId, cheerId, letterId, CHEERS, FAST_CHEERS, NOT_YET } from './voice-lines.js';
import * as device from './device.js';
import { art } from './art.js';

const $ = id => document.getElementById(id);
// Everything she reads is lowercase except the word "I" (owner, 2026-10-26). Data and voice keep normal case.
const show = text => text.toLowerCase().replace(/\bi\b/g, 'I');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Placeholder creatures until Codex's art lands: one per word, by list position.
const CREATURES = ['🐰', '🐱', '🐹', '🐲', '🐸', '🦊', '🐦', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐵', '🐧', '🐤', '🦉', '🦋', '🐢', '🐙', '🦔', '🐿️', '🐳', '🦄'];
const STICKERS = ['🌈', '⭐', '🦄', '🌸', '🍓', '🧁', '🎀', '💖', '🌟', '🍭', '🦋', '🌷', '🍩', '🎈', '🐚', '🌙', '☁️', '🍦', '🪄', '👑'];

let state = load();
let page = 0;              // which list's meadow is showing
let mode = 'learn';        // 'learn' | 'meet'
let session = null;
let card = null;           // { word, level, shown: Set, start, timers: [] }
let undoStack = [];
let sessionStats = null;
let busy = false;
let celebrationToken = 0;  // bumped by Undo/Quit so a pending celebration doesn't advance

const persist = () => save(state);
const img = src => `<img src="${src}" alt="" draggable="false">`;
const creatureFor = word => {
  const src = art(`creature-${word.toLowerCase()}`);
  if (src) return img(src);
  for (const list of LISTS) {
    const i = list.words.findIndex(w => w.word === word);
    if (i >= 0) return CREATURES[i % CREATURES.length];
  }
  return '🐣';
};
const eggFor = stage => {
  const src = art(`egg-${stage}`);
  return src ? img(src) : `<span class="egg ${stage ? 's' + stage : ''}"></span>`;
};
const levelOf = word => state.words[word]?.level ?? 0;

// ---------------------------------------------------------------- navigation

const SCREENS = ['home', 'play-screen', 'end-screen', 'sticker-screen', 'setup-screen', 'settings-screen', 'progress-screen'];
function go(name) {
  const id = { setup: 'setup-screen', settings: 'settings-screen', progress: 'progress-screen', stickers: 'sticker-screen', play: 'play-screen', end: 'end-screen' }[name] || name;
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id === 'home') renderHome();
  if (id === 'setup-screen') renderSetup();
  if (id === 'settings-screen') renderSettings();
  if (id === 'progress-screen') renderProgress();
  if (id === 'sticker-screen') renderStickers();
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', () => go(b.dataset.back)));
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));

function confirmBox(text) {
  return new Promise(resolve => {
    $('confirm-text').textContent = text;
    $('math').hidden = true;
    $('confirm').hidden = false;
    const finish = v => { $('confirm').hidden = true; $('confirm-yes').onclick = $('confirm-no').onclick = null; resolve(v); };
    $('confirm-yes').onclick = () => finish(true);
    $('confirm-no').onclick = () => finish(false);
  });
}

// Grown-ups only: a two-digit sum a five-year-old can't do, asked fresh each time.
function mathCheck(text) {
  const a = 12 + Math.floor(Math.random() * 30), b = 13 + Math.floor(Math.random() * 30);
  return new Promise(resolve => {
    $('confirm-text').textContent = text;
    $('math-q').textContent = `To confirm, what is ${a} + ${b}?`;
    $('math-answer').value = '';
    $('math-wrong').hidden = true;
    $('math').hidden = false;
    $('confirm').hidden = false;
    $('math-answer').focus();
    const finish = v => {
      $('confirm').hidden = true;
      $('math').hidden = true;
      $('confirm-yes').onclick = $('confirm-no').onclick = $('math-answer').onkeydown = null;
      resolve(v);
    };
    const check = () => {
      if (Number($('math-answer').value.trim()) === a + b) finish(true);
      else { $('math-wrong').hidden = false; $('math-answer').select(); }
    };
    $('confirm-yes').onclick = check;
    $('math-answer').onkeydown = e => { if (e.key === 'Enter') check(); };
    $('confirm-no').onclick = () => finish(false);
  });
}

// ---------------------------------------------------------------- start

$('start').addEventListener('click', async () => {
  audio.unlock();
  audio.configure(state.settings);
  music.setEnabled(state.settings.music);
  if (state.settings.fullscreen) await device.enterFullscreen();
  $('start-gate').hidden = true;
  go(state.setupDone ? 'home' : 'setup');
});

// ---------------------------------------------------------------- home / meadow

function renderHome() {
  const enabled = LISTS.filter(l => state.settings.lists.includes(l.id));
  page = Math.min(page, enabled.length - 1);
  const list = enabled[page] || LISTS[0];
  $('meadow-title').textContent = enabled.length > 1 ? `Rainbow Meadow · ${list.name}` : 'Rainbow Meadow';
  $('page-prev').style.visibility = page > 0 ? 'visible' : 'hidden';
  $('page-next').style.visibility = page < enabled.length - 1 ? 'visible' : 'hidden';
  const m = $('meadow');
  m.innerHTML = '';
  let hatched = 0;
  for (const e of list.words) {
    const lvl = levelOf(e.word);
    const isHatched = state.hatched.includes(e.word);
    const b = document.createElement('button');
    b.className = 'friend' + (isHatched ? ' hatched' : '') + (isHatched && lvl >= 5 ? ' mastered' : '');
    if (isHatched) {
      hatched++;
      b.innerHTML = creatureFor(e.word);
      b.setAttribute('aria-label', show(e.word));
      b.addEventListener('click', () => { audio.chime.squeak(); audio.say(wordId(e.word), e.word); });
    } else {
      const stage = lvl >= 3 ? 3 : lvl >= 2 ? 2 : lvl >= 1 ? 1 : 0;
      b.innerHTML = eggFor(stage);
      if (stage) b.classList.add('wobble' + stage);
      b.setAttribute('aria-label', 'egg');
    }
    m.appendChild(b);
  }
  $('meadow-count').textContent = `${hatched} of ${list.words.length} friends`;
  $('sticker-count').textContent = `${state.stickers.length} sticker${state.stickers.length === 1 ? '' : 's'}`;
  $('fs-again').hidden = !(state.settings.fullscreen && !device.isFullscreen() && !device.isInstalled() && device.fullscreenSupported());
}
$('page-prev').addEventListener('click', () => { audio.chime.whoosh(); page--; renderHome(); });
$('page-next').addEventListener('click', () => { audio.chime.whoosh(); page++; renderHome(); });
$('fs-again').addEventListener('click', async () => { await device.enterFullscreen(); renderHome(); });
device.onFullscreenChange(() => { if (!$('home').hidden) renderHome(); if (!$('settings-screen').hidden) renderSettings(); });
$('stickers-btn').addEventListener('click', () => go('stickers'));

// Grown-up gate: hold the gear for 3 s.
{
  // Android Chrome can turn a long press into its own gesture (pointercancel), so the gear has
  // touch-action: none and captures the pointer; a short tap explains what to do.
  const gear = $('gear');
  let t = null, downAt = 0, tipTimer = null;
  const tip = $('gear-tip');
  const cancel = () => {
    clearTimeout(t);
    t = null;
    gear.classList.remove('holding');
    if (downAt && performance.now() - downAt < 2800) {
      tip.hidden = false;
      clearTimeout(tipTimer);
      tipTimer = setTimeout(() => { tip.hidden = true; }, 2500);
    }
    downAt = 0;
  };
  gear.addEventListener('pointerdown', e => {
    e.preventDefault();
    try { gear.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    tip.hidden = true;
    downAt = performance.now();
    gear.classList.add('holding');
    t = setTimeout(() => { downAt = 0; cancel(); go('settings'); }, 3000);
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => gear.addEventListener(ev, () => { if (t) cancel(); }));
  gear.addEventListener('contextmenu', e => e.preventDefault());
}

$('play').addEventListener('click', async () => {
  audio.unlock();
  if (state.settings.fullscreen) await device.enterFullscreen();
  startSession('learn');
});

// ---------------------------------------------------------------- play

function entries() {
  return activeWords(state.settings.lists);
}

function startSession(kind) {
  mode = kind;
  const ents = entries();
  let queue, clash;
  if (kind === 'meet') {
    queue = ents.filter(e => !state.words[e.word]?.headStart && levelOf(e.word) === 0).map(e => e.word);
    if (!queue.length) { go('settings'); return; }
  } else {
    const built = buildSession({
      records: state.words, entries: ents, now: Date.now(),
      length: CONFIG.sessionLength[state.settings.sessionLength] || CONFIG.sessionLength.normal,
    });
    queue = built.queue;
    clash = built.clash;
  }
  session = new Session({ queue, clash, retries: kind !== 'meet', isSure: w => levelOf(w) >= 3 });
  sessionStats = { cards: 0, correct: 0, fast: 0, hatched: [], levelOnes: ents.filter(e => levelOf(e.word) === 1).length };
  undoStack = [];
  audio.preload([...new Set(queue)].flatMap(w => [wordId(w), sentenceId(w)]));
  renderMeter();
  if (state.settings.wakeLock) device.keepAwake(true);
  go('play');
  showCard();
}

function renderMeter(full = false) {
  const m = $('meter');
  m.innerHTML = '';
  for (let i = 0; i < CONFIG.meterBands; i++) {
    const b = document.createElement('i');
    const on = full || i < state.meter;
    if (on) b.className = 'on';
    const tile = art(on ? `meter-${i + 1}` : 'meter-empty');
    // Inline so the per-colour CSS fallback (a `background:` shorthand) can't wipe the felt patch.
    if (tile) { b.style.background = `url(${tile}) center / 100% 100% no-repeat`; b.classList.add('felt'); }
    m.appendChild(b);
  }
  m.classList.toggle('full', full);
}

function setMascot(el, mood) {
  el.className = el.className.replace(/\b(idle|think|cheer|gentle)\b/g, '').trim() + ' ' + mood;
  const src = art(`mascot-${mood}`);
  if (src) el.innerHTML = img(src);
}

function clearTimers() {
  if (card) card.timers.forEach(clearTimeout);
}

function showCard() {
  if (!session) return;
  clearTimers();
  $('teach-next').hidden = true;
  $('parent-strip').hidden = false;
  $('parent-strip').classList.remove('locked');
  $('btn-undo').disabled = !undoStack.length;
  if (session.done) { endSession(); return; }
  const word = session.current;
  const level = levelOf(word);
  card = { word, level, shown: new Set(), start: performance.now(), timers: [] };
  const w = $('word');
  const text = show(word);
  w.innerHTML = `<span class="first">${text[0]}</span>${text.slice(1)}`;
  $('hint').hidden = true;
  $('card').classList.remove('teach', 'intro');
  $('card').classList.remove('pop'); void $('card').offsetWidth; $('card').classList.add('pop');
  setMascot($('play-mascot'), 'think');
  audio.chime.pop();
  $('btn-hint').disabled = mode === 'meet';
  if (mode === 'learn') {
    // A word she has never seen is modelled first, not tested (introduce()).
    if (needsIntro(state.words[word])) { introduce(word); return; }
    // Help follows the word's level, stepped up right after a miss (engine supportLevel).
    const support = supportLevel(state.words[word]);
    const plan = CONFIG.hints[support] || {};
    for (const [kind, at] of Object.entries(plan)) {
      card.timers.push(setTimeout(() => showHint(kind, support === 3 && kind === 'sparkle'), at));
    }
  }
}

function showHint(kind, faint = false) {
  if (!card) return;
  card.shown.add(kind);
  if (kind === 'sparkle') {
    const f = $('word').querySelector('.first');
    f.classList.add('sparkle');
    f.classList.toggle('faint', faint);
    if (!faint) audio.chime.twinkle();
  } else if (kind === 'sentence') {
    renderSentence(card.word);
  }
}

function renderSentence(word) {
  const e = wordEntry(word);
  if (!e) return;
  const re = new RegExp(`\\b(${word})\\b`, 'gi');
  $('hint-sentence').innerHTML = show(e.sentence).replace(re, m => `<b>${m}</b>`);
  const pic = art(`sentence-${word.toLowerCase()}`);
  // No sentence picture yet: show only the sentence (the word's creature would mislead).
  $('hint-art').innerHTML = pic ? img(pic) : '';
  $('hint-art').hidden = !pic;
  $('hint-sentence').onclick = () => audio.say(sentenceId(word), e.sentence);
  $('hint').hidden = false;
}

// Manual hint: next one not shown yet (sparkle, then sentence, then say it).
$('btn-hint').addEventListener('click', () => {
  if (!card || mode === 'meet') return;
  if (!card.shown.has('sparkle')) showHint('sparkle');
  else if (!card.shown.has('sentence')) showHint('sentence');
  else sayWord();
});
$('btn-say').addEventListener('click', sayWord);
function sayWord() {
  if (!card) return;
  card.shown.add('say');
  audio.say(wordId(card.word), card.word);
}

['notyet', 'got', 'fast'].forEach(r => $(`btn-${r}`).addEventListener('click', () => answer(r)));

function answer(result) {
  if (!card || busy) return;
  busy = true;
  clearTimers();
  audio.chime.tap();
  const { word } = card;
  const hinted = card.shown.size > 0;
  const ms = performance.now() - card.start;
  const rec = record(state, word);
  undoStack.push({
    word, rec: structuredClone(rec), meter: state.meter, hatched: state.hatched.slice(),
    stats: structuredClone(sessionStats),
    session: { queue: session.queue.slice(), index: session.index, retries: { ...session.retries }, correct: [...session.correctWords], extraEnd: session.extraEnd, results: session.results.slice() },
  });
  if (undoStack.length > 5) undoStack.shift();

  let hatchedNow = false;
  let change = null;
  if (mode === 'meet') {
    applyPlacement(rec, result, Date.now(), sessionStats.levelOnes);
    if (rec.level === 1 && result === 'notyet') sessionStats.levelOnes++;
  } else {
    const res = applyResult(rec, result, { hinted, ms, now: Date.now() });
    change = { word, before: res.before, after: res.after };
    if (res.hatched && !state.hatched.includes(word)) {
      state.hatched.push(word);
      sessionStats.hatched.push(word);
      hatchedNow = true;
    }
  }
  session.answer(result);
  if (mode === 'learn' && result === 'notyet' && session.missCount[word] >= CONFIG.restAfterMisses) {
    restWord(rec, Date.now());
    session.rest(word);
  }
  sessionStats.cards++;
  persist();

  if (result === 'notyet') {
    teach(word);
  } else {
    sessionStats.correct++;
    if (result === 'fast' && !hinted) sessionStats.fast++;
    celebrate(result === 'fast' && !hinted, hatchedNow, change);
  }
}

// ---------------------------------------------------------------- egg progress + hatching

// Egg look by level (same as the meadow): plain → spotted → cracked → hatching.
const eggStage = lvl => (lvl >= 3 ? 3 : lvl >= 2 ? 2 : lvl >= 1 ? 1 : 0);

// After a correct card: the word's egg pops up with its progress dots (4 to hatch).
// A level gained shows the old egg turning into the new one. Hatched words show their creature.
function eggPop({ word, before, after, hatching = false }) {
  const pop = $('egg-pop');
  const pic = $('egg-pop-pic');
  const dots = $('egg-dots');
  const hatched = state.hatched.includes(word) && !hatching;
  const up = after > before;
  pic.className = 'egg-pop-pic';
  if (hatched) {
    pic.innerHTML = creatureFor(word);
    pic.classList.add('friend-bounce');
    if (after >= 5) pic.classList.add('crowned');
  } else {
    pic.innerHTML = eggFor(eggStage(up ? before : after));
    pic.classList.add('wobble' + Math.max(1, eggStage(after)));
  }
  const filled = Math.min(after, 4);
  const dotOn = art('dot-on'), dotOff = art('dot-off');
  dots.classList.toggle('felt', Boolean(dotOn && dotOff));
  dots.innerHTML = Array.from({ length: 4 }, (_, i) =>
    `<i class="${i < filled ? 'on' : ''}${up && i === filled - 1 && !hatched ? ' new' : ''}"></i>`).join('');
  dots.hidden = hatched;
  pop.hidden = false;
  pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show');
  if (up && !hatched) {
    setTimeout(() => {
      pic.innerHTML = eggFor(eggStage(after));
      pic.classList.add('grow');
      audio.chime.twinkle();
    }, 420);
  }
  return up ? 1500 : 1150;
}

function hideEggPop() {
  $('egg-pop').hidden = true;
}

// The big moment: the egg shakes, cracks open with a flash, and the creature bounces out.
function hatchShow(word) {
  return new Promise(resolve => {
    const h = $('hatch');
    const egg = $('hatch-egg');
    const friend = $('hatch-friend');
    const top = art('hatch-shell-top'), bottom = art('hatch-shell-bottom');
    egg.innerHTML = top && bottom
      ? `<img class="shell-bottom" src="${bottom}" alt=""><img class="shell-top" src="${top}" alt="">`
      : eggFor(3);
    egg.classList.toggle('halves', Boolean(top && bottom));
    const glow = art('hatch-glow');
    $('hatch-glow').innerHTML = glow ? img(glow) : '';
    const shards = [1, 2, 3, 4, 5].map(i => art(`hatch-shard-${i}`)).filter(Boolean);
    $('hatch-shards').innerHTML = shards.map(src => `<span>${img(src)}</span>`).join('');
    friend.innerHTML = creatureFor(word);
    $('hatch-word').textContent = show(word);
    $('hatch-done').hidden = true;
    h.className = 'hatch';
    h.hidden = false;
    music.duck(true);
    audio.chime.drumroll();
    void h.offsetWidth;
    h.classList.add('shaking');
    setTimeout(() => {
      h.classList.add('open');
      audio.chime.fanfare();
      burst(['✨', '💖', '⭐', '🌈', '🎉'], 26, $('hatch-burst'));
    }, 1700);
    setTimeout(async () => {
      $('hatch-done').hidden = false;
      await audio.say('hatched', 'A new friend hatched!');
      if (!h.hidden) audio.say(wordId(word), word);
    }, 2300);
    $('hatch-done').onclick = () => {
      audio.stop();
      music.duck(false);
      h.hidden = true;
      resolve();
    };
  });
}

function celebrate(fast, hatchedNow, change) {
  setMascot($('play-mascot'), 'cheer');
  fast ? audio.chime.fast() : audio.chime.correct();
  burst(fast ? ['⚡', '⭐', '✨'] : ['⭐', '💖', '✨']);
  state.meter++;
  let full = false;
  if (state.meter >= CONFIG.meterBands) { state.meter = 0; full = true; }
  persist();
  renderMeter(full);
  if (full) { audio.chime.rainbow(); burst(['🌈', '✨', '💖', '⭐'], 18); }
  // A voice cheer now and then, not on every card (never over a hatching).
  if (full && !hatchedNow) audio.say('rainbow-full', 'A whole rainbow!');
  else if (!hatchedNow && Math.random() < 0.35) { const t = pick(fast ? FAST_CHEERS : CHEERS); audio.say(cheerId(t), t); }
  // Stale if the parent stopped or undid meanwhile (Undo/Quit replace the session state).
  const s = session, token = ++celebrationToken;
  const next = () => {
    if (session !== s || token !== celebrationToken) return;
    hideEggPop(); busy = false; if (full) renderMeter(); showCard();
  };
  if (hatchedNow) {
    // Show the cracked egg for a beat, then the hatching takes over the screen.
    eggPop({ ...change, before: 3, after: 3, hatching: true });
    setTimeout(() => {
      if (session !== s || token !== celebrationToken) return;
      hideEggPop(); hatchShow(change.word).then(next);
    }, 900);
    return;
  }
  const wait = change ? eggPop(change) : 900;
  setTimeout(next, Math.max(wait, full ? 1500 : 0));
}

// Not yet: show the word with its sentence, say it, let her repeat, then the parent taps Next.
async function teach(word) {
  setMascot($('play-mascot'), 'gentle');
  audio.chime.gentle();
  $('card').classList.add('teach');
  $('word').querySelector('.first').classList.remove('sparkle');
  renderSentence(word);
  $('parent-strip').hidden = true;
  $('teach-next').hidden = false;
  busy = false;
  const t = pick(NOT_YET);
  // The word on its own, then in its sentence (owner, 2026-10-26). Stops if the parent moves on.
  const still = () => card?.word === word && !$('teach-next').hidden;
  const pause = ms => new Promise(r => setTimeout(r, ms));
  await audio.say(cheerId(t), t);
  if (still()) await audio.say(wordId(word), word);
  if (still()) await pause(450);
  if (still()) await spellRead(word, still);
  if (still()) await pause(300);
  const entry = wordEntry(word);
  if (still() && entry) await audio.say(sentenceId(word), entry.sentence);
}

// Spell–read: each letter lights up as its name is said, then the whole word ("w – a – s… was").
// Tying the letters to the word is what makes irregular words stick.
async function spellRead(word, still) {
  const letters = [...show(word)];
  const w = $('word');
  w.innerHTML = letters.map(ch => `<span class="ltr">${ch}</span>`).join('');
  const spans = [...w.querySelectorAll('.ltr')];
  for (let i = 0; i < letters.length && still(); i++) {
    spans.forEach((s, j) => s.classList.toggle('lit', j === i));
    await audio.say(letterId(letters[i]), letters[i].toUpperCase());
    await new Promise(r => setTimeout(r, 120));
  }
  if (!still()) return;
  spans.forEach(s => s.classList.add('lit'));
  await audio.say(wordId(word), word);
  spans.forEach(s => s.classList.remove('lit'));
}

// A brand-new word: shown with its picture sentence, said, read in its sentence, then she says
// it back. Nothing is scored; it becomes a Learning word and is tested later this game.
async function introduce(word) {
  card.intro = true;
  setMascot($('play-mascot'), 'gentle');
  $('card').classList.add('teach', 'intro');
  renderSentence(word);
  $('parent-strip').hidden = true;
  $('teach-next').hidden = false;
  $('next').dataset.intro = '1';
  const still = () => card?.word === word && card.intro && !$('teach-next').hidden;
  await audio.say('new-word', "Here's a new word!");
  if (still()) await audio.say(wordId(word), word);
  if (still()) await new Promise(r => setTimeout(r, 350));
  const entry = wordEntry(word);
  if (still() && entry) await audio.say(sentenceId(word), entry.sentence);
  if (still()) await audio.say('your-turn', 'Your turn! Can you say it?');
}
$('next').addEventListener('click', () => {
  audio.stop();
  if ($('next').dataset.intro === '1' && card?.intro) {
    delete $('next').dataset.intro;
    undoStack.push({
      word: card.word, rec: structuredClone(record(state, card.word)), meter: state.meter, hatched: state.hatched.slice(),
      stats: structuredClone(sessionStats),
      session: { queue: session.queue.slice(), index: session.index, retries: { ...session.retries }, correct: [...session.correctWords], extraEnd: session.extraEnd, results: session.results.slice() },
    });
    applyIntro(record(state, card.word), Date.now());
    session.answer('intro');
    persist();
  }
  delete $('next').dataset.intro;
  showCard();
});

$('btn-undo').addEventListener('click', () => {
  const u = undoStack.pop();
  if (!u) return;
  celebrationToken++;
  hideEggPop();
  audio.stop();
  state.words[u.word] = u.rec;
  state.meter = u.meter;
  state.hatched = u.hatched;
  sessionStats = u.stats;
  Object.assign(session, {
    queue: u.session.queue, index: u.session.index, retries: u.session.retries,
    correctWords: new Set(u.session.correct), extraEnd: u.session.extraEnd, results: u.session.results,
  });
  persist();
  busy = false;
  renderMeter();
  showCard();
});

$('quit').addEventListener('click', async () => {
  const keep = sessionStats.cards;
  if (!(await confirmBox(keep ? 'Stop now? Progress so far is saved.' : 'Stop now?'))) return;
  clearTimers();
  celebrationToken++;
  hideEggPop();
  audio.stop();
  device.keepAwake(false);
  card = null;
  session = null;
  busy = false;
  go(mode === 'meet' ? 'settings' : 'home');
});

// Emoji → felt confetti piece (used once the fx-* art exists).
const FX = { '⭐': 'fx-star', '💖': 'fx-heart', '✨': 'fx-sparkle', '⚡': 'fx-bolt', '🌈': 'fx-rainbow', '🎉': 'fx-flower', '🌸': 'fx-flower', '🟢': 'fx-pompom' };

function burst(symbols, n = 10, host = $('burst')) {
  const b = host;
  for (let i = 0; i < n; i++) {
    const s = document.createElement('span');
    const sym = symbols[i % symbols.length];
    const felt = art(FX[sym]);
    if (felt) s.innerHTML = img(felt); else s.textContent = sym;
    const a = Math.random() * Math.PI * 2, d = 120 + Math.random() * 120;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
    s.style.setProperty('--rot', `${(Math.random() - 0.5) * 120}deg`);
    b.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

// ---------------------------------------------------------------- end

function endSession() {
  clearTimers();
  card = null;
  device.keepAwake(false);
  if (mode === 'meet') { go('settings'); return; }
  const sticker = STICKERS[state.stickers.length % STICKERS.length];
  state.stickers.push({ t: Date.now(), id: sticker });
  state.sessions.push({ t: Date.now(), cards: sessionStats.cards, correct: sessionStats.correct, fast: sessionStats.fast });
  if (state.sessions.length > 400) state.sessions.splice(0, state.sessions.length - 400);
  persist();
  $('end-title').textContent = pick(['Great reading!', 'You did it!', 'Super reading!']);
  $('end-sticker').textContent = sticker;
  $('end-hatched').innerHTML = sessionStats.hatched.length
    ? `New friend${sessionStats.hatched.length > 1 ? 's' : ''}! ${sessionStats.hatched.map(w => `<span class="new">${creatureFor(w)}</span>`).join(' ')}`
    : '';
  go('end');
  setMascot($('end-mascot'), 'cheer');
  // Hatches were already celebrated as they happened; the end screen is about the sticker.
  audio.chime.sticker();
  audio.say('sticker', 'You earned a sticker!');
}
$('end-done').addEventListener('click', () => { audio.stop(); go('home'); });

function renderStickers() {
  $('sticker-grid').innerHTML = state.stickers.map(s => `<span>${s.id}</span>`).join('') || '<p>Finish a game to earn a sticker!</p>';
}

// ---------------------------------------------------------------- grown-up: head start

function renderSetup() {
  const host = $('setup-lists');
  host.innerHTML = '';
  for (const list of LISTS.filter(l => state.settings.lists.includes(l.id))) {
    const g = document.createElement('div');
    g.className = 'list-group';
    g.innerHTML = `<h3>${list.name}</h3>`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const e of list.words) {
      const c = document.createElement('button');
      const rec = state.words[e.word];
      c.className = 'chip' + (rec?.headStart ? ' on' : '');
      c.innerHTML = `${show(e.word)}<span class="dot lv${rec?.level ?? 0}"></span>`;
      c.addEventListener('click', () => {
        const r = record(state, e.word);
        if (r.headStart) unmarkHeadStart(r); else markHeadStart(r, Date.now());
        persist();
        renderSetup();
      });
      chips.appendChild(c);
    }
    g.appendChild(chips);
    host.appendChild(g);
  }
  $('setup-back').hidden = !state.setupDone;
}
$('setup-done').addEventListener('click', () => {
  const first = !state.setupDone;
  state.setupDone = true;
  persist();
  go(first ? 'home' : 'settings');
});
$('setup-back').addEventListener('click', () => go('settings'));

// ---------------------------------------------------------------- grown-up: settings

function renderSettings() {
  const s = state.settings;
  $('set-fullscreen').checked = s.fullscreen;
  $('set-fullscreen').disabled = !device.fullscreenSupported();
  $('fs-note').textContent = !device.fullscreenSupported() ? 'This browser can\'t go full screen.'
    : device.isInstalled() ? 'Opened from the home screen icon, so it\'s already full screen.'
    : s.fullscreen && !device.isFullscreen() ? 'Full screen was left (Back or a swipe). Tap Play or ⛶ to return.' : '';
  $('set-wake').checked = s.wakeLock;
  $('wake-note').textContent = device.wakeLockSupported() ? ''
    : 'Not available at this address (needs https). The screen may dim during a game.';
  $('set-volume').value = s.voiceVolume;
  $('set-effects').checked = s.effects;
  $('set-music').checked = s.music;
  document.querySelectorAll('#set-length button').forEach(b => b.classList.toggle('on', b.dataset.len === s.sessionLength));
  const lists = $('set-lists');
  lists.innerHTML = '';
  for (const l of LISTS) {
    const c = document.createElement('button');
    c.className = 'chip' + (s.lists.includes(l.id) ? ' on' : '');
    c.style.fontSize = '1rem';
    c.textContent = `${l.name} (${l.words.length})`;
    c.addEventListener('click', () => {
      if (s.lists.includes(l.id)) { if (s.lists.length > 1) s.lists = s.lists.filter(x => x !== l.id); }
      else s.lists = [...s.lists, l.id];
      persist();
      renderSettings();
    });
    lists.appendChild(c);
  }
  // version.json exists only in the published copy (deploy-pages.mjs writes it).
  if (location.hostname.endsWith('github.io')) {
    fetch('version.json', { cache: 'no-store' }).then(r => r.json())
      .then(v => { $('version').textContent = `Version ${v.version} · updated ${v.built}`; }).catch(() => {});
  } else $('version').textContent = 'Version: local copy';
  const meetLeft = entries().filter(e => !state.words[e.word]?.headStart && levelOf(e.word) === 0).length;
  $('start-meet').disabled = meetLeft === 0;
}

$('set-fullscreen').addEventListener('change', async e => {
  state.settings.fullscreen = e.target.checked;
  persist();
  if (e.target.checked) await device.enterFullscreen(); else await device.exitFullscreen();
  renderSettings();
});
$('set-wake').addEventListener('change', e => { state.settings.wakeLock = e.target.checked; persist(); });
$('set-volume').addEventListener('input', e => { state.settings.voiceVolume = Number(e.target.value); audio.configure(state.settings); persist(); });
$('set-volume').addEventListener('change', () => audio.say('word-the', 'the'));
$('set-music').addEventListener('change', e => { state.settings.music = e.target.checked; persist(); audio.unlock(); music.setEnabled(e.target.checked); });
$('set-effects').addEventListener('change', e => { state.settings.effects = e.target.checked; audio.configure(state.settings); persist(); audio.chime.correct(); });
document.querySelectorAll('#set-length button').forEach(b => b.addEventListener('click', () => { state.settings.sessionLength = b.dataset.len; persist(); renderSettings(); }));
$('start-meet').addEventListener('click', () => { audio.unlock(); startSession('meet'); });

$('export').addEventListener('click', () => {
  const blob = new Blob([exportText(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sightwords-backup-${dayKey(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const next = importText(await file.text());
    if (!(await confirmBox('Replace the progress on this phone with this backup?'))) return;
    state = next;
    persist();
    audio.configure(state.settings);
    music.setEnabled(state.settings.music);
    renderSettings();
  } catch (err) {
    await confirmBox(err.message);
  }
});
$('reset-all').addEventListener('click', async () => {
  if (!(await mathCheck('Erase all progress, friends and stickers? This can\'t be undone (unless you saved a backup).'))) return;
  const settings = state.settings;
  state = { ...defaultState(), settings };
  persist();
  go('setup');
});

// ---------------------------------------------------------------- grown-up: progress

function renderProgress() {
  const ents = entries();
  const weekAgo = Date.now() - 7 * 864e5;
  const week = state.sessions.filter(s => s.t >= weekAgo);
  const known = ents.filter(e => levelOf(e.word) >= 4).length;
  $('progress-week').textContent = `This week: ${week.length} game${week.length === 1 ? '' : 's'}, ${week.reduce((n, s) => n + s.cards, 0)} cards. `
    + `Known: ${known} of ${ents.length} words.`;
  $('progress-ready').hidden = !(known / ents.length >= 0.8 && LISTS.some(l => !state.settings.lists.includes(l.id)));
  const grid = $('progress-grid');
  grid.innerHTML = '';
  const order = ents.slice().sort((a, b) => levelOf(a.word) - levelOf(b.word) || (state.words[b.word]?.misses ?? 0) - (state.words[a.word]?.misses ?? 0));
  for (const e of order) {
    const r = state.words[e.word] || newRecord();
    const times = r.history.filter(h => h.r !== 'notyet').map(h => h.ms);
    const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1) + ' s' : '—';
    const last = r.lastSeen ? new Date(r.lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'never';
    const b = document.createElement('button');
    b.className = 'prog';
    b.innerHTML = `<b>${show(e.word)}${r.headStart ? ' ⭐' : ''}</b><span class="lvl lv${r.level}">${LEVEL_NAMES[r.level]}</span><br>`
      + `missed ${r.misses} · avg ${avg}<br>last seen ${last}`;
    b.addEventListener('click', async () => {
      if (!(await mathCheck(`Reset "${show(e.word)}" to New?`))) return;
      delete state.words[e.word];
      state.hatched = state.hatched.filter(w => w !== e.word);
      persist();
      renderProgress();
    });
    grid.appendChild(b);
  }
}

// ---------------------------------------------------------------- boot

audio.configure(state.settings);
audio.onVoice(on => music.duck(on));
for (const s of SCREENS) $(s).hidden = true;
document.querySelectorAll('.mascot').forEach(m => setMascot(m, (m.className.match(/\b(idle|think|cheer|gentle)\b/) || [, 'idle'])[1]));
if (art('meadow-bg')) document.body.classList.add('has-meadow');
// Felt button icons from Codex replace the glyphs once they exist.
document.querySelectorAll('[data-icon]').forEach(el => {
  const src = art(el.dataset.icon);
  if (src) { el.innerHTML = img(src); el.classList.add('felt'); }
});
if (art('hatch-bg')) $('hatch').classList.add('felt-bg');
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.__sightwords = { get state() { return state; } }; // for the smoke test
