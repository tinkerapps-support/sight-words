// Screens and wiring. The learning rules live in engine.js; this file only drives the UI.
import { CONFIG, LEVEL_NAMES } from './config.js';
import { applyResult, applyPlacement, buildSession, Session, markHeadStart, unmarkHeadStart, newRecord, dayKey, needsIntro, applyIntro, supportLevel, restWord, hatchProgress, HATCH_STEPS, nextStep, cardKind, applyPop, applyBuild, paceLevel, PACE_NAMES, nextFreshWord, bubbleCount } from './engine.js';
import { LISTS, activeWords, wordEntry } from './lists.js';
import { load, save, record, exportText, importText, defaultState, mergeStates } from './storage.js';
import { syncInfo, syncNow, newCode, setCode, clearCode, normalizeCode, codeLooksValid } from './sync.js';
import * as audio from './audio.js';
import * as music from './music.js';
import { wordId, sentenceId, cheerId, letterId, clozeParts, CHEERS, FAST_CHEERS, NOT_YET } from './voice-lines.js';
import { TIMINGS } from './voice-timings.js';
import * as device from './device.js';
import { art } from './art.js';
import { popCard, buildCard, clear as clearTask } from './games.js';
import { showPets, stopPets, call as callPets, petState } from './pets.js';
import { initCheck, startCheck, checkReady, checkWord } from './check.js';
import { wordStats, setSummary } from './report.js';

