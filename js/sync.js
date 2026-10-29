// Sync between devices (owner, 2026-10-28): the child's progress is kept in Firestore under a long
// random sync code; every device with the code keeps the same progress. Plain fetch calls to the
// Firebase REST APIs (no SDK). Each device signs in anonymously; the database rules only allow
// reading or writing a record whose exact code you know (no listing, no deleting). No names.
// The web API key below only identifies the project; the rules are what protect the data.
//
// Versions and conflicts (owner, 2026-10-28): every save bumps a revision number and is also kept in
// one of 4 version slots (rev % 4), so the last 4 saves can be restored. A device remembers the
// revision it last synced with (baseRev) and whether it has changed anything since (dirty):
// - cloud unchanged since our last sync: we save ours (if we changed anything);
// - cloud changed, we didn't: we take the cloud copy (opening the app loads the latest);
// - both changed: a conflict; the grown-up picks combine / this device / one of the 4 versions.
// Saves are conditional on the record not having changed since we read it, so two devices can't
// overwrite each other in the same instant.
import { mergeStates } from './storage.js';

const FIREBASE = { apiKey: 'AIzaSyCUEwfs4nPD-ss8Sii8kZoLiiVvUN8bTx8', projectId: 'sight-words-13cab' };
const KEY = 'sightwords.sync';   // { code, refreshToken, baseRev, dirty, deviceId, lastSync, lastError } (this device)
const BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents`;
const DOC = code => `${BASE}/kids/${encodeURIComponent(code)}`;
const VERSION_DOC = (code, slot) => `${DOC(code)}/versions/${slot}`;
export const VERSIONS = 4;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const store = info => { try { localStorage.setItem(KEY, JSON.stringify(info)); } catch { /* private mode */ } };
const update = patch => store({ ...load(), ...patch });
export const syncInfo = () => load();

// Something changed on this device since the last sync (main.js calls this on every save).
export function markDirty() { const info = load(); if (info.code && !info.dirty) update({ dirty: true }); }

function deviceId() {
  let { deviceId: id } = load();
  if (!id) { id = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join(''); update({ deviceId: id }); }
  return id;
}
export function deviceLabel(ua = navigator.userAgent) {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Computer';
}

// ---- codes: four friendly words and four letters/digits, e.g. PINK-OTTER-MOON-STAR-7Q2K

const WORDS = ['PINK', 'OTTER', 'MOON', 'STAR', 'BUNNY', 'CLOUD', 'BERRY', 'PEARL', 'MAPLE', 'TULIP', 'PANDA', 'COMET',
  'HONEY', 'LEMON', 'MANGO', 'PEACH', 'ROBIN', 'SWAN', 'TIGER', 'ZEBRA', 'FROG', 'KOALA', 'LILAC', 'DAISY', 'OCEAN',
  'RIVER', 'SUNNY', 'BREEZE', 'CANDY', 'COCOA', 'FAIRY', 'GIGGLE', 'JELLY', 'KITE', 'LLAMA', 'MITTEN', 'NOODLE',
  'OWL', 'PIXIE', 'QUILT', 'RAINBOW', 'SPROUT', 'TEAPOT', 'UNICORN', 'VIOLET', 'WAFFLE', 'YOYO', 'ACORN', 'BUBBLE',
  'CUPCAKE', 'DRAGON', 'EMBER', 'FEATHER', 'GLITTER', 'HAZEL', 'IGLOO', 'JASMINE', 'KIWI', 'LADYBUG', 'MEADOW',
  'NUTMEG', 'ORCHID', 'PUFFIN', 'SNOWY'];
const CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const rand = n => crypto.getRandomValues(new Uint32Array(1))[0] % n;

export function newCode() {
  const words = Array.from({ length: 4 }, () => WORDS[rand(WORDS.length)]);
  const tail = Array.from({ length: 4 }, () => CHARS[rand(CHARS.length)]).join('');
  return [...words, tail].join('-');
}

// Typed codes: any case, spaces or dashes between parts.
export const normalizeCode = text => String(text || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
export const codeLooksValid = code => code.length >= 20 && code.split('-').length >= 4;

// A new code (or one typed in): this device hasn't synced with it yet. Its own progress counts as
// unsynced if there is any, so joining a code that already has progress asks before mixing.
export function setCode(code, hasProgress = false) { update({ code, baseRev: null, dirty: hasProgress, lastSync: 0, lastError: '' }); }
export function clearCode() { const { refreshToken, deviceId: id } = load(); store({ refreshToken, deviceId: id }); }

// ---- anonymous sign-in (an ID token, refreshed with the saved refresh token)

let token = null;   // { id, until }
async function idToken() {
  if (token && Date.now() < token.until) return token.id;
  const info = load();
  let res, body;
  if (info.refreshToken) {
    res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${FIREBASE.apiKey}`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(info.refreshToken)}`,
    });
    body = await res.json().catch(() => ({}));
    if (res.ok) {
      token = { id: body.id_token, until: Date.now() + (Number(body.expires_in) - 120) * 1000 };
      update({ refreshToken: body.refresh_token });
      return token.id;
    }
  }
  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sign-in failed (${body.error?.message || res.status})`);
  token = { id: body.idToken, until: Date.now() + (Number(body.expiresIn) - 120) * 1000 };
  update({ refreshToken: body.refreshToken });
  return token.id;
}

