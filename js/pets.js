// Hatched friends live in the meadow (owner, 2026-10-28): they wander, visit each other and say
// hello, hop when tapped (and say their word), can be picked up and dropped next to a friend, and
// come running to a tap on the grass. Plain DOM + one animation loop; it only runs while the home
// screen shows. Motion is all transforms on the felt creature art (no extra poses needed).
import * as audio from './audio.js';
import { wordId } from './voice-lines.js';

const SIZE = 66;            // pet size in CSS px
const SPEED = [34, 58];     // walking speed range, px/s
const MEET = SIZE * 0.95;   // close enough to say hello

let layer = null;
let pets = new Map();       // word -> pet; kept across re-renders so friends stay where they were
let running = false;
let last = 0;
let opts = null;            // { html(word), crowned(word), heart() }

const rand = (a, b) => a + Math.random() * (b - a);
const bounds = () => ({ w: Math.max(0, layer.clientWidth - SIZE), h: Math.max(0, layer.clientHeight - SIZE) });

function place(p) {
  p.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  p.el.style.zIndex = String(10 + Math.round(p.y)); // lower on screen = in front
  p.flip.classList.toggle('left', p.facing < 0);
}

function setMode(p, mode, ms = 0) {
  p.mode = mode;
  p.until = performance.now() + ms;
  p.body.classList.toggle('walking', mode === 'walk' || mode === 'visit' || mode === 'come');
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
    x: 0, y: 0, tx: 0, ty: 0, facing: 1, speed: rand(...SPEED), mode: 'idle', until: 0, lastGreet: 0, friend: null,
  };
  el.addEventListener('pointerdown', e => grab(p, e));
  // One-off moves end by themselves so the walk animation can come back.
  p.body.addEventListener('animationend', ev => {
    if (ev.animationName.startsWith('pet-') && ev.animationName !== 'pet-walk') p.body.classList.remove('hop', 'cheer', 'hello', 'land');
  });
  el.addEventListener('contextmenu', e => e.preventDefault());
  return p;
}

// Tap = hop and say the word; drag = carry it around; drop next to a friend = they say hello.
function grab(p, e) {
  e.preventDefault();
  e.stopPropagation();
  try { p.el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  const x0 = e.clientX, y0 = e.clientY, px = p.x, py = p.y;
  let dragging = false;
  const move = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!dragging && Math.hypot(dx, dy) < 8) return;
    if (!dragging) { dragging = true; setMode(p, 'held'); p.el.classList.add('held'); audio.chime.squeak(); }
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
    if (!dragging) { tap(p); return; }
    act(p, 'land');
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
    if (q === p || q.mode === 'held' || Math.hypot(q.x - p.x, q.y - p.y) > SIZE * 2.2) continue;
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
    if (q === p) continue;
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (!best || d < best.d) best = { q, d };
  }
  return best;
}

// What an idle pet does next: mostly wander, sometimes visit a friend, sometimes just sit.
function decide(p, now) {
  const { w, h } = bounds();
  const r = Math.random();
  const others = [...pets.values()].filter(q => q !== p && q.mode !== 'held');
  if (r < 0.25 && others.length && now - p.lastGreet > 6000) {
    p.friend = others[Math.floor(Math.random() * others.length)];
    p.speed = rand(...SPEED);
    setMode(p, 'visit');
  } else if (r < 0.8) {
    p.tx = rand(0, w);
    p.ty = rand(0, h);
    p.speed = rand(...SPEED);
    setMode(p, 'walk');
  } else {
    setMode(p, 'idle', rand(1500, 3500));
    if (Math.random() < 0.5) act(p, 'cheer');
  }
}

function step(dt, now) {
  for (const p of pets.values()) {
    if (p.mode === 'held') continue;
    if (p.mode === 'idle' || p.mode === 'greet') {
      if (now >= p.until) decide(p, now);
      continue;
    }
    let tx = p.tx, ty = p.ty;
    if (p.mode === 'visit') {
      if (!pets.has(p.friend?.word)) { setMode(p, 'idle', 500); continue; }
      tx = p.friend.x - p.facing * SIZE * 0.7;
      ty = p.friend.y;
      if (Math.hypot(p.friend.x - p.x, p.friend.y - p.y) < MEET) { greet(p, p.friend, false); continue; }
    }
    const dx = tx - p.x, dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) { setMode(p, 'idle', rand(1000, 3000)); continue; }
    const s = Math.min(d, p.speed * dt);
    p.x += (dx / d) * s;
    p.y += (dy / d) * s;
    if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
    place(p);
  }
  // Friends who end up on top of each other drift apart a little.
  const list = [...pets.values()];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      if (d >= SIZE * 0.6) continue;
      const push = (SIZE * 0.6 - d) * 0.05;
      const { w, h } = bounds();
      if (a.mode !== 'held') { a.x = Math.min(w, Math.max(0, a.x - (dx / d) * push)); a.y = Math.min(h, Math.max(0, a.y - (dy / d) * push)); place(a); }
      if (b.mode !== 'held') { b.x = Math.min(w, Math.max(0, b.x + (dx / d) * push)); b.y = Math.min(h, Math.max(0, b.y + (dy / d) * push)); place(b); }
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

// Show these hatched friends (one meadow page) and start the loop.
export function showPets(host, words, options) {
  opts = options;
  if (layer !== host) { layer = host; pets = new Map(); }
  for (const [w, p] of pets) if (!words.includes(w)) { p.el.remove(); pets.delete(w); }
  const { w, h } = bounds();
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
    p.x = Math.min(p.x, w); p.y = Math.min(p.y, h);
    if (!p.el.isConnected) layer.appendChild(p.el);
    place(p);
  }
  if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
}

export function stopPets() { running = false; }

// For the smoke test.
export const petState = () => [...pets.values()].map(p => ({ word: p.word, x: p.x, y: p.y, mode: p.mode }));
