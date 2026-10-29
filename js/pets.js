// Hatched friends live in the meadow (owner, 2026-10-28): they wander, visit each other and say
// hello, hop when tapped (and say their word), can be picked up and dropped next to a friend, and
// come running to a tap on the grass. Plain DOM + one animation loop; it only runs while the home
// screen shows. Motion is all transforms on the felt creature art (no extra poses needed).
//
// Toys (owner, 2026-10-28): every 5 hatched friends on a meadow earn a toy. It arrives as a wrapped
// present to tap open. Toys move when tapped and can be dragged to a new spot; friends wander over to
// play now and then, and a friend dropped on a toy starts playing straight away.
import * as audio from './audio.js';
import { wordId } from './voice-lines.js';

const SIZE = 66;            // pet size in CSS px
const SPEED = [34, 58];     // walking speed range, px/s
const MEET = SIZE * 0.95;   // close enough to say hello

let layer = null;
let pets = new Map();       // word -> pet; kept across re-renders so friends stay where they were
let toys = new Map();       // kind -> toy (this meadow page)
let present = null;         // the wrapped present waiting to be opened, if any
let pageKey = '';           // which meadow page the toys belong to
let running = false;
let last = 0;
let opts = null;            // { html(word), crowned(word), heart(), art(name), toys: { kinds, present, onOpen } }

const rand = (a, b) => a + Math.random() * (b - a);
const bounds = () => ({ w: Math.max(0, layer.clientWidth - SIZE), h: Math.max(0, layer.clientHeight - SIZE) });

function place(p) {
  p.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  // Lower on screen = in front; a friend on a toy is always in front of it.
  p.el.style.zIndex = String(p.toy ? toyZ(p.toy) + 1 : 10 + Math.round(p.y));
  p.flip.classList.toggle('left', p.facing < 0);
}

function setMode(p, mode, ms = 0) {
  p.mode = mode;
  p.until = performance.now() + ms;
  p.body.classList.toggle('walking', ['walk', 'visit', 'come', 'toToy', 'chase'].includes(mode));
}

// A one-off body animation (hop, cheer, hello): restarts even if it's already playing.
function act(p, cls) {
  p.body.classList.remove('hop', 'cheer', 'hello', 'land');
  void p.body.offsetWidth;
  p.body.classList.add(cls);
}

// A little felt heart floats up between two friends (or over one).
function heart(x, y) {
  const h = document.createElement('span');
  h.className = 'pet-heart';
  h.innerHTML = opts.heart();
  h.style.left = `${x + SIZE / 2 - 14}px`;
  h.style.top = `${y - 6}px`;
  layer.appendChild(h);
  setTimeout(() => h.remove(), 1300);
}

function greet(a, b, loud) {
  const now = performance.now();
  for (const [p, q] of [[a, b], [b, a]]) {
    p.facing = q.x >= p.x ? 1 : -1;
    setMode(p, 'greet', 1300);
    p.lastGreet = now;
    act(p, 'hello');
    place(p);
  }
  heart((a.x + b.x) / 2, Math.min(a.y, b.y));
  if (loud) audio.chime.squeak();
}

