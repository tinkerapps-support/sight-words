// Word lists. Adding a list = a new file in www/lists/ plus one line here (PLAN.md §1).
import list1 from '../lists/list1.js';

export const LISTS = [list1];

export function listById(id) {
  return LISTS.find(l => l.id === id);
}

// The words of every enabled list, in list order, first occurrence wins.
// Progress is keyed by the word itself, so a word repeated in a later list shares it.
export function activeWords(enabledIds) {
  const seen = new Map();
  for (const list of LISTS) {
    if (!enabledIds.includes(list.id)) continue;
    for (const entry of list.words) {
      if (!seen.has(entry.word)) seen.set(entry.word, { ...entry, list: list.id });
    }
  }
  return [...seen.values()];
}

export function wordEntry(word) {
  for (const list of LISTS) {
    const entry = list.words.find(w => w.word === word);
    if (entry) return { ...entry, list: list.id };
  }
  return null;
}

// Look-alikes are listed one way in the data; treat them as symmetric.
export function lookalikesOf(word, entries) {
  const out = new Set();
  for (const e of entries) {
    if (e.word === word) (e.lookalikes || []).forEach(w => out.add(w));
    else if ((e.lookalikes || []).includes(word)) out.add(e.word);
  }
  return out;
}
