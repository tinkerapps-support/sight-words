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
  clozePauseMs: 1700,
  yourTurnMs: 4000,          // quiet time for her to say it back (after "Your turn!", teaching, Say it)        // the pause where the word goes when a hint sentence is read
  historyCap: 60,
  // Adaptive pace (owner, 2026-10-28): how fast new words come, from her recent scored cards.
  pace: {
    window: 24,              // newest scored cards looked at (last 14 days)
    minCards: 12,            // fewer than this: normal pace
    slowBelow: 0.7,          // share right below this: slow down
    quickAt: 0.85,           // share right at or above this: a bit faster
    fastAt: 0.92,            // …and this, with fastStrong of cards Fast / first try: fastest
    fastStrong: 0.7,
    flyingAt: 0.96,          // share right at or above this (at most 1 miss in 24), with
    flyingStrong: 0.8,       // flyingStrong of cards Fast / first try: flying (owner, 2026-10-30)
    // per pace (-1 slow, 0 normal, 1 quick, 2 fast, 3 flying): shaky-word cap, targets per game, and
    // how many new words may join mid-game when a word graduates to Almost. knownEvery (fast and
    // flying): targets take turns with each other, with one known word after every knownEvery target
    // cards, instead of the known-heavy rehearsal blocks.
    levels: {
      '-1': { maxShaky: 2, targets: 1, topUps: 0 },
      0: { maxShaky: 3, targets: 2, topUps: 0 },
      1: { maxShaky: 4, targets: 2, topUps: 1 },
      2: { maxShaky: 6, targets: 3, topUps: 2, knownEvery: 2 },
      3: { maxShaky: 8, targets: 3, topUps: 3, knownEvery: 3 },
    },
  },
  check: { grid: 10 },
  toys: { perFriends: 5 },   // a meadow toy (as a present) for every 5 friends hatched there       // Word Check: words on screen per question
  popsToLearn: 2,
  // Bubbles on a Bubble Pop card: more for a word she knows well (owner, 2026-10-28).
  bubbles: { base: 3, afterFirstTryPop: 4, hatched: 5, crowned: 6 },            // first-try Bubble Pops in a row: Learning → Getting it
  buildShareUnbuilt: 0.8,    // hatched word not yet built right: share of its cards that are Build It
  buildShareBuilt: 0.4,      // after it's built right once: Build It…
  popShareBuilt: 0.2,        // …Bubble Pop for variety, and the rest (40%) reading
  // No automatic hints (owner, 2026-11-01; they used to appear 3-9 s in by level): after this
  // long without a touch on a reading card, a hand points at the Hint button instead.
  hintNudgeMs: 10000,
  hintGraceMs: 2000,         // a Fast within this long of the first hint still counts as Fast
};

export const LEVEL_NAMES = ['New', 'Learning', 'Getting it', 'Almost', 'Known', 'Mastered'];