function newPet(word) {
  const el = document.createElement('div');
  el.className = 'pet';
  el.innerHTML = `<div class="pet-shadow"></div><div class="pet-flip"><div class="pet-body"></div></div>`;
  const p = {
    word, el, flip: el.querySelector('.pet-flip'), body: el.querySelector('.pet-body'),
    x: 0, y: 0, tx: 0, ty: 0, facing: 1, speed: rand(...SPEED), mode: 'idle', until: 0, lastGreet: 0,
    friend: null, toy: null, slot: -1, kicks: 0, lastToy: 0,
  };
  el.addEventListener('pointerdown', e => grab(p, e));
  // One-off moves end by themselves so the walk animation can come back.
  p.body.addEventListener('animationend', ev => {
    if (ev.animationName.startsWith('pet-') && ev.animationName !== 'pet-walk') p.body.classList.remove('hop', 'cheer', 'hello', 'land');
    if (ev.animationName === 'ride-slide') slideDone(p);
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
  return p;
}

// Tap = hop and say the word; drag = carry it around; drop next to a friend = they say hello;
// drop on a toy = play with it.
function grab(p, e) {
  e.preventDefault();
  e.stopPropagation();
  try { p.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const x0 = e.clientX, y0 = e.clientY;
  let px = p.x, py = p.y;
  let dragging = false;
  const move = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!dragging && Math.hypot(dx, dy) < 8) return;
    if (!dragging) {
      dragging = true;
      leaveToy(p);
      px = p.x; py = p.y;
      setMode(p, 'held');
      p.el.classList.add('held');
      audio.chime.squeak();
    }
    const { w, h } = bounds();
    p.facing = dx >= 0 ? 1 : -1;
    p.x = Math.min(w, Math.max(0, px + dx));
    p.y = Math.min(h, Math.max(0, py + dy));
    place(p);
  };
  const up = () => {
    p.el.removeEventListener('pointermove', move);
    p.el.removeEventListener('pointerup', up);
    p.el.removeEventListener('pointercancel', up);
    p.el.classList.remove('held');
    if (!dragging) { if (!p.toy) tap(p); return; }
    act(p, 'land');
    const t = toyAt(p.x + SIZE / 2, p.y + SIZE * 0.7);
    if (t && freeSlot(t) >= 0) { startPlay(p, t, freeSlot(t)); audio.chime.squeak(); return; }
    const near = nearest(p);
    if (near && near.d < MEET * 1.4) greet(p, near.q, true);
    else setMode(p, 'idle', rand(800, 1600));
  };
  p.el.addEventListener('pointermove', move);
  p.el.addEventListener('pointerup', up);
  p.el.addEventListener('pointercancel', up);
}

function tap(p) {
  setMode(p, 'idle', 1400);
  act(p, 'hop');
  heart(p.x, p.y);
  audio.chime.squeak();
  audio.say(wordId(p.word), p.word, { now: true });
  // Friends nearby turn to look and cheer along.
  for (const q of pets.values()) {
    if (q === p || q.toy || q.mode === 'held' || Math.hypot(q.x - p.x, q.y - p.y) > SIZE * 2.2) continue;
    q.facing = p.x >= q.x ? 1 : -1;
    setMode(q, 'idle', 1200);
    place(q);
    setTimeout(() => act(q, 'cheer'), 120 + Math.random() * 200);
  }
}

// A tap on the grass: everyone comes running (a little scattered, so they don't pile up).
export function call(clientX, clientY) {
  if (!layer || !pets.size) return;
  const r = layer.getBoundingClientRect();
  const { w, h } = bounds();
  const cx = clientX - r.left - SIZE / 2, cy = clientY - r.top - SIZE / 2;
  const spark = document.createElement('span');
  spark.className = 'pet-call';
  spark.style.left = `${cx + SIZE / 2 - 20}px`;
  spark.style.top = `${cy + SIZE / 2 - 20}px`;
  layer.appendChild(spark);
  setTimeout(() => spark.remove(), 900);
  audio.chime.twinkle();
  let i = 0;
  for (const p of pets.values()) {
    if (p.mode === 'held') continue;
    leaveToy(p);
    const a = (i++ / pets.size) * Math.PI * 2;
    p.tx = Math.min(w, Math.max(0, cx + Math.cos(a) * SIZE * 0.8));
    p.ty = Math.min(h, Math.max(0, cy + Math.sin(a) * SIZE * 0.6));
    p.speed = rand(...SPEED) * 1.8;
    setMode(p, 'come');
  }
}

function nearest(p) {
  let best = null;
  for (const q of pets.values()) {
    if (q === p || q.toy) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { q, d };
  }
  return best;
}

// ---------------------------------------------------------------- toys

// Size (CSS px) and where a friend goes to play: its top-left relative to the toy's top-left.
// Sized to Codex's felt art (toy-*.webp, trimmed to the drawing); the drawn fallbacks fit the same boxes.
const TOYS = {
  swing: { w: 132, h: 90, slots: [[33, 22]], ms: 5200 },
  ball: { w: 44, h: 44, slots: [[-54, -24]], ms: 0 },
  slide: { w: 128, h: 96, slots: [[-16, 30]], ms: 0 },
  trampoline: { w: 108, h: 78, slots: [[21, -31]], ms: 4500 },
  seesaw: { w: 136, h: 50, slots: [[-4, -50], [74, -50]], ms: 6000 },
};
export const TOY_ORDER = ['swing', 'ball', 'slide', 'trampoline', 'seesaw'];
// Where each toy first appears (fractions of the meadow).
const HOME = { swing: [0.04, 0.05], ball: [0.72, 0.1], slide: [0.5, 0.36], trampoline: [0.08, 0.6], seesaw: [0.44, 0.8] };

const toyZ = t => 10 + Math.round(t.y + t.h - SIZE) - 2;
const POS_KEY = 'sightwords.toys';
const savedPos = () => { try { return JSON.parse(localStorage.getItem(POS_KEY)) || {}; } catch { return {}; } };
function savePos(t) {
  const all = savedPos();
  all[`${pageKey}:${t.kind}`] = [t.x / Math.max(1, layer.clientWidth), t.y / Math.max(1, layer.clientHeight)];
  try { localStorage.setItem(POS_KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

// Felt art when Codex's toy pictures exist; a simple drawn toy otherwise.
function toyHtml(kind) {
  const a = n => opts.art(`toy-${n}`);
  const img = (n, cls) => `<img class="${cls}" src="${a(n)}" alt="" draggable="false">`;
  switch (kind) {
    case 'swing': return a('swing-frame') && a('swing-seat')
      ? `${img('swing-frame', 't-frame')}<div class="t-seat">${img('swing-seat', 't-seat-img')}</div>`
      : `<div class="t-frame"><i class="leg l"></i><i class="leg r"></i><i class="bar"></i></div><div class="t-seat"><i class="rope l"></i><i class="rope r"></i><i class="board"></i></div>`;
    case 'ball': return `<div class="t-ball">${a('ball') ? img('ball', 't-ball-img') : ''}</div>`;
    case 'slide': return a('slide') ? img('slide', 't-whole')
      : `<i class="ladder"></i><i class="deck"></i><i class="chute"></i>`;
    case 'trampoline': return a('trampoline') ? `<div class="t-mat">${img('trampoline', 't-whole')}</div>`
      : `<i class="tleg l"></i><i class="tleg r"></i><div class="t-mat"><i class="rim"></i></div>`;
    case 'seesaw': return a('seesaw-base') && a('seesaw-plank')
      ? `${img('seesaw-base', 't-base')}<div class="t-plank">${img('seesaw-plank', 't-plank-img')}</div>`
      : `<i class="t-base"></i><div class="t-plank"><i class="board"></i></div>`;
    default: return '';
  }
}

function makeToy(kind, x, y) {
  const g = TOYS[kind];
  const el = document.createElement('div');
  el.className = `toy toy-${kind}` + (opts.art(`toy-${kind === 'swing' ? 'swing-frame' : kind === 'seesaw' ? 'seesaw-base' : kind}`) ? ' felt' : '');
  el.style.width = `${g.w}px`;
  el.style.height = `${g.h}px`;
  el.innerHTML = toyHtml(kind);
  const t = { kind, el, x, y, w: g.w, h: g.h, users: g.slots.map(() => null) };
  el.addEventListener('pointerdown', e => grabToy(t, e));
  el.addEventListener('contextmenu', e => e.preventDefault());
  placeToy(t);
  return t;
}

function placeToy(t) {
  t.el.style.transform = `translate(${t.x}px, ${t.y}px)`;
  t.el.style.zIndex = String(toyZ(t));
}

const freeSlot = t => t.users.findIndex(u => !u);
function toyAt(x, y) {
  for (const t of toys.values()) {
    if (x > t.x - 20 && x < t.x + t.w + 20 && y > t.y - 30 && y < t.y + t.h + 20) return t;
  }
  return null;
}

// Tap a toy and it moves by itself; drag it to put it somewhere else.
function grabToy(t, e) {
  e.preventDefault();
  e.stopPropagation();
  try { t.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const x0 = e.clientX, y0 = e.clientY, tx0 = t.x, ty0 = t.y;
  let dragging = false;
  const busy = t.users.some(Boolean);
  const move = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (busy || (!dragging && Math.hypot(dx, dy) < 8)) return;
    dragging = true;
    t.el.classList.add('held');
    t.x = Math.min(layer.clientWidth - t.w, Math.max(0, tx0 + dx));
    t.y = Math.min(layer.clientHeight - t.h, Math.max(0, ty0 + dy));
    placeToy(t);
  };
  const up = () => {
    t.el.removeEventListener('pointermove', move);
    t.el.removeEventListener('pointerup', up);
    t.el.removeEventListener('pointercancel', up);
    t.el.classList.remove('held');
    if (dragging) { savePos(t); audio.chime.pop(); return; }
    poke(t);
  };
  t.el.addEventListener('pointermove', move);
  t.el.addEventListener('pointerup', up);
  t.el.addEventListener('pointercancel', up);
}

function anim(el, cls) {
  if (!el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
}

function poke(t) {
  switch (t.kind) {
    case 'ball': kickBall(t); break;
    case 'swing': anim(t.el, 'sway'); audio.chime.whoosh(); break;
    case 'slide': anim(t.el, 'wiggle'); audio.chime.whoosh(); break;
    case 'trampoline': anim(t.el, 'boing'); audio.chime.pop(); break;
    case 'seesaw': anim(t.el, 'tip'); audio.chime.tap(); break;
  }
}

// The ball rolls off to a new spot, spinning as it goes.
function kickBall(t, towardsX = null) {
  const W = layer.clientWidth - t.w, H = layer.clientHeight - t.h;
  const dir = towardsX === null ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(towardsX) || 1;
  const nx = Math.min(W, Math.max(0, t.x + dir * rand(70, 150)));
  const ny = Math.min(H, Math.max(0, t.y + rand(-70, 70)));
  t.spin = (t.spin || 0) + (nx - t.x) * 3;
  t.x = nx; t.y = ny;
  t.el.style.transition = 'transform 0.9s cubic-bezier(.2,.7,.3,1)';
  placeToy(t);
  const ball = t.el.querySelector('.t-ball');
  if (ball) { ball.style.transition = 'transform 0.9s cubic-bezier(.2,.7,.3,1)'; ball.style.transform = `rotate(${t.spin}deg)`; }
  setTimeout(() => { t.el.style.transition = ''; }, 950);
  audio.chime.pop();
}

function slotPos(t, i) {
  const [sx, sy] = TOYS[t.kind].slots[i];
  return { x: t.x + sx, y: t.y + sy };
}

function startPlay(p, t, slot) {
  leaveToy(p);
  p.toy = t;
  p.slot = slot;
  t.users[slot] = p;
  const pos = slotPos(t, slot);
  p.x = pos.x; p.y = pos.y;
  p.facing = t.kind === 'ball' ? 1 : t.kind === 'seesaw' ? (slot === 0 ? 1 : -1) : 1;
  p.body.classList.remove('hop', 'cheer', 'hello', 'land');
  place(p);
  if (t.kind === 'ball') {
    p.kicks = 3;
    setMode(p, 'kick', 350);
    return;
  }
  p.el.classList.add(`ride-${t.kind}`, `slot-${slot}`);
  t.el.classList.add('active');
  setMode(p, 'play', TOYS[t.kind].ms || 99999);
  if (t.kind === 'seesaw') {
    // A second rider: restart the plank and both riders together so they move as one.
    const riders = t.users.filter(Boolean);
    if (riders.length > 1) {
      t.el.classList.remove('active');
      riders.forEach(r => r.el.classList.remove('ride-seesaw'));
      void t.el.offsetWidth;
      t.el.classList.add('active');
      riders.forEach(r => { r.el.classList.add('ride-seesaw'); r.until = performance.now() + TOYS.seesaw.ms; });
    } else inviteToSeesaw(t);
  }
}

// One friend on the seesaw asks another to come and ride the other end.
function inviteToSeesaw(t) {
  const slot = freeSlot(t);
  if (slot < 0) return;
  const free = [...pets.values()].filter(q => !q.toy && q.mode !== 'held');
  if (!free.length) return;
  const q = free[Math.floor(Math.random() * free.length)];
  q.toyGoal = { t, slot };
  q.speed = rand(...SPEED) * 1.3;
  setMode(q, 'toToy');
}

// The slide is one ride: climb, whoosh down, hop off at the bottom.
function slideDone(p) {
  if (!p.toy || p.toy.kind !== 'slide') return;
  const t = p.toy;
  leaveToy(p);
  // Where the ride animation ended: the bottom of the chute (slot + 104 px across).
  const [sx, sy] = TOYS.slide.slots[0];
  p.x = Math.min(bounds().w, t.x + sx + 104);
  p.y = t.y + sy;
  place(p);
  act(p, 'cheer');
  heart(p.x, p.y);
  setMode(p, 'idle', rand(800, 1600));
}

function leaveToy(p) {
  const t = p.toy;
  p.toyGoal = null;
  if (!t) return;
  t.users[p.slot] = null;
  p.el.classList.remove(`ride-${t.kind}`, 'slot-0', 'slot-1');
  if (!t.users.some(Boolean)) t.el.classList.remove('active');
  p.toy = null;
  p.slot = -1;
  p.lastToy = performance.now();
  // Step off to the side so the next friend can get on (the slide puts its rider at the bottom).
  if (t.kind !== 'slide') p.y = Math.min(bounds().h, t.y + t.h - SIZE * 0.6);
  place(p);
}

// ---------------------------------------------------------------- the present

function showPresent(kind) {
  const el = document.createElement('div');
  el.className = 'toy present';
  const art = opts.art('toy-present');
  el.innerHTML = art ? `<img src="${art}" alt="" draggable="false">` : '<span>🎁</span>';
  const [fx, fy] = HOME[kind];
  const x = Math.min(layer.clientWidth - 84, fx * layer.clientWidth), y = Math.min(layer.clientHeight - 84, fy * layer.clientHeight);
  el.style.transform = `translate(${x}px, ${y}px)`;
  el.style.zIndex = '5000';
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    e.stopPropagation();
    if (el.classList.contains('opening')) return;
    el.classList.add('opening');
    audio.chime.drumroll();
    setTimeout(() => {
      el.remove();
      present = null;
      const t = makeToy(kind, Math.max(0, x + 42 - TOYS[kind].w / 2), Math.max(0, y + 84 - TOYS[kind].h));
      t.el.classList.add('arrive');
      toys.set(kind, t);
      layer.appendChild(t.el);
      savePos(t);
      confetti(x + 42, y + 30);
      audio.chime.fanfare();
      for (const p of pets.values()) if (!p.toy) setTimeout(() => act(p, 'cheer'), Math.random() * 400);
      opts.toys.onOpen(kind);
      setTimeout(() => audio.say('new-toy', 'A new toy for your friends!'), 500);
      // The first friend to notice runs over to try it.
      setTimeout(() => {
        const free = [...pets.values()].filter(q => !q.toy && q.mode !== 'held');
        if (free.length) { const q = free[0]; q.toyGoal = { t, slot: 0 }; q.speed = rand(...SPEED) * 1.5; setMode(q, 'toToy'); }
      }, 1500);
    }, 1100);
  });
  layer.appendChild(el);
  present = { kind, el };
  setTimeout(() => audio.say('present', 'A present! Tap it to open it.'), 900);
}

function confetti(x, y) {
  for (let i = 0; i < 16; i++) {
    const s = document.createElement('span');
    s.className = 'toy-confetti';
    s.innerHTML = opts.heart();
    const a = Math.random() * Math.PI * 2, d = 50 + Math.random() * 70;
    s.style.left = `${x - 12}px`;
    s.style.top = `${y - 12}px`;
    s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
    s.style.setProperty('--dy', `${Math.sin(a) * d - 30}px`);
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1100);
  }
}

// ---------------------------------------------------------------- behaviour

// What an idle pet does next: mostly wander, sometimes visit a friend or go play, sometimes sit.
function decide(p, now) {
  const { w, h } = bounds();
  const r = Math.random();
  const others = [...pets.values()].filter(q => q !== p && q.mode !== 'held' && !q.toy);
  const playable = [...toys.values()].filter(t => freeSlot(t) >= 0);
  if (r < 0.2 && playable.length && now - p.lastToy > 8000) {
    const t = playable[Math.floor(Math.random() * playable.length)];
    p.toyGoal = { t, slot: freeSlot(t) };
    p.speed = rand(...SPEED);
    setMode(p, 'toToy');
  } else if (r < 0.4 && others.length && now - p.lastGreet > 6000) {
    p.friend = others[Math.floor(Math.random() * others.length)];
    p.speed = rand(...SPEED);
    setMode(p, 'visit');
  } else if (r < 0.85) {
    p.tx = rand(0, w);
    p.ty = rand(0, h);
    p.speed = rand(...SPEED);
    setMode(p, 'walk');
  } else {
    setMode(p, 'idle', rand(1500, 3500));
    if (Math.random() < 0.5) act(p, 'cheer');
  }
}

function walkTo(p, tx, ty, dt) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 3) return true;
  const s = Math.min(d, p.speed * dt);
  p.x += (dx / d) * s;
  p.y += (dy / d) * s;
  if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
  place(p);
  return false;
}

