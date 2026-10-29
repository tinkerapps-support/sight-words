// Bubble Pop and Build It cards (owner, 2026-10-27). They are part of the main game: engine
// cardKind() picks one by the word's stage, main.js shows it, and these functions run the card
// and report back whether she got it on the first try. Both check themselves.
import { lookalikesOf } from './lists.js';
import { wordId, letterId } from './voice-lines.js';
import * as audio from './audio.js';

const $ = id => document.getElementById(id);
const shuffle = arr => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

let live = null;   // the running card's token; a new card or clear() makes old handlers stale

export function clear() {
  live = null;
  $('pop-area').innerHTML = '';
  $('build-slots').innerHTML = '';
  $('build-tiles').innerHTML = '';
}

// ---------------------------------------------------------------- Bubble Pop

// Wrong choices come from the word's look-alikes, then any other word on the lists that are on.
function distractors(word, entries, show, n = 2) {
  const words = entries.map(e => e.word);
  const shown = new Set([show(word)]);
  const out = [];
  const like = shuffle([...lookalikesOf(word, entries)].filter(w => words.includes(w)));
  for (const w of [...like, ...shuffle(words)]) {
    if (out.length >= n) break;
    if (shown.has(show(w))) continue;
    shown.add(show(w));
    out.push(w);
  }
  return out;
}

// Spots (left %, top %) by how many bubbles, loosely scattered; shuffled each card.
const SPOTS = {
  3: [[6, 8], [52, 20], [26, 52]],
  4: [[4, 6], [52, 10], [8, 50], [54, 56]],
  5: [[4, 4], [54, 6], [30, 32], [4, 60], [56, 62]],
  6: [[2, 4], [36, 0], [68, 8], [4, 48], [38, 40], [68, 54]],
};

// Three bubbles bob in place (nothing is timed). A wrong bubble fades with "Try another one!";
// onDone(firstTry) runs once she pops the right one.
export function popCard({ word, entries, show, count = 3, onWrong, onDone }) {
  const token = live = {};
  const area = $('pop-area');
  area.innerHTML = '';
  let firstTry = true;
  const choices = shuffle([word, ...distractors(word, entries, show, count - 1)]);
  const spots = shuffle(SPOTS[choices.length] || SPOTS[3]);
  area.dataset.n = String(choices.length);
  choices.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'bubble';
    b.textContent = show(w);
    const [x, y] = spots[i];
    b.style.left = `${x + Math.random() * 6}%`;
    b.style.top = `${y + Math.random() * 6}%`;
    b.style.setProperty('--d', `${i * 0.15}s`);
    b.addEventListener('click', async () => {
      if (live !== token || b.disabled) return;
      if (w === word) {
        area.querySelectorAll('.bubble').forEach(x => { x.disabled = true; });
        b.classList.add('popped');
        audio.chime.pop();
        setTimeout(() => { if (live === token) onDone(firstTry); }, 350);
        return;
      }
      firstTry = false;
      b.disabled = true;
      b.classList.add('nope');
      audio.chime.gentle();
      onWrong?.();
      await audio.say('try-again', 'Try another one!');
      if (live === token) audio.say(wordId(word), word);
    });
    area.appendChild(b);
  });
}

// ---------------------------------------------------------------- Build It

// Drag each letter into its box. Any empty box takes the letter that belongs there; a wrong drop
// slides back and shows the next missing letter faintly as a hint. onDone(firstTry) runs once
// the word is built (firstTry: no wrong drops).
export function buildCard({ word, show, onDone }) {
  const token = live = {};
  const letters = [...show(word)];
  const slots = $('build-slots');
  slots.className = 'build-slots';
  slots.innerHTML = letters.map(ch => `<span class="slot" data-ch="${ch}"><span class="ghost">${ch}</span></span>`).join('');
  let order = shuffle(letters);
  for (let i = 0; i < 5 && order.join('') === letters.join(''); i++) order = shuffle(letters);
  const tray = $('build-tiles');
  tray.innerHTML = '';
  let firstTry = true;
  let left = letters.length;

  const openSlots = () => [...slots.children].filter(s => !s.classList.contains('filled'));
  // The box under the finger, with some slack so a near miss still lands.
  const slotAt = (x, y) => {
    let best = null, bestD = Infinity;
    for (const s of openSlots()) {
      const r = s.getBoundingClientRect();
      const pad = r.width * 0.45;
      if (x < r.left - pad || x > r.right + pad || y < r.top - pad || y > r.bottom + pad) continue;
      const d = Math.hypot(x - (r.left + r.right) / 2, y - (r.top + r.bottom) / 2);
      if (d < bestD) { best = s; bestD = d; }
    }
    return best;
  };
  const hintNext = () => { openSlots()[0]?.classList.add('hint'); };

  for (const ch of order) {
    const t = document.createElement('div');
    t.className = 'tile';
    t.textContent = ch;
    t.addEventListener('pointerdown', e => {
      if (live !== token || t.classList.contains('used')) return;
      e.preventDefault();
      try { t.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const x0 = e.clientX, y0 = e.clientY;
      t.style.transition = 'none';
      t.classList.add('dragging');
      audio.chime.tap();
      const move = ev => { t.style.transform = `translate(${ev.clientX - x0}px, ${ev.clientY - y0}px) scale(1.12)`; };
      const back = () => {
        t.style.transition = 'transform 0.25s ease-out';
        t.style.transform = '';
      };
      const end = ev => {
        t.removeEventListener('pointermove', move);
        t.removeEventListener('pointerup', end);
        t.removeEventListener('pointercancel', end);
        t.classList.remove('dragging');
        if (live !== token) return;
        const slot = ev.type === 'pointerup' ? slotAt(ev.clientX, ev.clientY) : null;
        if (!slot) { back(); return; }               // dropped nowhere: no harm done
        if (slot.dataset.ch !== ch) {
          firstTry = false;
          back();
          t.classList.remove('nope'); void t.offsetWidth; t.classList.add('nope');
          audio.chime.gentle();
          hintNext();
          return;
        }
        t.style.transition = 'none';
        t.style.transform = '';
        t.classList.add('used');
        slot.textContent = ch;
        slot.classList.add('filled');
        slot.classList.remove('hint');
        if (--left > 0) { audio.say(letterId(ch), ch.toUpperCase(), { now: true }); return; }
        // Built: the word lights up and is said, then the card is done.
        slots.classList.add('done');
        audio.say(wordId(word), word, { now: true }).then(() => { if (live === token) onDone(firstTry); });
      };
      t.addEventListener('pointermove', move);
      t.addEventListener('pointerup', end);
      t.addEventListener('pointercancel', end);
    });
    tray.appendChild(t);
  }
}
