// Saved progress (localStorage) plus backup export/import (PLAN.md §7, §9).
import { newRecord } from './engine.js';
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
    checks: [],       // Word Check results: { t, right, total, missed }
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