function step(dt, now) {
  for (const p of pets.values()) {
    if (p.mode === 'held') continue;
    if (p.mode === 'play') {
      if (now >= p.until) { leaveToy(p); act(p, 'cheer'); setMode(p, 'idle', rand(800, 1600)); }
      continue;
    }
    if (p.mode === 'kick') {
      // Ball play: stand by the ball, kick it, chase it, a few times over.
      if (now < p.until) continue;
      const t = p.toy;
      if (!t || p.kicks <= 0) { leaveToy(p); setMode(p, 'idle', rand(800, 1600)); continue; }
      act(p, 'hop');
      kickBall(t, t.x - p.x);
      p.kicks--;
      setMode(p, 'chase');
      continue;
    }
    if (p.mode === 'chase') {
      const t = p.toy;
      if (!t) { setMode(p, 'idle', 500); continue; }
      p.speed = SPEED[1] * 1.6;
      const side = p.x < t.x ? -SIZE + 12 : t.w - 12;
      if (walkTo(p, t.x + side, t.y + t.h - SIZE, dt)) setMode(p, 'kick', 250);
      continue;
    }
    if (p.mode === 'idle' || p.mode === 'greet') {
      if (now >= p.until) decide(p, now);
      continue;
    }
    if (p.mode === 'toToy') {
      const g = p.toyGoal;
      if (!g || !toys.has(g.t.kind) || g.t.users[g.slot]) {
        const s = g && toys.has(g.t.kind) ? freeSlot(g.t) : -1;
        if (s < 0) { p.toyGoal = null; setMode(p, 'idle', 500); continue; }
        g.slot = s;
      }
      const pos = slotPos(g.t, g.slot);
      if (walkTo(p, pos.x, pos.y, dt)) startPlay(p, g.t, g.slot);
      continue;
    }
    let tx = p.tx, ty = p.ty;
    if (p.mode === 'visit') {
      if (!pets.has(p.friend?.word) || p.friend.toy) { setMode(p, 'idle', 500); continue; }
      tx = p.friend.x - p.facing * SIZE * 0.7;
      ty = p.friend.y;
      if (Math.hypot(p.friend.x - p.x, p.friend.y - p.y) < MEET) { greet(p, p.friend, false); continue; }
    }
    if (walkTo(p, tx, ty, dt)) setMode(p, 'idle', rand(1000, 3000));
  }
  // Friends who end up on top of each other drift apart a little (not while on a toy).
  const list = [...pets.values()].filter(p => !p.toy && p.mode !== 'held' && p.mode !== 'toToy');
  const { w, h } = bounds();
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (d >= SIZE * 0.6) continue;
      const push = (SIZE * 0.6 - d) * 0.05;
      a.x = Math.min(w, Math.max(0, a.x - (dx / d) * push)); a.y = Math.min(h, Math.max(0, a.y - (dy / d) * push)); place(a);
      b.x = Math.min(w, Math.max(0, b.x + (dx / d) * push)); b.y = Math.min(h, Math.max(0, b.y + (dy / d) * push)); place(b);
    }
  }
}