// ---- read / write

const auth = async () => ({ Authorization: `Bearer ${await idToken()}` });

function parseDoc(doc) {
  const f = doc.fields || {};
  return {
    state: JSON.parse(f.state?.stringValue || 'null'),
    rev: Number(f.rev?.integerValue || 0),
    device: f.device?.stringValue || '',
    deviceId: f.deviceId?.stringValue || '',
    updated: Date.parse(f.updated?.timestampValue || doc.updateTime) || 0,
    updateTime: doc.updateTime,
  };
}

async function readDoc(url) {
  const res = await fetch(url, { headers: await auth(), cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`couldn't read (${res.status})`);
  return parseDoc(await res.json());
}

class Changed extends Error {}

// Saves `state` as revision `rev`: the main record (only if it hasn't changed since `updateTime`;
// null = it must not exist yet), then the same into version slot rev % 4.
async function save(code, state, rev, updateTime) {
  const { settings, ...shared } = state;   // settings stay per device (full screen, volume…)
  const body = JSON.stringify({ fields: {
    state: { stringValue: JSON.stringify(shared) },
    updated: { timestampValue: new Date().toISOString() },
    v: { integerValue: '1' },
    rev: { integerValue: String(rev) },
    device: { stringValue: deviceLabel() },
    deviceId: { stringValue: deviceId() },
  } });
  const cond = updateTime ? `currentDocument.updateTime=${encodeURIComponent(updateTime)}` : 'currentDocument.exists=false';
  const headers = { ...(await auth()), 'Content-Type': 'application/json' };
  const res = await fetch(`${DOC(code)}?${cond}`, { method: 'PATCH', headers, body });
  if (res.status === 400 || res.status === 409 || res.status === 412) {
    const err = await res.json().catch(() => ({}));
    if (/FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(err.error?.status || '')) throw new Changed('changed meanwhile');
  }
  if (!res.ok) throw new Error(`couldn't save (${res.status})`);
  // The version copy is best effort: the main record is what every device reads first.
  await fetch(VERSION_DOC(code, rev % VERSIONS), { method: 'PATCH', headers, body }).catch(() => {});
  update({ baseRev: rev, dirty: false, lastSync: Date.now(), lastError: '' });
}

// The saved versions, newest first: [{ rev, updated, device, state, mine }].
export async function listVersions() {
  const { code } = load();
  const docs = await Promise.all(Array.from({ length: VERSIONS }, (_, i) => readDoc(VERSION_DOC(code, i)).catch(() => null)));
  const id = deviceId();
  return docs.filter(Boolean).sort((a, b) => b.rev - a.rev).map(d => ({ ...d, mine: d.deviceId === id }));
}

// One sync. Returns { state } (null = nothing to change here), or { conflict: { remote } } when both
// this device and the cloud changed. midGame: never change local state and never prompt (a conflict
// waits for the meadow). Throws with a short message when offline etc.
let running = null;
export function syncNow(local, { midGame = false } = {}) {
  const { code } = load();
  if (!code) return Promise.resolve({ state: null });
  running = running || (async () => {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const info = load();
        const remote = await readDoc(DOC(code));
        try {
          // Synced before versions existed (no baseRev saved): combine once, quietly, like before.
          if (info.baseRev === undefined && remote) {
            const next = mergeStates(local, remote.state);
            if (!midGame) { await save(code, next, remote.rev + 1, remote.updateTime); return { state: next, adopted: remote }; }
            return { state: null };
          }
          if (!remote) { await save(code, local, 1, null); return { state: null }; }
          if (remote.rev === info.baseRev) {
            if (info.dirty) await save(code, local, remote.rev + 1, remote.updateTime);
            else update({ lastSync: Date.now(), lastError: '' });
            return { state: null };
          }
          // Someone else saved since our last sync.
          if (!info.dirty) {
            if (midGame) return { state: null };
            update({ baseRev: remote.rev, lastSync: Date.now(), lastError: '' });
            return { state: remote.state, adopted: remote };
          }
          return { conflict: midGame ? null : { remote } };
        } catch (err) {
          if (err instanceof Changed && attempt === 0) continue;   // another device just saved: look again
          throw err;
        }
      }
      return { state: null };
    } catch (err) {
      update({ lastError: err.message || 'offline' });
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}

// The grown-up's answer to a conflict: 'combine', 'device', or a version's state. Saves it as the
// newest revision (so the other devices pick it up) and returns the state to use here.
export async function resolveConflict(local, choice) {
  const { code } = load();
  const remote = await readDoc(DOC(code));
  let next = local;
  if (choice === 'combine') next = remote ? mergeStates(local, remote.state) : local;
  else if (choice !== 'device') next = { ...choice, settings: local.settings };
  await save(code, next, (remote?.rev || 0) + 1, remote?.updateTime || null);
  return next;
}
