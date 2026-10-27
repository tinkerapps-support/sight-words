// Every spoken line in the app (PLAN.md §5). The voice pipeline (scripts/generate-voices.mjs)
// reads this catalog to make the MP3s, and the app plays clips by these ids.
// No line uses the child's name.
import { LISTS } from './lists.js';

export const CHEERS = [
  'Yay!', 'You got it!', 'Super!', 'Great reading!', 'Woo-hoo!', 'Nice one!', 'You did it!',
  'Hooray!', 'Awesome!', 'Way to go!',
];
export const FAST_CHEERS = ['Super fast!', 'Zoom! So quick!', 'Lightning fast!', 'Wow, that was quick!', 'Speedy reader!'];
export const NOT_YET = ["Let's look together.", "Let's read it together.", "Here's a little help.", 'Almost! Listen.', "That's a tricky one."];
export const OTHER = {
  'session-start': "Let's read some words!",
  'session-end': 'You read so many words!',
  'rainbow-full': 'A whole rainbow!',
  'sticker': 'You earned a sticker!',
  'hatched': 'A new friend hatched!',
  'say-it-again': 'Can you say it too?',
  'new-word': "Here's a new word!",
  'your-turn': 'Your turn! Can you say it?',
  'pop-start': 'Pop the bubble with the word you hear!',
  'try-again': 'Try another one!',
  'build-start': "Let's build the word! Tap the letters in order.",
};

export const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const wordId = word => `word-${word.toLowerCase()}`;
export const sentenceId = word => `sentence-${word.toLowerCase()}`;
export const cheerId = text => `cheer-${slug(text)}`;
export const letterId = ch => `letter-${ch.toLowerCase()}`;
export const clozeId = (word, i) => `cloze-${word.toLowerCase()}-${i}`;

// A sentence read as a hint must not give the word away: it is split into spoken parts around
// each place the word appears ("The cake" · [gap: was] · "big."). Parts with no letters
// (a lone "!") are dropped. Used by the voice catalog and by the app's sentence reader.
export function clozeParts(sentence, word) {
  const re = new RegExp(`\\b${word}\\b`, 'gi');
  const parts = [];
  let last = 0, i = 0, m;
  const text = t => { if (/[a-z]/i.test(t)) parts.push({ text: t.trim(), id: clozeId(word, ++i) }); };
  while ((m = re.exec(sentence))) {
    text(sentence.slice(last, m.index));
    parts.push({ gap: true, text: m[0] });
    last = m.index + m[0].length;
  }
  text(sentence.slice(last));
  return parts;
}

const CLOZE_VOICE = 'You are reading part of a short sentence to a five-year-old who is learning to read. '
  + 'One word of the sentence is left out on purpose, and the child will read that word herself in the pause. '
  + 'Read ONLY the words given, warmly and clearly, at the same gentle pace as the rest of the sentence. '
  + 'If the text does not end the sentence, keep the voice lifted as if the sentence continues. '
  + 'Start immediately and stop immediately after the last word, with no added silence.';
export const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

export function allLines() {
  const lines = [];
  for (const list of LISTS) {
    for (const e of list.words) {
      lines.push({ id: wordId(e.word), text: e.word, kind: 'word', where: `${list.id} word` });
      lines.push({ id: sentenceId(e.word), text: e.sentence, kind: 'sentence', where: `${list.id} sentence` });
      for (const part of clozeParts(e.sentence, e.word)) {
        if (!part.gap) lines.push({ id: part.id, text: part.text, kind: 'cloze', where: `${list.id} sentence without "${e.word}"`, instructions: CLOZE_VOICE });
      }
    }
  }
  for (const t of [...CHEERS, ...FAST_CHEERS, ...NOT_YET]) lines.push({ id: cheerId(t), text: t, kind: 'cheer', where: 'feedback' });
  for (const [id, text] of Object.entries(OTHER)) lines.push({ id, text, kind: 'other', where: id });
  // Letter names for spell–read ("w – a – s… was"). Upper case so the voice says the name.
  for (const ch of LETTERS) lines.push({ id: letterId(ch), text: ch.toUpperCase(), kind: 'letter', where: 'spell-read' });
  // A word can appear in two lists: keep the first.
  const seen = new Set();
  return lines.filter(l => !seen.has(l.id) && seen.add(l.id));
}