function frame(t) {
  if (!running) return;
  const dt = Math.min(0.05, (t - (last || t)) / 1000);
  last = t;
  step(dt, performance.now());
  requestAnimationFrame(frame);
}

// Show these hatched friends and toys (one meadow page) and start the loop.
// options.toys: { page, kinds: toys already opened, present: kind waiting to be opened or null, onOpen(kind) }
export function showPets(host, words, options) {
  opts = options;
  if (layer !== host) { layer = host; pets = new Map(); toys = new Map(); }
  const page = options.toys?.page || '';
  if (page !== pageKey) {
    // Another meadow: its own toys (friends are swapped below by word).
    for (const t of toys.values()) t.el.remove();
    toys = new Map();
    present?.el.remove();
    present = null;
    for (const p of pets.values()) leaveToy(p);
    pageKey = page;
  }
  for (const [w, p] of pets) if (!words.includes(w)) { leaveToy(p); p.el.remove(); pets.delete(w); }
  const { w, h } = bounds();

  const kinds = options.toys?.kinds || [];
  for (const [kind, t] of toys) if (!kinds.includes(kind)) { for (const p of t.users) if (p) leaveToy(p); t.el.remove(); toys.delete(kind); }
  const saved = savedPos();
  for (const kind of kinds) {
    if (toys.has(kind)) { toys.get(kind).el.innerHTML = toyHtml(kind); continue; }
    const g = TOYS[kind];
    const [fx, fy] = saved[`${pageKey}:${kind}`] || HOME[kind];
    const t = makeToy(kind, Math.min(layer.clientWidth - g.w, fx * layer.clientWidth), Math.min(layer.clientHeight - g.h, fy * layer.clientHeight));
    toys.set(kind, t);
    layer.appendChild(t.el);
  }
  const want = options.toys?.present || null;
  if (present && present.kind !== want) { present.el.remove(); present = null; }
  if (want && !present) showPresent(want);

  for (const word of words) {
    let p = pets.get(word);
    if (!p) {
      p = newPet(word);
      p.x = rand(0, w); p.y = rand(0, h);
      p.until = performance.now() + rand(200, 2500);
      pets.set(word, p);
    }
    p.body.innerHTML = opts.html(word);
    p.el.classList.toggle('crowned', opts.crowned(word));
    if (!p.toy) { p.x = Math.min(p.x, w); p.y = Math.min(p.y, h); }
    if (!p.el.isConnected) layer.appendChild(p.el);
    place(p);
  }
  if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
}

export function stopPets() { running = false; }

// For the smoke test.
export const petState = () => [...pets.values()].map(p => ({ word: p.word, x: p.x, y: p.y, mode: p.mode, toy: p.toy?.kind || null }));
export const toyState = () => ({ toys: [...toys.values()].map(t => ({ kind: t.kind, x: t.x, y: t.y, users: t.users.filter(Boolean).length })), present: present?.kind || null });
// For the toy screenshots: put a free friend on every toy slot.
export function playAll() {
  const free = [...pets.values()].filter(p => !p.toy);
  for (const t of toys.values()) t.users.forEach((u, i) => { const p = !u && free.shift(); if (p) startPlay(p, t, i); });
}
