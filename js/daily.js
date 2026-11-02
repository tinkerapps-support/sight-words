// The parent's calendar (owner, 2026-11-01): one record per day, kept for good and synced with the
// rest of the progress. Pure: no DOM, no clock (callers pass `now` and this device's id).
//
// Shape (docs/DATA.md is the reference; bump DAY_V and migrate in normalizeDaily on any change):
//   state.daily['YYYY-MM-DD'] = {
//     v: 1,
//     dev: { <deviceId>: { ms, games, stickers, read, right, fast, hinted, notyet, pop, popRight, build, buildRight } },
//     met: [word], hatched: [word], crowned: [word],     // words, each once
//     checks: [{ t, right, total }],                      // Word Checks finished that day
//   }
// Counters are stored sparsely (a zero is left out, read as 0) to keep the synced record small: it
// has to stay under the 800,000-character cap in the Firestore rules for years (docs/DATA.md).
// Counters live per device and only ever go up, so two phones merge by taking each device's larger
// number (never adding the same play twice). Day totals add the devices together.
// Days before the calendar existed are filled once from the word histories under the device id
// EST_DEVICE, with time estimated from the gaps between cards (state.dailySince marks the switch).
import { dayKey } from './engine.js';

export const DAY_V = 1;
export const EST_DEVICE = 'estimated';
export const COUNTERS = ['ms', 'games', 'stickers', 'read', 'right', 'fast', 'hinted', 'notyet', 'pop', 'popRight', 'build', 'buildRight'];
const LISTS = ['met', 'hatched', 'crowned'];
const EST_GAP = 3 * 60e3;   // cards further apart than this are separate sittings
const EST_LEAD = 30e3;      // time counted before the first card of a sitting

const emptyCounters = () => Object.fromEntries(COUNTERS.map(k => [k, 0]));
export const emptyDay = () => ({ v: DAY_V, dev: {}, met: [], hatched: [], crowned: [], checks: [] });

// Repairs whatever came from storage or the cloud into the current shape (unknown fields are kept,
// so a newer app's additions survive a round trip through an older one).
export function normalizeDaily(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [day, d] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !d || typeof d !== 'object') continue;
    const dev = {};
    for (const [id, c] of Object.entries(d.dev || {})) {
      if (!c || typeof c !== 'object') continue;
      dev[id] = { ...c };
      for (const k of COUNTERS) {
        const n = Math.max(0, Math.round(Number(c[k]) || 0));
        if (n) dev[id][k] = n; else delete dev[id][k];
      }
    }
    out[day] = {
      ...d, v: DAY_V, dev,
      ...Object.fromEntries(LISTS.map(k => [k, Array.isArray(d[k]) ? [...new Set(d[k].filter(w => typeof w === 'string'))] : []])),
      checks: Array.isArray(d.checks) ? d.checks.filter(c => c && Number.isFinite(c.t)) : [],
    };
  }
  return out;
}

function day(state, now) {
  state.daily ||= {};
  return (state.daily[dayKey(now)] ||= emptyDay());
}

// Add to this device's counters for today: bump(state, now, id, { read: 1, right: 1 }).
export function bump(state, now, device, add) {
  const d = day(state, now);
  const c = (d.dev[device] ||= {});
  for (const [k, n] of Object.entries(add)) if (n) c[k] = (c[k] || 0) + n;
}

// A word met / hatched / crowned today (kind is 'met' | 'hatched' | 'crowned').
export function noteWord(state, now, kind, word) {
  const d = day(state, now);
  if (!d[kind].includes(word)) d[kind].push(word);
}

export function noteCheck(state, now, right, total) {
  day(state, now).checks.push({ t: now, right, total });
}

// Two copies of the calendar (this device and the cloud) into one.
export function mergeDaily(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key], y = b[key];
    if (!x || !y) { out[key] = structuredClone(x || y); continue; }
    const d = { ...structuredClone(y), ...structuredClone(x), v: DAY_V, dev: {} };
    for (const id of new Set([...Object.keys(x.dev), ...Object.keys(y.dev)])) {
      const p = x.dev[id], q = y.dev[id];
      d.dev[id] = !p || !q ? { ...(p || q) } : Object.fromEntries([...new Set([...Object.keys(p), ...Object.keys(q)])]
        .map(k => [k, COUNTERS.includes(k) ? Math.max(p[k] || 0, q[k] || 0) : (p[k] ?? q[k])]).filter(([, v]) => v !== 0));
    }
    for (const k of LISTS) d[k] = [...new Set([...x[k], ...y[k]])];
    const seen = new Set();
    d.checks = [...x.checks, ...y.checks].filter(c => !seen.has(c.t) && seen.add(c.t)).sort((p, q) => p.t - q.t);
    out[key] = d;
  }
  return out;
}