const $ = id => document.getElementById(id);
// Everything she reads is lowercase except the word "I" (owner, 2026-10-26). Data and voice keep normal case.
const show = text => text.toLowerCase().replace(/\bi\b/g, 'I');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Placeholder creatures until Codex's art lands: one per word, by list position.
const CREATURES = ['🐰', '🐱', '🐹', '🐲', '🐸', '🦊', '🐦', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐵', '🐧', '🐤', '🦉', '🦋', '🐢', '🐙', '🦔', '🐿️', '🐳', '🦄'];
// Sticker N (1-20) is Codex's sticker-NN art; the emoji is the fallback and matches its subject.
const STICKERS = ['🌈', '⭐', '🦄', '🌸', '🍓', '🧁', '🎀', '💖', '🌟', '🍭', '🦋', '🌷', '🍩', '🎈', '🐚', '🌙', '☁️', '🍦', '🪄', '👑'];
const STICKER_PAGE = 20;
// Older saves stored only the emoji; map it back to its number.
const stickerNum = s => s.n || STICKERS.indexOf(s.id) + 1 || 1;
const stickerHtml = n => {
  const src = art(`sticker-${String(n).padStart(2, '0')}`);
  return src ? img(src) : STICKERS[(n - 1) % STICKERS.length];
};

let state = load();
let page = 0;              // which list's meadow is showing
let mode = 'learn';        // 'learn' | 'meet'
let session = null;
let card = null;           // { word, level, shown: Set, start, timers: [] }
let undoStack = [];
let sessionStats = null;
let busy = false;
let celebrationToken = 0;  // bumped by Undo/Quit so a pending celebration doesn't advance
let readToken = 0;         // bumped to stop a sentence being read (new card, new reading)
let lockHolds = 0;         // >0 keeps the next step locked between voice lines (a cloze pause)

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

const SCREENS = ['home', 'play-screen', 'check-screen', 'guide-screen', 'end-screen', 'sticker-screen', 'setup-screen', 'settings-screen', 'progress-screen'];
function go(name) {
  const id = { setup: 'setup-screen', settings: 'settings-screen', progress: 'progress-screen', guide: 'guide-screen', stickers: 'sticker-screen', play: 'play-screen', check: 'check-screen', end: 'end-screen' }[name] || name;
  for (const s of SCREENS) $(s).hidden = s !== id;
  if (id !== 'home') stopPets();
  if (id === 'home') renderHome();
  if (id === 'home' || id === 'settings-screen') doSync();
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

// Typing in a sync code from another device.
function codeEntry() {
  return new Promise(resolve => {
    $('confirm-text').textContent = 'Enter the sync code from the other device. Progress on this device will be combined with it (nothing is lost).';
    $('code-input').value = '';
    $('code-wrong').hidden = true;
    $('code-entry').hidden = false;
    $('confirm').hidden = false;
    $('code-input').focus();
    const finish = v => {
      $('confirm').hidden = true;
      $('code-entry').hidden = true;
      $('confirm-yes').onclick = $('confirm-no').onclick = $('code-input').onkeydown = null;
      resolve(v);
    };
    const check = () => {
      const code = normalizeCode($('code-input').value);
      if (codeLooksValid(code)) finish(code); else $('code-wrong').hidden = false;
    };
    $('confirm-yes').onclick = check;
    $('code-input').onkeydown = e => { if (e.key === 'Enter') check(); };
    $('confirm-no').onclick = () => finish(null);
  });
}

// ---------------------------------------------------------------- sync between devices

// Never while a game or Word Check is running (their screens hold the state they started with).
const playing = () => Boolean(session) || !$('play-screen').hidden || !$('check-screen').hidden;
let lastSyncTry = 0;
async function doSync(force = false) {
  if (!syncInfo().code || playing()) return;
  if (!force && Date.now() - lastSyncTry < 4000) return;
  lastSyncTry = Date.now();
  renderSyncBox('Syncing…');
  try {
    const merged = await syncNow(state);
    // Merge again with this device's current state, so taps made while syncing aren't lost.
    if (merged && !playing()) {
      const { settings, ...shared } = merged;
      state = mergeStates(state, shared);
      persist();
      if (!$('home').hidden) renderHome();
      if (!$('progress-screen').hidden) renderProgress();
      if (!$('sticker-screen').hidden) renderStickers();
    }
  } catch { /* the status line shows the error; it retries next time */ }
  renderSyncBox();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') doSync(); });

function renderSyncBox(status) {
  const info = syncInfo();
  $('sync-off').hidden = Boolean(info.code);
  $('sync-on').hidden = !info.code;
  if (!info.code) return;
  $('sync-code').textContent = info.code;
  const when = info.lastSync ? new Date(info.lastSync).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'not yet';
  $('sync-status').textContent = status || (info.lastError ? `Couldn't sync (${info.lastError}). It will try again. Last synced: ${when}.` : `Last synced: ${when}.`);
}
$('sync-create').addEventListener('click', () => { setCode(newCode()); doSync(true); renderSyncBox(); });
$('sync-enter').addEventListener('click', async () => {
  const code = await codeEntry();
  if (!code) return;
  setCode(code);
  renderSyncBox();
  await doSync(true);
});
$('sync-now').addEventListener('click', () => doSync(true));
$('sync-stop').addEventListener('click', async () => {
  if (!(await confirmBox('Stop syncing on this device? Its progress stays here; the other devices keep syncing.'))) return;
  clearCode();
  renderSyncBox();
});

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
  const friends = [];
  for (const e of list.words) {
    const lvl = levelOf(e.word);
    const isHatched = state.hatched.includes(e.word);
    // A hatched friend leaves its spot and roams the meadow (pets.js); the spot stays as grass.
    const b = document.createElement(isHatched ? 'span' : 'button');
    b.className = 'friend' + (isHatched ? ' spot' : '');
    if (isHatched) {
      hatched++;
      friends.push(e.word);
    } else {
      const stage = lvl >= 3 ? 3 : lvl >= 2 ? 2 : lvl >= 1 ? 1 : 0;
      b.innerHTML = eggFor(stage);
      if (stage) b.classList.add('wobble' + stage);
      b.setAttribute('aria-label', 'egg');
      b.addEventListener('click', () => showEggInfo(e.word));
    }
    m.appendChild(b);
  }
  $('meadow-count').textContent = `${hatched} of ${list.words.length} friends`;
  $('check-btn').hidden = !checkReady();
  // Wait a frame so the meadow has its size before friends are placed in it.
  requestAnimationFrame(() => {
    if ($('home').hidden) return;
    showPets($('pet-layer'), friends, {
      html: creatureFor,
      crowned: w => levelOf(w) >= 5,
      heart: () => (art('fx-heart') ? img(art('fx-heart')) : '💖'),
    });
  });
  $('sticker-count').textContent = `${state.stickers.length} sticker${state.stickers.length === 1 ? '' : 's'}`;
  $('fs-again').hidden = !(state.settings.fullscreen && !device.isFullscreen() && !device.isInstalled() && device.fullscreenSupported());
}
// A tap on the grass (not an egg or a friend) calls the friends over.
$('meadow-wrap').addEventListener('click', e => {
  if (e.target.closest('button.friend, .pet')) return;
  callPets(e.clientX, e.clientY);
});
$('check-btn').addEventListener('click', async () => {
  audio.unlock();
  if (state.settings.fullscreen) await device.enterFullscreen();
  startCheck();
});
$('page-prev').addEventListener('click', () => { audio.chime.whoosh(); page--; renderHome(); });
$('page-next').addEventListener('click', () => { audio.chime.whoosh(); page++; renderHome(); });
$('fs-again').addEventListener('click', async () => { await device.enterFullscreen(); renderHome(); });
device.onFullscreenChange(() => { if (!$('home').hidden) renderHome(); if (!$('settings-screen').hidden) renderSettings(); });
$('stickers-btn').addEventListener('click', () => { bookPage = null; go('stickers'); });

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
  const pace = paceLevel(state.words, Date.now());
  if (kind === 'meet') {
    queue = ents.filter(e => !state.words[e.word]?.headStart && levelOf(e.word) === 0).map(e => e.word);
    if (!queue.length) { go('settings'); return; }
  } else {
    const built = buildSession({
      records: state.words, entries: ents, now: Date.now(),
      length: CONFIG.sessionLength[state.settings.sessionLength] || CONFIG.sessionLength.normal, pace,
    });
    queue = built.queue;
    clash = built.clash;
  }
  session = new Session({ queue, clash, retries: kind !== 'meet', isSure: w => levelOf(w) >= 3 && cardKind(state.words[w], () => 1) === 'read' });
  sessionStats = { pace, topUps: 0, cards: 0, correct: 0, fast: 0, hatched: [], levelOnes: ents.filter(e => levelOf(e.word) === 1).length };
  undoStack = [];
  audio.preload([...new Set(queue)].flatMap(w => [wordId(w), sentenceId(w)]));
  renderMeter();
  if (state.settings.wakeLock) device.keepAwake(true);
  sessionStats.told = {};   // the Bubble Pop / Build It how-to line is said once per game
  go('play');
  // A brand-new word opens with its own intro lines; otherwise greet the game (card voices wait for it).
  if (kind === 'learn' && !needsIntro(state.words[session.current])) audio.say('session-start', "Let's read some words!");
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
  readToken++;
  $('teach-next').hidden = true;
  delete $('next').dataset.intro; // left over if the parent stopped during an intro card
  $('parent-strip').hidden = false;
  // (No unlock here: the strip stays locked while a voice line is still playing.)
  $('btn-undo').disabled = !undoStack.length;
  if (session.done) { endSession(); return; }
  const word = session.current;
  const level = levelOf(word);
  card = { word, level, shown: new Set(), start: performance.now(), timers: [] };
  // Which card: Bubble Pop while Learning, reading in the middle, Build It once hatched.
  card.kind = mode === 'meet' ? 'read' : cardKind(state.words[word]);
  clearTask();
  $('task').hidden = $('task-bar').hidden = true;
  $('card').hidden = false;
  if (card.kind === 'pop' || card.kind === 'build') { showTask(card); return; }
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
    // Read it as a hint: the voice pauses where the word goes, so she reads that part herself.
    // Waits for any line already playing (the game's greeting) instead of cutting it off.
    const mine = card;
    if (mode === 'learn') audio.idle().then(() => {
      if (card === mine && !busy && !$('card').classList.contains('teach')) readSentence(mine.word, { cloze: true });
    });
  }
}

