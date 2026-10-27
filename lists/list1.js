// List 1: the first 25 sight words. One entry per word; see PLAN.md §1.
// `starter` words are the easiest, used as known words before the head start has any.
// Art paths are filled in once Codex's production art lands; until then the UI uses placeholders.
export default {
  id: 'list1',
  name: 'List 1',
  words: [
    { word: 'the', sentence: 'The unicorn is pink.', starter: true, lookalikes: ['he', 'they', 'this'] },
    { word: 'of', sentence: 'A cup of milk.', lookalikes: ['on'] },
    { word: 'and', sentence: 'A bunny and a frog.', starter: true },
    { word: 'a', sentence: 'A big rainbow.', starter: true, lookalikes: ['as', 'at'] },
    { word: 'to', sentence: 'Hop to the flower!' },
    { word: 'in', sentence: 'A kitten in a cup.', lookalikes: ['it', 'is'] },
    { word: 'is', sentence: 'The sun is happy.', starter: true, lookalikes: ['his', 'this', 'in', 'it'] },
    { word: 'you', sentence: 'I love you!' },
    { word: 'that', sentence: 'Look at that star!', lookalikes: ['at'] },
    { word: 'it', sentence: 'It is soft.', lookalikes: ['in', 'is'] },
    { word: 'he', sentence: 'He can fly.', lookalikes: ['the'] },
    { word: 'was', sentence: 'The cake was big.' },
    { word: 'for', sentence: 'A gift for you.' },
    { word: 'on', sentence: 'A bird on a hat.', lookalikes: ['of'] },
    { word: 'are', sentence: 'We are friends.' },
    { word: 'as', sentence: 'The bunny is as small as the mouse.', lookalikes: ['a', 'at'] },
    { word: 'with', sentence: 'A bear with a balloon.' },
    { word: 'his', sentence: 'His hat is big.', lookalikes: ['is', 'this'] },
    { word: 'they', sentence: 'They can dance.', lookalikes: ['the'] },
    { word: 'I', sentence: 'I can jump!', starter: true },
    { word: 'at', sentence: 'Look at me!', lookalikes: ['a', 'as', 'that'] },
    { word: 'be', sentence: 'Be kind.' },
    { word: 'this', sentence: 'This is a flower.', lookalikes: ['is', 'his', 'the'] },
    { word: 'have', sentence: 'I have a kitten.' },
    { word: 'from', sentence: 'A letter from a fox.' },
  ],
};
