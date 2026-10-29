// Sync between devices (owner, 2026-10-28): the child's progress is kept in Firestore under a long
// random sync code; every device with the code keeps the same progress. Plain fetch calls to the
// Firebase REST APIs (no SDK). Each device signs in anonymously; the database rules only allow
// reading or writing a record whose exact code you know (no listing, no deleting). No names.
// The web API key below only identifies the project; the rules are what protect the data.
import { mergeStates } from './storage.js';

const FIREBASE = { apiKey: 'AIzaSyCUEwfs4nPD-ss8Sii8kZoLiiVvUN8bTx8', projectId: 'sight-words-13cab' };
const KEY = 'sightwords.sync';   // { code, refreshToken, lastSync, lastError } (this device only)
const DOC = code => `https://firestore.googleapis.com/v1/projects/${FIREBASE.projectId}/databases/(default)/documents/kids/${encodeURIComponent(code)}`;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const store = info => { try { localStorage.setItem(KEY, JSON.stringify(info)); } catch { /* private mode */ } };
export const syncInfo = () => load();

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

export function setCode(code) { store({ ...load(), code, lastSync: 0, lastError: '' }); }
export function clearCode() { const { refreshToken } = load(); store({ refreshToken }); }

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
      store({ ...load(), refreshToken: body.refresh_token });
      return token.id;
    }
  }
  res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${FIREBASE.apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }),
  });
  body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sign-in failed (${body.error?.message || res.status})`);
  token = { id: body.idToken, until: Date.now() + (Number(body.expiresIn) - 120) * 1000 };
  store({ ...load(), refreshToken: body.refreshToken });
  return token.id;
}

// ---- read / write the child's record

async function readRemote(code) {
  const res = await fetch(DOC(code), { headers: { Authorization: `Bearer ${await idToken()}` }, cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`couldn't read (${res.status})`);
  const doc = await res.json();
  return JSON.parse(doc.fields?.state?.stringValue || 'null');
}

async function writeRemote(code, state) {
  const { settings, ...shared } = state;   // settings stay per device (full screen, volume…)
  const res = await fetch(DOC(code), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${await idToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: {
      state: { stringValue: JSON.stringify(shared) },
      updated: { timestampValue: new Date().toISOString() },
      v: { integerValue: '1' },
    } }),
  });
  if (!res.ok) throw new Error(`couldn't save (${res.status})`);
}

// Pull, merge (nothing is lost: each word keeps the copy that's further along), push.
// Returns the merged state, or null when sync is off. Throws with a short message on failure.
let running = null;
export function syncNow(local) {
  const { code } = load();
  if (!code) return Promise.resolve(null);
  running = running || (async () => {
    try {
      const remote = await readRemote(code);
      const merged = remote ? mergeStates(local, remote) : local;
      await writeRemote(code, merged);
      store({ ...load(), lastSync: Date.now(), lastError: '' });
      return merged;
    } catch (err) {
      store({ ...load(), lastError: err.message || 'offline' });
      throw err;
    } finally {
      running = null;
    }
  })();
  return running;
}