function renderSentence(word) {
  const e = wordEntry(word);
  if (!e) return;
  // One span per word so the reader can light each up; the target word is bold.
  const isTarget = tok => tok.replace(/[^a-z]/gi, '').toLowerCase() === word.toLowerCase();
  $('hint-sentence').innerHTML = e.sentence.split(/\s+/)
    .map(tok => `<span class="tok${isTarget(tok) ? ' target' : ''}">${show(tok)}</span>`).join(' ');
  const pic = art(`sentence-${word.toLowerCase()}`);
  // No sentence picture yet: show only the sentence (the word's creature would mislead).
  $('hint-art').innerHTML = pic ? img(pic) : '';
  $('hint-art').hidden = !pic;
  // Before she answers, a tap reads it with the gap; while teaching, the whole sentence.
  $('hint-sentence').onclick = () => readSentence(word, { cloze: !$('card').classList.contains('teach') });
  $('hint').hidden = false;
}

// ---------------------------------------------------------------- Bubble Pop / Build It cards

function showTask(c) {
  const { word, kind } = c;
  $('card').hidden = true;
  $('task').hidden = $('task-bar').hidden = false;
  $('pop-area').hidden = kind !== 'pop';
  $('build-area').hidden = kind !== 'build';
  $('parent-strip').hidden = true;
  setMascot($('play-mascot'), 'think');
  audio.chime.pop();
  const onDone = firstTry => taskDone(c, firstTry);
  if (kind === 'pop') popCard({ word, entries: entries(), show, count: bubbleCount(state.words[word]), onDone, onWrong: () => setMascot($('play-mascot'), 'gentle') });
  else buildCard({ word, show, onDone });
  // How-to once per game, then the word. Waits for the greeting instead of cutting it off.
  audio.idle().then(async () => {
    if (card !== c) return;
    if (!sessionStats.told[kind]) {
      sessionStats.told[kind] = true;
      await (kind === 'pop'
        ? audio.say('pop-start', 'Pop the bubble with the word you hear!')
        : audio.say('build-start', "Let's build the word! Drag each letter into its box."));
    }
    if (card === c) audio.say(wordId(word), word);
  });
}
$('task-hear').addEventListener('click', () => { if (card) audio.say(wordId(card.word), card.word, { now: true }); });

