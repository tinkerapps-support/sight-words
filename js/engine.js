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
  };
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
    } else if (rec.level === 4 && r === 'fast' && now - rec.levelSince >= CONFIG.promoteKnownAfterDays * DAY) {
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

// ---- Building a session (incremental rehearsal) ----

// records: { [word]: record }, entries: activeWords(...). Returns { queue, targets, starterMode }.
// The last card of `queue` is always the surest word available.
export function buildSession({ records, entries, now, length, rng = Math.random }) {
  const rec = w => records[w] || newRecord();
  const level = w => rec(w).level;
  const words = entries.map(e => e.word);
  const known = words.filter(w => level(w) >= 3);
  const starterMode = known.length < CONFIG.minKnownForFull;
  const isStarter = new Set(entries.filter(e => e.starter).map(e => e.word));

  const total = starterMode ? Math.min(length, CONFIG.starterSessionLength) : length;
  const budget = total - 1; // last card is the sure ending card

  // Shaky words (level 1–2), topped up with new words up to the cap.
  const shaky = words.filter(w => level(w) === 1 || level(w) === 2);
  const maxShaky = starterMode ? CONFIG.starterMaxShaky : CONFIG.maxShaky;
  const fresh = words.filter(w => level(w) === 0 && !(starterMode && isStarter.has(w)));
  while (shaky.length < maxShaky && fresh.length) shaky.push(fresh.shift());

  const nTargets = starterMode ? CONFIG.starterTargets : CONFIG.targetsPerSession;
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
  constructor({ queue, clash, rng = Math.random }) {
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
    if (result === 'notyet') {
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
    } else {
      this.correctWords.add(word);
    }
    this.index++;
  }
}
