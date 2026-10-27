// Every tuning number for the learning engine and the hints, in one place (PLAN.md §3, §4, §10).
export const CONFIG = {
  sessionLength: { short: 8, normal: 15, long: 20 },
  starterSessionLength: 8,   // used until enough words are level 3+
  minKnownForFull: 4,        // level 3+ words needed to leave starter mode
  maxShaky: 3,               // never more than this many words at level 1–2
  starterMaxShaky: 2,
  targetsPerSession: 2,
  starterTargets: 1,
  irSteps: 3,                // T,K1 · T,K1,K2 · T,K1,K2,K3
  notYetGap: [2, 3],         // a missed word comes back this many cards later
  maxRetriesPerWord: 2,
  restAfterMisses: 3,        // misses in one game before a word rests until tomorrow
  promoteKnownAfterDays: 3,  // level 4 → 5 needs a Fast review this long after reaching 4
  reviewGapsDays: [1, 3, 7, 14, 30],
  meterBands: 7,
  clozePauseMs: 1700,        // the pause where the word goes when a hint sentence is read
  historyCap: 60,
  popsToLearn: 2,            // first-try Bubble Pops in a row: Learning → Getting it
  buildShareMastered: 0.3,   // share of a crowned word's cards that are Build It
  // Automatic hints by level: when each one appears (ms after the card shows).
  hints: {
    1: { sentence: 0, sparkle: 3000 },
    2: { sparkle: 3000, sentence: 6000 },
    3: { sparkle: 6000 },
  },
};

export const LEVEL_NAMES = ['New', 'Learning', 'Getting it', 'Almost', 'Known', 'Mastered'];