// A Bubble Pop or Build It card is finished. A first-try pop is progress (2 in a row leave
// Learning); a pop after a wrong bubble is a miss, and the word comes back later like a Not yet.
function taskDone(c, firstTry) {
  if (card !== c || busy) return;
  busy = true;
  const { word, kind } = c;
  pushUndo(word);
  const rec = record(state, word);
  const stepBefore = hatchProgress(rec, Date.now()).step;
  const res = kind === 'pop' ? applyPop(rec, firstTry, Date.now()) : applyBuild(rec, firstTry, Date.now());
  const missed = kind === 'pop' && !firstTry;
  session.answer(missed ? 'notyet' : 'got');
  if (missed && session.missCount[word] >= CONFIG.restAfterMisses) {
    restWord(rec, Date.now());
    session.rest(word);
  }
  sessionStats.cards++;
  persist();
  if (missed) {
    // No cheer, no fuss: hear the word once more while its bubble pops, then on to an easy card.
    const s = session, token = ++celebrationToken;
    audio.say(wordId(word), word).then(() => setTimeout(() => {
      if (session !== s || token !== celebrationToken) return;
      busy = false;
      showCard();
    }, 250));
    return;
  }
  sessionStats.correct++;
  celebrate(false, false, { word, before: res.before, after: res.after, stepBefore });
}

