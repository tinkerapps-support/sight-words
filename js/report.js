// Numbers for the parent's Progress report (Settings → Progress report). Pure: no DOM, no clock.
// A word's history keeps its newest CONFIG.historyCap cards, so card stats are "recent"; the
// seen / misses totals cover all time.
import { dayKey } from './engine.js';

const pct = (n, d) => (d ? Math.round((n / d) * 100) : null);

// One word: reading, Bubble Pop, Build It and Word Check stats.
export function wordStats(rec, word, checks = []) {
  const h = rec?.history || [];
  const reads = h.filter(x => ['fast', 'got', 'notyet'].includes(x.r));
  const right = reads.filter(x => x.r !== 'notyet');
  const fast = reads.filter(x => x.r === 'fast');
  const times = right.map(x => x.ms).filter(ms => ms > 0);
  const pops = h.filter(x => x.r === 'pop' || x.r === 'popmiss');
  const builds = h.filter(x => x.r === 'build' || x.r === 'buildhelp');
  const asked = checks.filter(c => Array.isArray(c.asked) && c.asked.includes(word));
  const checkRight = asked.filter(c => !c.missed.includes(word));
  const ts = h.map(x => x.t).filter(Boolean);
  return {
    seen: rec?.seen ?? 0,
    misses: rec?.misses ?? 0,
    reads: reads.length,
    readRight: pct(right.length, reads.length),
    readFast: pct(fast.length, reads.length),
    avgSec: times.length ? times.reduce((a, b) => a + b, 0) / times.length / 1000 : null,
    pops: pops.length,
    popFirst: pct(pops.filter(x => x.r === 'pop').length, pops.length),
    builds: builds.length,
    buildFirst: pct(builds.filter(x => x.r === 'build').length, builds.length),
    built: Boolean(rec?.built),
    checks: asked.length,
    checkRight: checkRight.length,
    lastCheckRight: asked.length ? !asked[asked.length - 1].missed.includes(word) : null,
    firstSeen: ts.length ? Math.min(...ts) : null,
    lastSeen: rec?.lastSeen || null,
    days: new Set(ts.map(dayKey)).size,
  };
}

// A whole word set: how many words at each level, plus reading over the last 7 days.
export function setSummary(records, words, now) {
  const levels = [0, 0, 0, 0, 0, 0];
  for (const w of words) levels[records[w]?.level ?? 0]++;
  const since = now - 7 * 24 * 60 * 60 * 1000;
  const reads = words.flatMap(w => (records[w]?.history || []).filter(x => x.t >= since && ['fast', 'got', 'notyet'].includes(x.r)));
  return {
    levels,
    total: words.length,
    hatched: levels[4] + levels[5],
    crowned: levels[5],
    weekReads: reads.length,
    weekRight: pct(reads.filter(x => x.r !== 'notyet').length, reads.length),
    weekFast: pct(reads.filter(x => x.r === 'fast').length, reads.length),
  };
}
