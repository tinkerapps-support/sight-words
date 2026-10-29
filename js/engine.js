// The learning engine (PLAN.md §3). Pure logic: no DOM, no storage, no clock.
// Callers pass `now` (ms) and an `rng` so tests are deterministic.
import { CONFIG } from './config.js';
import { lookalikesOf } from './lists.js';

const DAY = 24 * 60 * 60 * 1000;

export function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function startOfNextDay(now) {
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

export function newRecord() {
  return {
    level: 0, correctStreak: 0, fastStreak: 0, levelDay: null, levelSince: null,
    reviewIdx: 0, seen: 0, misses: 0, lastSeen: 0, nextDue: 0, headStart: false, history: [],
    restUntil: 0, popStreak: 0, built: false,
  };
}

// ---- Teaching support (PLAN.md §4) ----

// A word she has never seen is introduced (modelled) before it is ever tested: errorless
// teaching, the "model" step of model–lead–test.
export function needsIntro(rec) {
  return !rec || (rec.level === 0 && rec.seen === 0);
}

export function applyIntro(rec, now) {
  rec.seen++;
  rec.lastSeen = now;
  rec.history.push({ t: now, r: 'intro', ms: 0, h: 1 });
  if (rec.level < 1) setLevel(rec, 1, now);
  rec.correctStreak = 0;
  rec.nextDue = now;
}

// How much help a card gets: the word's level, stepped back after recent misses so support
// rises right after a struggle and fades again with success (adaptive time delay).
// Returns 1 (most help) .. 4+ (no automatic help).
export function supportLevel(rec) {
  if (!rec) return 1;
  let s = Math.max(1, rec.level);
  const recent = rec.history.filter(h => h.r !== 'intro').slice(-2);
  const lastMiss = recent.length && recent[recent.length - 1].r === 'notyet';
  if (recent.length === 2 && recent.every(h => h.r === 'notyet')) s = 1;
  else if (lastMiss) s = Math.max(1, s - 1);
  return s;
}

// Progress toward hatching, in steps a child can see move (the egg screen's felt buttons):
// 1 learning, 2 one correct, 3 getting it, 4 one fast, 5 almost (fast today), 6 hatched/known.
// At step 5 the last step needs a fast read on ANOTHER day: waitingForTomorrow says so.
export const HATCH_STEPS = 6;
export function hatchProgress(rec, now) {
  if (!rec || rec.level === 0) return { step: 0, waitingForTomorrow: false };
  if (rec.level >= 4) return { step: HATCH_STEPS, waitingForTomorrow: false };
  if (rec.level === 1) return { step: 1 + Math.min(rec.popStreak || 0, 1), waitingForTomorrow: false };
  if (rec.level === 2) return { step: 3 + Math.min(rec.fastStreak, 1), waitingForTomorrow: false };
  return { step: 5, waitingForTomorrow: dayKey(now) === rec.levelDay };
}

// For the parent's Progress screen: what this word needs next, in plain words.
export function nextStep(rec, now) {
  if (rec && (rec.restUntil || 0) > now) return 'Resting until tomorrow (missed 3 times today)';
  if (!rec || rec.level === 0) return rec?.seen ? 'Not started yet' : 'Meets it in a coming game';
  if (rec.level === 1) return rec.popStreak >= 1 ? 'Next: one more first-try bubble pop' : 'Next: pop its bubble on the first try, twice in a row';
  if (rec.level === 2) return rec.fastStreak >= 1 ? 'Next: one more Fast read' : 'Next: 2 Fast reads in a row';
  if (rec.level === 3) {
    return dayKey(now) === rec.levelDay ? 'Next: a Fast read tomorrow hatches it 🌙' : 'Next: a Fast read hatches it!';
  }
  if (rec.level === 4) {
    if (!rec.built) return 'Hatched! Next: build (spell) it right on the first try';
    const crownAt = rec.levelSince + CONFIG.promoteKnownAfterDays * DAY;
    if (now >= crownAt) return 'Hatched! A Fast read now earns the crown';
    const day = new Date(crownAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    return `Hatched! A Fast read from ${day} earns the crown`;
  }
  return 'Mastered 👑';
}

// Missed CONFIG.restAfterMisses times in one game: rest it until tomorrow so a hard word
// doesn't keep coming back to the same frustration; it returns fresh next session.
export function restWord(rec, now) {
  rec.restUntil = startOfNextDay(now);
}

function setLevel(rec, level, now) {
  rec.level = level;
  rec.levelDay = dayKey(now);
  rec.levelSince = now;
}

// A miss drops a word at most two levels (PLAN.md §3 table).
const DROP_TO = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3 };

// result: 'fast' | 'got' | 'notyet'. A Fast with a hint showing counts as Got it.
// Mutates `rec`; returns what changed so the UI can celebrate.
export function applyResult(rec, result, { hinted = false, ms = 0, now }) {
  const r = result === 'fast' && hinted ? 'got' : result;
  const before = rec.level;
  rec.seen++;
  rec.lastSeen = now;
  rec.history.push({ t: now, r, ms: Math.round(ms), h: hinted ? 1 : 0 });
  if (rec.history.length > CONFIG.historyCap) rec.history.splice(0, rec.history.length - CONFIG.historyCap);

  if (r === 'notyet') {
    rec.misses++;
    rec.correctStreak = 0;
    rec.popStreak = 0;
    rec.fastStreak = 0;
    rec.reviewIdx = 0;
    const to = DROP_TO[rec.level];
    if (to !== rec.level) setLevel(rec, to, now);
    rec.nextDue = now;
  } else {
    rec.correctStreak++;
    rec.fastStreak = r === 'fast' ? rec.fastStreak + 1 : 0;
    if (rec.level === 0) setLevel(rec, 1, now);
    if (rec.level === 1 && rec.correctStreak >= 2) {
      setLevel(rec, 2, now);
      rec.fastStreak = 0;
    } else if (rec.level === 2 && rec.fastStreak >= 2) {
      setLevel(rec, 3, now);
    } else if (rec.level === 3 && r === 'fast' && dayKey(now) !== rec.levelDay) {
      setLevel(rec, 4, now);
      rec.reviewIdx = 0;
    } else if (rec.level === 4 && r === 'fast' && rec.built && now - rec.levelSince >= CONFIG.promoteKnownAfterDays * DAY) {
      setLevel(rec, 5, now);
    }

    const gaps = CONFIG.reviewGapsDays;
    if (rec.level >= 4) {
      if (rec.level > before) rec.reviewIdx = 0;
      else if (r === 'fast') rec.reviewIdx = Math.min(rec.reviewIdx + 1, gaps.length - 1);
      else rec.reviewIdx = Math.max(0, rec.reviewIdx - 1);
      rec.nextDue = now + gaps[rec.reviewIdx] * DAY;
    } else if (rec.level === 3) {
      rec.nextDue = startOfNextDay(now);
    } else {
      rec.nextDue = now;
    }
  }
  return { before, after: rec.level, hatched: before < 4 && rec.level >= 4 };
}

// Which kind of card a word gets, by stage (owner, 2026-10-27): Bubble Pop while it's Learning
// (hearing it and finding it is the first step), reading while it's Getting it / Almost, and Build It
// (spelling, the step beyond reading) once it has hatched: 80% Build It / 20% reading until it's
// built right on the first try, then 40% Build It / 20% Bubble Pop (variety) / 40% reading
// (CONFIG.buildShare*, popShareBuilt; owner, 2026-10-27).
export function cardKind(rec, rng = Math.random) {
  if (needsIntro(rec)) return 'intro';
  if (rec.level <= 1) return 'pop';
  if (rec.level <= 3) return 'read';
  const r = rng();
  if (!rec.built) return r < CONFIG.buildShareUnbuilt ? 'build' : 'read';
  if (r < CONFIG.buildShareBuilt) return 'build';
  return r < CONFIG.buildShareBuilt + CONFIG.popShareBuilt ? 'pop' : 'read';
}

// How many bubbles a Bubble Pop card shows: 3 for a new word, one more once she's popped it
// right on the first try, 5 once hatched, 6 once crowned.
export function bubbleCount(rec) {
  const B = CONFIG.bubbles;
  if (!rec) return B.base;
  if (rec.level >= 5) return B.crowned;
  if (rec.level >= 4) return B.hatched;
  return rec.popStreak >= 1 ? B.afterFirstTryPop : B.base;
}

function log(rec, entry) {
  rec.history.push(entry);
  if (rec.history.length > CONFIG.historyCap) rec.history.splice(0, rec.history.length - CONFIG.historyCap);
}

// A Bubble Pop card. firstTry: she popped the right bubble before any wrong one.
// CONFIG.popsToLearn first-try pops in a row move a Learning word to Getting it (required:
// it's the only way out of Learning). A wrong first pop is a miss: the streak starts over.
export function applyPop(rec, firstTry, now) {
  const before = rec.level;
  rec.seen++;
  rec.lastSeen = now;
  log(rec, { t: now, r: firstTry ? 'pop' : 'popmiss', ms: 0, h: 0 });
  if (rec.level === 0) setLevel(rec, 1, now);
  if (!firstTry) {
    rec.misses++;
    rec.popStreak = 0;
  } else if (rec.level === 1 && ++rec.popStreak >= CONFIG.popsToLearn) {
    setLevel(rec, 2, now);
    rec.popStreak = 0;
    rec.correctStreak = 0;
    rec.fastStreak = 0;
  }
  rec.nextDue = now;
  return { before, after: rec.level };
}

// A Build It card (hatched words). Built right on the first try (no wrong letter) marks the word
// built, which the crown needs. Spelling is harder than reading, so a slip never lowers a word.
export function applyBuild(rec, firstTry, now) {
  const before = rec.level;
  rec.seen++;
  rec.lastSeen = now;
  log(rec, { t: now, r: firstTry ? 'build' : 'buildhelp', ms: 0, h: 0 });
  if (firstTry) rec.built = true;
  return { before, after: rec.level };
}

// "Words she already knows" (PLAN.md §3): marked words start at level 3, never lowered.
// levelDay = today, so reaching Known still needs a Fast on another day.
export function markHeadStart(rec, now) {
  rec.headStart = true;
  if (rec.level < 3) {
    // Remember what the boost replaced, so an unmark before she plays the word undoes it.
    const { level, levelDay, levelSince, correctStreak, fastStreak, nextDue, seen } = rec;
    rec.beforeHeadStart = { level, levelDay, levelSince, correctStreak, fastStreak, nextDue, seen };
    setLevel(rec, 3, now);
    rec.correctStreak = 0;
    rec.fastStreak = 0;
    rec.nextDue = now;
  }
}

// Unmarking undoes the boost if the word hasn't been played since; progress she earned stays.
export function unmarkHeadStart(rec) {
  rec.headStart = false;
  const before = rec.beforeHeadStart;
  if (before && rec.seen === before.seen) {
    const { seen, ...restore } = before;
    Object.assign(rec, restore);
  }
  delete rec.beforeHeadStart;
}

// Optional "Meet the words" check. levelOneCount = words already at level 1 so far.
export function applyPlacement(rec, result, now, levelOneCount) {
  rec.seen++;
  rec.lastSeen = now;
  if (result === 'fast' && rec.level < 3) { setLevel(rec, 3, now); rec.nextDue = now; }
  else if (result === 'got' && rec.level < 2) { setLevel(rec, 2, now); rec.nextDue = now; }
  else if (result === 'notyet' && rec.level === 0 && levelOneCount < CONFIG.maxShaky) setLevel(rec, 1, now);
}

// ---- Pace: more new words when she's acing everything (owner, 2026-10-28) ----

const GOOD = new Set(['fast', 'pop', 'build']);          // Fast read, first-try pop, first-try build
const OK = new Set(['got', 'buildhelp']);
const BAD = new Set(['notyet', 'popmiss']);

// -1 slow, 0 normal, 1 quick, 2 fast, from her newest scored cards across every word.
export function paceLevel(records, now) {
  const P = CONFIG.pace;
  const since = now - 14 * DAY;
  const recent = Object.values(records).flatMap(r => r.history || [])
    .filter(h => h.t >= since && (GOOD.has(h.r) || OK.has(h.r) || BAD.has(h.r)))
    .sort((a, b) => b.t - a.t).slice(0, P.window);
  if (recent.length < P.minCards) return 0;
  const good = recent.filter(h => GOOD.has(h.r)).length / recent.length;
  const right = recent.filter(h => !BAD.has(h.r)).length / recent.length;
  if (right < P.slowBelow) return -1;
  if (right >= P.fastAt && good >= P.fastStrong) return 2;
  return right >= P.quickAt ? 1 : 0;
}
export const PACE_NAMES = { '-1': 'gentle (new words wait until current ones settle)', 0: 'normal', 1: 'quick (extra new words)', 2: 'fast (lots of new words)' };

// The next brand-new word to bring in mid-game (list order), or null.
export function nextFreshWord(records, entries, exclude = new Set()) {
  const e = entries.find(x => (records[x.word]?.level ?? 0) === 0 && !(records[x.word]?.seen) && !exclude.has(x.word));
  return e ? e.word : null;
}

// ---- Building a session (incremental rehearsal) ----

// records: { [word]: record }, entries: activeWords(...). Returns { queue, targets, starterMode }.
// The last card of `queue` is always the surest word available.
export function buildSession({ records, entries, now, length, rng = Math.random, pace = 0 }) {
  const P = CONFIG.pace.levels[pace] || CONFIG.pace.levels[0];
  const rec = w => records[w] || newRecord();
  const level = w => rec(w).level;
  const words = entries.map(e => e.word);
  const known = words.filter(w => level(w) >= 3);
  // Starter mode keeps the first games small, unless she's already flying through them.
  const starterMode = known.length < CONFIG.minKnownForFull && pace < 1;
  const isStarter = new Set(entries.filter(e => e.starter).map(e => e.word));

  const total = starterMode ? Math.min(length, CONFIG.starterSessionLength) : length;
  const budget = total - 1; // last card is the sure ending card

  // Shaky words (level 1–2), topped up with new words up to the cap.
  const rested = w => (rec(w).restUntil || 0) > now;
  const allShaky = words.filter(w => level(w) === 1 || level(w) === 2);
  // A resting word still counts toward the shaky cap (so it isn't replaced by new words today).
  const shaky = allShaky.filter(w => !rested(w));
  const maxShaky = starterMode ? CONFIG.starterMaxShaky : P.maxShaky;
  const fresh = words.filter(w => level(w) === 0 && !(starterMode && isStarter.has(w)));
  for (let room = maxShaky - allShaky.length; room > 0 && fresh.length; room--) shaky.push(fresh.shift());

  const nTargets = starterMode ? CONFIG.starterTargets : P.targets;
  const targets = [...shaky]
    .sort((a, b) => rec(b).misses - rec(a).misses || rec(a).lastSeen - rec(b).lastSeen)
    .slice(0, nTargets);

  // Filler ("known") pool: due reviews first, then least recently seen.
  const byDueThenSeen = (a, b) => {
    const da = rec(a).nextDue <= now, db = rec(b).nextDue <= now;
    if (da !== db) return da ? -1 : 1;
    return da ? rec(a).nextDue - rec(b).nextDue : rec(a).lastSeen - rec(b).lastSeen;
  };
  let pool = known.slice().sort(byDueThenSeen);
  if (starterMode) {
    const extra = words.filter(w => isStarter.has(w) && level(w) < 3 && !targets.includes(w));
    pool = pool.concat(extra.sort((a, b) => level(b) - level(a)));
  }
  if (!pool.length) pool = shaky.filter(w => !targets.includes(w));

  const shakySet = new Set(shaky);
  const clash = (a, b) => {
    if (a === b) return true;
    if (!(shakySet.has(a) || shakySet.has(b))) return false;
    return lookalikesOf(a, entries).has(b);
  };

  // Steps per target: as many as fit (T,K1 = 1 step; T,K1,T,K1,K2 = 2; …).
  const blockSize = s => s + (s * (s + 1)) / 2;
  let steps = CONFIG.irSteps;
  while (steps > 1 && targets.length * blockSize(steps) > budget) steps--;

  let cursor = 0;
  const blocks = targets.map(t => {
    const allowed = pool.filter(w => !clash(w, t));
    const picks = [];
    for (let i = 0; i < allowed.length && picks.length < steps; i++) {
      picks.push(allowed[(cursor + i) % allowed.length]);
    }
    cursor += picks.length;
    const block = [];
    for (let s = 1; s <= steps; s++) {
      block.push(t);
      block.push(...picks.slice(0, s));
    }
    return block;
  });

  let queue = blocks.flat().slice(0, budget);

  // Fill what's left: a look-alike contrast pair, due reviews, other shaky words, then anything known.
  const used = new Set(queue);
  const fill = [];
  const room = () => budget - queue.length - fill.length;
  const pair = contrastPair(entries, rec);
  if (pair && room() >= 2 && !used.has(pair[0]) && !used.has(pair[1])) {
    fill.push(...pair);
    pair.forEach(w => used.add(w));
  }
  const candidates = [
    ...pool.filter(w => rec(w).nextDue <= now),
    ...shaky.filter(w => !targets.includes(w)),
    ...pool,
  ];
  for (const w of candidates) {
    if (room() <= 0) break;
    if (!used.has(w)) { fill.push(w); used.add(w); }
  }
  // Still room (tiny lists): repeat targets and the pool.
  const cycle = [...targets, ...pool];
  for (let i = 0; room() > 0 && cycle.length && i < 100; i++) fill.push(cycle[i % cycle.length]);

  if (blocks.length > 1) {
    const half = Math.ceil(fill.length / 2);
    queue = [...blocks[0], ...fill.slice(0, half), ...blocks.slice(1).flat(), ...fill.slice(half)].slice(0, budget);
  } else {
    queue = [...queue, ...fill];
  }
  queue = repairAdjacency(queue, clash);

  const end = endingCard(words, rec, queue[queue.length - 1], clash);
  if (end) queue.push(end);
  return { queue, targets, starterMode, clash };
}

// Two look-alikes that are both level 3+, shown side by side on purpose.
function contrastPair(entries, rec) {
  for (const e of entries) {
    if (rec(e.word).level < 3) continue;
    for (const other of e.lookalikes || []) {
      if (entries.some(x => x.word === other) && rec(other).level >= 3) return [e.word, other];
    }
  }
  return null;
}

function repairAdjacency(queue, clash) {
  const q = queue.slice();
  for (let i = 1; i < q.length; i++) {
    if (!clash(q[i - 1], q[i])) continue;
    for (let j = i + 1; j < q.length; j++) {
      const ok = !clash(q[i - 1], q[j]) && (i + 1 >= q.length || !clash(q[j], q[i + 1]))
        && !clash(q[j - 1], q[i]) && (j + 1 >= q.length || !clash(q[i], q[j + 1]));
      if (ok) { [q[i], q[j]] = [q[j], q[i]]; break; }
    }
  }
  return q;
}

export function endingCard(words, rec, last, clash = (a, b) => a === b) {
  const ranked = words
    .filter(w => !last || !clash(w, last))
    .sort((a, b) => rec(b).level - rec(a).level || rec(a).misses - rec(b).misses);
  return ranked[0] || null;
}

// ---- A running session ----

export class Session {
  // retries: false for "Meet the words", where each word is checked exactly once.
  // isSure(word): a word she reliably knows; after a miss the next card is one (a quick win).
  constructor({ queue, clash, rng = Math.random, retries = true, isSure = null }) {
    this.allowRetries = retries;
    this.isSure = isSure;
    this.missCount = {};
    this.queue = queue.slice();
    this.clash = clash || ((a, b) => a === b);
    this.rng = rng;
    this.index = 0;
    this.retries = {};
    this.correctWords = new Set();
    this.extraEnd = false;
    this.results = [];
  }

  get current() { return this.queue[this.index]; }
  get done() { return this.index >= this.queue.length; }
  get remaining() { return this.queue.length - this.index; }

  answer(result) {
    const word = this.current;
    this.results.push({ word, result });
    const isLast = this.index === this.queue.length - 1;
    if (result === 'intro') { this.index++; return; }
    if (result === 'notyet') {
      this.missCount[word] = (this.missCount[word] || 0) + 1;
      if (!this.allowRetries) { this.index++; return; }
      const n = this.retries[word] || 0;
      if (n < CONFIG.maxRetriesPerWord) {
        this.retries[word] = n + 1;
        const [lo, hi] = CONFIG.notYetGap;
        const gap = lo + Math.floor(this.rng() * (hi - lo + 1));
        // Insert before the ending card, never right after itself if there's room.
        const endPos = this.queue.length - 1;
        let pos = Math.min(this.index + gap, isLast ? this.queue.length : endPos);
        if (pos <= this.index) pos = this.index + 1;
        this.queue.splice(pos, 0, word);
      }
      // Missed the ending card: finish on a word she got right this session instead.
      if (isLast && !this.extraEnd) {
        const sure = [...this.correctWords].find(w => !this.clash(w, word));
        if (sure) { this.queue.push(sure); this.extraEnd = true; }
      }
      this.winNext(word);
    } else {
      this.correctWords.add(word);
    }
    this.index++;
  }

  // A new word joins mid-game: it shows up 1, 3, 6 and 10 cards from now (intro, pops, reads),
  // taking the place of filler cards where it can so the game stays about the same length.
  // Never after the ending card.
  addWord(word, isFiller = () => false) {
    for (const off of [1, 3, 6, 10]) {
      const end = this.queue.length - 1;
      const pos = this.index + off;
      if (pos >= end) { this.queue.splice(end, 0, word); break; }
      if (isFiller(this.queue[pos]) && this.queue[pos] !== word) this.queue[pos] = word;
      else this.queue.splice(pos, 0, word);
    }
  }

  // The word rests: remove its later cards this game (never the ending card).
  rest(word) {
    const end = this.queue.length - 1;
    this.queue = this.queue.filter((w, i) => i <= this.index || i === end || w !== word);
  }

  // After a miss: if the next card isn't a sure word, swap in the nearest sure one from later
  // in the queue (never the ending card), keeping look-alikes apart.
  winNext(missed) {
    if (!this.isSure) return;
    const next = this.index + 1;
    const last = this.queue.length - 1;
    if (next >= last || this.isSure(this.queue[next])) return;
    for (let j = next + 1; j < last; j++) {
      const w = this.queue[j];
      if (this.isSure(w) && !this.clash(w, missed) && w !== this.queue[next]) {
        [this.queue[next], this.queue[j]] = [this.queue[j], this.queue[next]];
        return;
      }
    }
  }
}