// Manual hint: next one not shown yet (sparkle, then sentence, then say it).
$('btn-hint').addEventListener('click', () => {
  if (!card || mode === 'meet') return;
  if (!card.shown.has('sparkle')) showHint('sparkle');
  else if (!card.shown.has('sentence')) showHint('sentence');
  else sayWord();
});
$('btn-say').addEventListener('click', sayWord);
// Model, then lead: the word, then an invitation to say it back.
async function sayWord() {
  if (!card) return;
  const word = card.word;
  card.shown.add('say');
  await audio.say(wordId(word), word);
  if (card?.word === word && !busy) audio.say('say-it-again', 'Can you say it too?');
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
  pushUndo(word);

  let hatchedNow = false;
  let change = null;
  if (mode === 'meet') {
    applyPlacement(rec, result, Date.now(), sessionStats.levelOnes);
    if (rec.level === 1 && result === 'notyet') sessionStats.levelOnes++;
  } else {
    const stepBefore = hatchProgress(rec, Date.now()).step;
    const res = applyResult(rec, result, { hinted, ms, now: Date.now() });
    change = { word, before: res.before, after: res.after, stepBefore };
    if (res.before <= 2 && res.after >= 3) topUp();
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

// When she's flying (pace 1–2) and a word graduates to Almost mid-game, a new word joins right away
// instead of waiting for the next game. It replaces review cards that aren't due yet.
function topUp() {
  const P = CONFIG.pace.levels[sessionStats.pace] || CONFIG.pace.levels[0];
  if (mode !== 'learn' || sessionStats.topUps >= P.topUps || session.remaining < 5) return;
  const shaky = entries().filter(e => [1, 2].includes(levelOf(e.word))).length;
  if (shaky >= P.maxShaky) return;
  const word = nextFreshWord(state.words, entries(), new Set(session.queue));
  if (!word) return;
  const now = Date.now();
  session.addWord(word, w => levelOf(w) >= 3 && (state.words[w]?.nextDue ?? 0) > now);
  sessionStats.topUps++;
  audio.preload([wordId(word), sentenceId(word)]);
}

// ---------------------------------------------------------------- egg progress + hatching

// Egg look by level (same as the meadow): plain → spotted → cracked → hatching.
const eggStage = lvl => (lvl >= 3 ? 3 : lvl >= 2 ? 2 : lvl >= 1 ? 1 : 0);

// After a correct card: the word's egg pops up with its progress dots (4 to hatch).
// A level gained shows the old egg turning into the new one. Hatched words show their creature.
function eggPop({ word, before, after, stepBefore = 0, hatching = false }) {
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
  // One felt button per step toward hatching (engine hatchProgress); a step gained pops in.
  const prog = hatching ? { step: HATCH_STEPS - 1, waitingForTomorrow: false } : hatchProgress(state.words[word], Date.now());
  const gained = !hatching && prog.step > stepBefore;
  renderDots(dots, prog, gained);
  dots.hidden = hatched;
  // For the grown-up: why the last button won't fill today.
  $('egg-note').hidden = !prog.waitingForTomorrow || hatched;
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

// One felt button per step toward hatching (engine hatchProgress); the newest one can pop in.
function renderDots(host, prog, gained = false) {
  host.classList.toggle('felt', Boolean(art('dot-on') && art('dot-off')));
  host.innerHTML = Array.from({ length: HATCH_STEPS }, (_, i) => {
    const cls = [i < prog.step ? 'on' : '', gained && i === prog.step - 1 ? 'new' : '',
      prog.waitingForTomorrow && i === HATCH_STEPS - 1 ? 'tomorrow' : ''].filter(Boolean).join(' ');
    return `<i class="${cls}"></i>`;
  }).join('');
}

// Tapping an egg in the meadow: its word, how close it is, and what it needs next.
function showEggInfo(word) {
  const rec = state.words[word];
  const lvl = rec?.level ?? 0;
  $('egg-info-pic').innerHTML = eggFor(eggStage(lvl));
  $('egg-info-pic').className = 'egg-pop-pic' + (lvl ? ' wobble' + Math.max(1, eggStage(lvl)) : '');
  $('egg-info-word').textContent = show(word);
  renderDots($('egg-info-dots'), hatchProgress(rec, Date.now()));
  $('egg-info-next').textContent = nextStep(rec, Date.now());
  $('egg-info').hidden = false;
  audio.chime.twinkle();
  if (rec?.seen) audio.say(wordId(word), word);
}
$('egg-info-close').addEventListener('click', () => { $('egg-info').hidden = true; });
$('egg-info').addEventListener('click', e => { if (e.target === $('egg-info')) $('egg-info').hidden = true; });
$('egg-info-how').addEventListener('click', () => {
  $('egg-info').hidden = true;
  go('guide');
  $('guide-eggs').scrollIntoView();
});

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
  let cheer = Promise.resolve();
  if (full && !hatchedNow) cheer = audio.say('rainbow-full', 'A whole rainbow!');
  else if (!hatchedNow && Math.random() < 0.35) { const t = pick(fast ? FAST_CHEERS : CHEERS); cheer = audio.say(cheerId(t), t); }
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
  // The next card comes once both the egg moment and any cheer are done.
  const wait = change ? eggPop(change) : 900;
  const timer = new Promise(r => setTimeout(r, Math.max(wait, full ? 1500 : 0)));
  Promise.all([timer, cheer]).then(() => setTimeout(next, 200));
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
  if (still() && entry) await readSentence(word, { cloze: false });
}

// Reads the card's sentence, lighting up each word as it's spoken. cloze: the voice stops where
// the target word goes, that spot pulses for CONFIG.clozePauseMs while she reads it, then the
// sentence goes on. Clips: cloze-<word>-N (parts) or sentence-<word> (whole).
async function readSentence(word, { cloze }) {
  const e = wordEntry(word);
  if (!e) return;
  const mine = ++readToken;
  const still = () => readToken === mine && card?.word === word;
  const spans = [...$('hint-sentence').querySelectorAll('.tok')];
  const parts = cloze ? clozeParts(e.sentence, word) : [{ text: e.sentence, id: sentenceId(word) }];
  lockHolds++;
  applyLock();
  try {
    let k = 0;
    for (const part of parts) {
      if (!still()) break;
      if (part.gap) {
        const gap = spans[k++];
        gap?.classList.add('gap');
        await new Promise(r => setTimeout(r, CONFIG.clozePauseMs));
        gap?.classList.remove('gap');
        continue;
      }
      const n = part.text.split(/\s+/).filter(Boolean).length;
      await sayHighlighted(part.id, part.text, spans.slice(k, k + n));
      k += n;
    }
  } finally {
    spans.forEach(s => s.classList.remove('now', 'gap'));
    lockHolds--;
    applyLock();
  }
}

// Plays one clip and lights its words in turn, from Whisper word timings when we have them,
// otherwise spread over the clip by word length.
async function sayHighlighted(id, text, spans) {
  const t = TIMINGS[id];
  const timed = t && t.length === spans.length;
  const weights = spans.map(s => s.textContent.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  await audio.say(id, text, {
    onTime: (sec, dur) => {
      let idx = -1;
      if (timed) {
        if (sec >= t[0][0] - 0.05) idx = t.findIndex(([, end]) => sec < end + 0.05);
        if (idx < 0 && sec >= t[0][0]) idx = spans.length - 1;
      } else {
        const lead = 0.15, body = Math.max(0.3, (dur || 1) - 0.55);
        if (sec >= lead) {
          let acc = 0;
          idx = spans.length - 1;
          for (let i = 0; i < spans.length; i++) { acc += (weights[i] / total) * body; if (sec - lead < acc) { idx = i; break; } }
        }
      }
      spans.forEach((s, i) => s.classList.toggle('now', i === idx));
    },
  });
  spans.forEach(s => s.classList.remove('now'));
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
  if (still() && entry) await readSentence(word, { cloze: false });
  if (still()) await audio.say('your-turn', 'Your turn! Can you say it?');
}
$('next').addEventListener('click', () => {
  audio.stop();
  if ($('next').dataset.intro === '1' && card?.intro) {
    delete $('next').dataset.intro;
    pushUndo(card.word);
    applyIntro(record(state, card.word), Date.now());
    session.answer('intro');
    persist();
  }
  delete $('next').dataset.intro;
  showCard();
});

// Everything a card can change, so Undo puts it all back.
function pushUndo(word) {
  undoStack.push({
    word, rec: structuredClone(record(state, word)), meter: state.meter, hatched: state.hatched.slice(),
    stats: structuredClone(sessionStats),
    session: {
      queue: session.queue.slice(), index: session.index, retries: { ...session.retries }, correct: [...session.correctWords],
      extraEnd: session.extraEnd, results: session.results.slice(), missCount: { ...session.missCount },
    },
  });
  if (undoStack.length > 5) undoStack.shift();
}

$('btn-undo').addEventListener('click', () => {
  const u = undoStack.pop();
  if (!u) return;
  celebrationToken++;
  hideEggPop();
  audio.stop();
  clearTask();
  state.words[u.word] = u.rec;
  state.meter = u.meter;
  state.hatched = u.hatched;
  sessionStats = u.stats;
  Object.assign(session, {
    queue: u.session.queue, index: u.session.index, retries: u.session.retries,
    correctWords: new Set(u.session.correct), extraEnd: u.session.extraEnd, results: u.session.results,
    missCount: u.session.missCount,
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
  clearTask();
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
  const n = (state.stickers.length % STICKERS.length) + 1;
  state.stickers.push({ t: Date.now(), n, id: STICKERS[n - 1] });
  state.sessions.push({ t: Date.now(), cards: sessionStats.cards, correct: sessionStats.correct, fast: sessionStats.fast });
  if (state.sessions.length > 400) state.sessions.splice(0, state.sessions.length - 400);
  persist();
  $('end-title').textContent = pick(['Great reading!', 'You did it!', 'Super reading!']);
  $('end-sticker').innerHTML = stickerHtml(n);
  $('end-hatched').innerHTML = sessionStats.hatched.length
    ? `New friend${sessionStats.hatched.length > 1 ? 's' : ''}! ${sessionStats.hatched.map(w => `<span class="new">${creatureFor(w)}</span>`).join(' ')}`
    : '';
  go('end');
  setMascot($('end-mascot'), 'cheer');
  // Hatches were already celebrated as they happened; the end screen is about the sticker.
  audio.chime.sticker();
  audio.say('session-end', 'You read so many words!').then(() => {
    if (!$('end-screen').hidden) audio.say('sticker', 'You earned a sticker!');
  });
}
let bookPage = null;
$('book-prev').addEventListener('click', () => { audio.chime.whoosh(); bookPage--; renderStickers(); });
$('book-next').addEventListener('click', () => { audio.chime.whoosh(); bookPage++; renderStickers(); });
$('end-done').addEventListener('click', () => { audio.stop(); go('home'); });

function renderStickers() {
  // A book of 20-sticker pages (one per felt album page), opening on the newest page.
  const earned = state.stickers.map(stickerNum);
  const pages = Math.max(1, Math.ceil(earned.length / STICKER_PAGE));
  if (bookPage === null || bookPage >= pages) bookPage = pages - 1;
  const first = bookPage * STICKER_PAGE;
  const locked = art('sticker-locked');
  $('book-page').textContent = pages > 1 ? `${bookPage + 1} / ${pages}` : '';
  $('book-prev').style.visibility = bookPage > 0 ? 'visible' : 'hidden';
  $('book-next').style.visibility = bookPage < pages - 1 ? 'visible' : 'hidden';
  $('sticker-grid').innerHTML = Array.from({ length: STICKER_PAGE }, (_, j) => j + first).map(i => i < earned.length
    ? `<span class="got" style="--tilt:${((i * 37) % 13) - 6}deg">${stickerHtml(earned[i])}</span>`
    : `<span class="empty">${locked ? img(locked) : ''}</span>`).join('');
  $('sticker-note').textContent = earned.length ? '' : 'Finish a game to earn your first sticker!';
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

// Shows whether the recorded (Codex) voice is in this copy of the app, or only the phone's voice.
const voiceNote = () => (audio.clipCount() ? `recorded voice: ${audio.clipCount()} clips` : 'recorded voice: not loaded (phone voice)');

function renderSettings() {
  const s = state.settings;
  $('set-fullscreen').checked = s.fullscreen;
  $('set-fullscreen').disabled = !device.fullscreenSupported();
  $('fs-note').textContent = device.isInstalled() && !device.fullscreenSupported() ? 'Opened from the home screen icon, so it\'s already full screen.'
    : !device.fullscreenSupported() ? 'This browser can\'t go full screen. On iPhone: Share → Add to Home Screen, then open it from the icon.'
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
      .then(v => { $('version').textContent = `Version ${v.version} · updated ${v.built} · ${voiceNote()}`; }).catch(() => {});
  } else $('version').textContent = `Version: local copy · ${voiceNote()}`;
  renderSyncBox();
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
  state = { ...defaultState(), settings, resetAll: Date.now() };
  persist();
  go('setup');
});

// ---------------------------------------------------------------- grown-up: progress

let reportList = null;   // which word set the report shows
const shortDay = t => (t ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—');
const pctText = v => (v === null ? '—' : `${v}%`);

function renderProgress() {
  const now = Date.now();
  // Word set picker: every list, the first one that's on by default.
  const pickEl = $('report-list');
  if (!reportList || !LISTS.some(l => l.id === reportList)) reportList = state.settings.lists[0] || LISTS[0].id;
  pickEl.innerHTML = LISTS.map(l => `<option value="${l.id}"${l.id === reportList ? ' selected' : ''}>${l.name}${state.settings.lists.includes(l.id) ? '' : ' (off)'}</option>`).join('');
  const list = LISTS.find(l => l.id === reportList);
  const words = list.words.map(e => e.word);

  // Summary: words at each stage (a bar), friends, reading this week, pace, Word Checks.
  const sum = setSummary(state.words, words, now);
  const week = state.sessions.filter(x => x.t >= now - 7 * 864e5);
  const bar = sum.levels.map((n, lv) => (n ? `<i class="lv${lv}" style="flex:${n}" title="${LEVEL_NAMES[lv]}: ${n}"></i>` : '')).join('');
  const legend = sum.levels.map((n, lv) => `<span><i class="lv${lv}"></i>${LEVEL_NAMES[lv]} ${n}</span>`).join('');
  const checks = state.checks.filter(c => !c.asked || c.asked.some(w => words.includes(w))).slice(-5).reverse();
  $('report-summary').innerHTML = `
    <div class="stage-bar">${bar}</div>
    <div class="stage-legend">${legend}</div>
    <p><b>${sum.hatched}</b> of ${sum.total} hatched · <b>${sum.crowned}</b> crowned</p>
    <p>This week: ${week.length} game${week.length === 1 ? '' : 's'}, ${week.reduce((n, x) => n + x.cards, 0)} cards · reading ${sum.weekReads ? `${sum.weekRight}% right, ${sum.weekFast}% fast` : '—'}</p>
    <p>New-word pace: ${PACE_NAMES[paceLevel(state.words, now)]}</p>
    ${checks.length ? `<p>Word Checks: ${checks.map(c => `${c.right}/${c.total} (${shortDay(c.t)})`).join(' · ')}</p>` : ''}`;

  const lastCheck = state.checks[state.checks.length - 1];
  $('progress-check').hidden = !lastCheck || !lastCheck.missed.length;
  if (lastCheck) $('progress-check').textContent = `Last Word Check (${shortDay(lastCheck.t)}): practice ${lastCheck.missed.map(show).join(', ')}.`;
  const ents = entries();
  const known = ents.filter(e => levelOf(e.word) >= 4).length;
  $('progress-ready').hidden = !(known / ents.length >= 0.8 && LISTS.some(l => !state.settings.lists.includes(l.id)));

  // One card per word.
  const stats = Object.fromEntries(words.map(w => [w, wordStats(state.words[w], w, state.checks)]));
  const sort = $('report-sort').value;
  const lvl = w => levelOf(w);
  const order = words.slice().sort({
    stage: (a, b2) => lvl(a) - lvl(b2) || stats[b2].misses - stats[a].misses,
    'stage-desc': (a, b2) => lvl(b2) - lvl(a) || stats[a].misses - stats[b2].misses,
    accuracy: (a, b2) => (stats[a].readRight ?? 101) - (stats[b2].readRight ?? 101) || lvl(a) - lvl(b2),
    az: (a, b2) => a.toLowerCase().localeCompare(b2.toLowerCase()),
  }[sort] || (() => 0));
  const grid = $('progress-grid');
  grid.innerHTML = '';
  for (const w of order) {
    const r = state.words[w];
    const st = stats[w];
    const level = r?.level ?? 0;
    const card = document.createElement('button');
    card.className = 'word-report';
    const reading = st.reads ? `${st.reads} · ${pctText(st.readRight)} right · ${pctText(st.readFast)} fast${st.avgSec !== null ? ` · avg ${st.avgSec.toFixed(1)} s` : ''}` : 'not yet';
    const pop = st.pops ? `${st.pops} · ${pctText(st.popFirst)} first try` : '—';
    const build = level < 4 ? 'after hatching' : st.built ? `built ✓ (${st.builds} tr${st.builds === 1 ? 'y' : 'ies'})` : st.builds ? `not yet · ${st.builds} tr${st.builds === 1 ? 'y' : 'ies'}` : 'not tried yet';
    const check = st.checks ? `${st.checkRight} of ${st.checks} right${st.lastCheckRight === false ? ' (missed last time)' : ''}` : '—';
    card.innerHTML = `
      <div class="wr-head"><b>${show(w)}</b>${r?.headStart ? ' <span class="wr-tag">head start</span>' : ''}<span class="lvl lv${level}">${LEVEL_NAMES[level]}</span><span class="egg-dots small"></span></div>
      <div class="wr-next">${nextStep(r, now)}</div>
      <dl>
        <dt>Reading</dt><dd>${reading}</dd>
        <dt>Bubble Pop</dt><dd>${pop}</dd>
        <dt>Build It</dt><dd>${build}</dd>
        <dt>Word Check</dt><dd>${check}</dd>
        <dt>Seen</dt><dd>${st.seen} card${st.seen === 1 ? '' : 's'} · ${st.misses} miss${st.misses === 1 ? '' : 'es'} · ${st.days} day${st.days === 1 ? '' : 's'}</dd>
        <dt>Dates</dt><dd>met ${shortDay(st.firstSeen)} · last ${shortDay(st.lastSeen)}</dd>
      </dl>`;
    renderDots(card.querySelector('.egg-dots'), hatchProgress(r, now));
    card.addEventListener('click', async () => {
      if (!(await mathCheck(`Reset "${show(w)}" to New?`))) return;
      delete state.words[w];
      state.hatched = state.hatched.filter(x => x !== w);
      state.resets = { ...state.resets, [w]: Date.now() };
      persist();
      renderProgress();
    });
    grid.appendChild(card);
  }
}
$('report-list').addEventListener('change', e => { reportList = e.target.value; renderProgress(); });
$('report-sort').addEventListener('change', () => renderProgress());

// ---------------------------------------------------------------- boot

audio.configure(state.settings);
// While a voice line plays, the next step waits: answers, Next and Yay! are locked until it ends.
// Unlocking waits a beat so a sequence of lines (word → letters → sentence) stays locked between them.
let unlockTimer = null, voiceOn = false;
function applyLock() {
  clearTimeout(unlockTimer);
  const set = v => ['parent-strip', 'teach-next', 'hatch-done'].forEach(id => $(id).classList.toggle('locked', v));
  if (voiceOn || lockHolds > 0) set(true);
  else unlockTimer = setTimeout(() => set(false), 450);
}
audio.onVoice(on => { music.duck(on); voiceOn = on; applyLock(); });
for (const s of SCREENS) $(s).hidden = true;
document.querySelectorAll('.mascot').forEach(m => setMascot(m, (m.className.match(/\b(idle|think|cheer|gentle)\b/) || [, 'idle'])[1]));
if (art('meadow-bg')) document.body.classList.add('has-meadow');
// Felt button icons from Codex replace the glyphs once they exist.
document.querySelectorAll('[data-icon]').forEach(el => {
  const src = art(el.dataset.icon);
  if (src) { el.innerHTML = img(src); el.classList.add('felt'); }
});
if (art('hatch-bg')) $('hatch').classList.add('felt-bg');
if (art('sticker-book')) $('sticker-screen').classList.add('felt-book');
if ('serviceWorker' in navigator && window.isSecureContext && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
initCheck({ state: () => state, persist, go, show, entries, setMascot, burst });
doSync(true);
window.__sightwords = { get state() { return state; }, cardWord: () => (card ? show(card.word) : null), cardKind: () => card?.kind, answered: () => session?.results.length ?? 1e9, pets: petState, checkWord, words: () => entries().map(e => e.word) }; // for the smoke test