// Fill the days before the calendar existed from what the app already kept: every card in the word
// histories, the finished games, stickers and Word Checks. Runs once (sets state.dailySince).
// The histories hold each word's last cards only, so very old days may be partly missing.
export function backfillDaily(state, now) {
  if (state.dailySince) return false;
  state.dailySince = now;
  const before = x => x && Number.isFinite(x.t) && x.t < now;
  const add = (t, fields) => bump(state, t, EST_DEVICE, fields);
  const times = {};
  for (const [word, rec] of Object.entries(state.words || {})) {
    for (const h of (rec.history || []).filter(before)) {
      (times[dayKey(h.t)] ||= []).push(h.t);
      if (h.r === 'intro') noteWord(state, h.t, 'met', word);
      else if (['fast', 'got', 'notyet'].includes(h.r)) add(h.t, { read: 1, right: h.r === 'notyet' ? 0 : 1, fast: h.r === 'fast' ? 1 : 0, hinted: h.h ? 1 : 0, notyet: h.r === 'notyet' ? 1 : 0 });
      else if (h.r === 'pop' || h.r === 'popmiss') add(h.t, { pop: 1, popRight: h.r === 'pop' ? 1 : 0 });
      else if (h.r === 'build' || h.r === 'buildhelp') add(h.t, { build: 1, buildRight: h.r === 'build' ? 1 : 0 });
    }
    // Hatch and crown days are only known for the level a word is at now.
    if (rec.levelSince && rec.levelSince < now) {
      if (rec.level === 4 && (state.hatched || []).includes(word)) noteWord(state, rec.levelSince, 'hatched', word);
      if (rec.level === 5) noteWord(state, rec.levelSince, 'crowned', word);
    }
  }
  for (const s of (state.sessions || []).filter(before)) { add(s.t, { games: 1 }); (times[dayKey(s.t)] ||= []).push(s.t); }
  for (const s of (state.stickers || []).filter(before)) add(s.t, { stickers: 1 });
  for (const c of (state.checks || []).filter(before)) { noteCheck(state, c.t, c.right, c.total); (times[dayKey(c.t)] ||= []).push(c.t); }
  for (const ts of Object.values(times)) {
    ts.sort((a, b) => a - b);
    let ms = EST_LEAD;
    for (let i = 1; i < ts.length; i++) ms += ts[i] - ts[i - 1] <= EST_GAP ? ts[i] - ts[i - 1] : EST_LEAD;
    add(ts[0], { ms });
  }
  return true;
}

// One day's totals for the calendar: counters added across devices, plus the word lists.
export function dayTotals(d) {
  const t = emptyCounters();
  if (!d) return { ...t, estimated: false, met: [], hatched: [], crowned: [], checks: [] };
  for (const c of Object.values(d.dev)) for (const k of COUNTERS) t[k] += c[k] || 0;
  const est = d.dev[EST_DEVICE];
  return { ...t, estimated: Boolean(est?.ms), met: d.met, hatched: d.hatched, crowned: d.crowned, checks: d.checks };
}

const used = d => { const t = dayTotals(d); return t.ms > 0 || t.read + t.pop + t.build + t.games > 0; };

// Month summary: days used, time, and the current run of days in a row (through today or yesterday).
export function monthSummary(daily, year, month, now) {
  const days = Object.keys(daily).filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}-`) && used(daily[k]));
  const ms = days.reduce((s, k) => s + dayTotals(daily[k]).ms, 0);
  // Step back by calendar days (not 24 h, which a clock change would throw off).
  let streak = 0;
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  if (!used(daily[dayKey(d)])) d.setDate(d.getDate() - 1);
  while (used(daily[dayKey(d)])) { streak++; d.setDate(d.getDate() - 1); }
  return { days: days.length, ms, avgMs: days.length ? ms / days.length : 0, streak };
}

export const usedDay = used;
