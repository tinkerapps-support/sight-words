// Saved progress (localStorage) plus backup export/import (PLAN.md §7, §9).
import { newRecord } from './engine.js';
import { CONFIG } from './config.js';
import { LISTS } from './lists.js';

const KEY = 'sightwords.v1';
const VERSION = 1;

export function defaultState() {
  return {
    v: VERSION,
    setupDone: false,
    words: {},
    hatched: [],      // creatures stay hatched even if their word slips later
    meter: 0,
    stickers: [],     // one per finished session: { t, id }
    sessions: [],     // { t, cards, correct, fast }
    checks: [],       // Word Check results: { t, right, total, missed, asked }
    resets: {},       // word -> when the parent reset it (so sync doesn't bring old progress back)
    resetAll: 0,      // when all progress was last reset
    toysOpened: {},   // list id -> how many of that meadow's toy presents have been opened
    settings: {
      lists: [LISTS[0].id],
      fullscreen: false,
      wakeLock: true,
      voiceVolume: 0.9,
      effects: true,
      music: true,
      sessionLength: 'normal',
    },
  };
}

// Fill any missing fields so older saves keep working after an update.
export function normalize(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION || typeof raw.words !== 'object') return null;
  const state = { ...base, ...raw, settings: { ...base.settings, ...(raw.settings || {}) } };
  for (const [w, rec] of Object.entries(state.words)) {
    if (!rec || typeof rec !== 'object' || typeof rec.level !== 'number' || rec.level < 0 || rec.level > 5) {
      delete state.words[w];
      continue;
    }
    state.words[w] = { ...newRecord(), ...rec, history: Array.isArray(rec.history) ? rec.history : [] };
  }
  for (const k of ['hatched', 'stickers', 'sessions', 'checks']) if (!Array.isArray(state[k])) state[k] = [];
  if (!state.resets || typeof state.resets !== 'object') state.resets = {};
  if (typeof state.resetAll !== 'number') state.resetAll = 0;
  if (!state.toysOpened || typeof state.toysOpened !== 'object') state.toysOpened = {};
  state.settings.lists = state.settings.lists.filter(id => LISTS.some(l => l.id === id));
  if (!state.settings.lists.length) state.settings.lists = [LISTS[0].id];
  return state;
}

export function load(storage = globalThis.localStorage) {
  try {
    const text = storage?.getItem(KEY);
    if (text) return normalize(JSON.parse(text)) || defaultState();
  } catch { /* private mode or corrupt save: start fresh */ }
  return defaultState();
}

export function save(state, storage = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function exportText(state) {
  return JSON.stringify({ app: 'sightwords', exported: new Date().toISOString(), ...state }, null, 1);
}

// Returns the new state, or throws an Error with a message for the parent.
export function importText(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('That file is not a Sight Words backup.'); }
  if (raw?.app !== 'sightwords') throw new Error('That file is not a Sight Words backup.');
  delete raw.app;
  delete raw.exported;
  const state = normalize(raw);
  if (!state) throw new Error('This backup is from a different version and can\'t be loaded.');
  return state;
}

export function record(state, word) {
  if (!state.words[word]) state.words[word] = newRecord();
  return state.words[word];
}

// Sync (sync.js): combine this device's progress with the synced copy so nothing is lost.
// Each word keeps the record that's further along (level, then cards seen, then most recent),
// with the history of both. Stickers, games and Word Checks from both are kept. Anything older than
// a reset (one word, or everything) is dropped. Settings and the rainbow meter stay per device.
export function mergeStates(local, remoteRaw) {
  const remote = normalize({ ...remoteRaw, v: VERSION, settings: local.settings }) || defaultState();
  const resetAll = Math.max(local.resetAll || 0, remote.resetAll || 0);
  const resets = { ...remote.resets };
  for (const [w, t] of Object.entries(local.resets || {})) resets[w] = Math.max(resets[w] || 0, t);
  const touched = r => Math.max(r.lastSeen || 0, r.levelSince || 0);
  const alive = (w, r) => r && touched(r) >= Math.max(resetAll, resets[w] || 0);
  const ahead = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    if (a.level !== b.level) return a.level > b.level ? a : b;
    if (a.seen !== b.seen) return a.seen > b.seen ? a : b;
    return touched(a) >= touched(b) ? a : b;
  };
  const words = {};
  for (const w of new Set([...Object.keys(local.words), ...Object.keys(remote.words)])) {
    const a = alive(w, local.words[w]) ? local.words[w] : null;
    const b = alive(w, remote.words[w]) ? remote.words[w] : null;
    if (!a && !b) continue;
    const rec = structuredClone(ahead(a, b));
    const seen = new Set();
    rec.history = [...(a?.history || []), ...(b?.history || [])]
      .filter(h => { const k = `${h.t}|${h.r}`; return !seen.has(k) && seen.add(k); })
      .sort((x, y) => x.t - y.t).slice(-CONFIG.historyCap);
    rec.built = Boolean(a?.built || b?.built);
    words[w] = rec;
  }
  // Lists of events, kept from both devices once each (by time), minus anything before a full reset.
  const events = k => {
    const seen = new Set();
    return [...local[k], ...remote[k]]
      .filter(e => e && e.t >= resetAll && !seen.has(e.t) && seen.add(e.t))
      .sort((x, y) => x.t - y.t);
  };
  const hatched = [...new Set([...local.hatched, ...remote.hatched])].filter(w => words[w]);
  const toysOpened = resetAll > (local.resetAll || 0) ? {} : { ...local.toysOpened };
  if ((remote.resetAll || 0) >= (local.resetAll || 0)) {
    for (const [id, n] of Object.entries(remote.toysOpened || {})) toysOpened[id] = Math.max(toysOpened[id] || 0, n);
  }
  return {
    ...local,
    setupDone: local.setupDone || remote.setupDone,
    words, hatched, resets, resetAll, toysOpened,
    stickers: events('stickers'), sessions: events('sessions'), checks: events('checks').slice(-50),
  };
}
