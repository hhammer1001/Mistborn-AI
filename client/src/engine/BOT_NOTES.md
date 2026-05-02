# Squash & Zoom — Tuning Notes

Notes from iterating on Squash Bot (originally named TwonkyV2) against the original Twonky. Squash ceiling: **73.7%** win rate over 5000 games. Zoom is a going-second specialist built on the same architecture — see the **Zoom** section at the bottom.

## Architecture

- **`bot.ts`** — Twonky original: priority-waterfall bot using pre-computed win-rate correlations from Twonky self-play (`data/*3.json` files)
- **`squashBot.ts`** — Squash: action-scoring bot. Scores every available action, picks the max
- **`squashBotEval.ts`** — evaluation engine: resource values, context weights, snapshot builder, analytical card ratings, self-play blending
- **`selfplay.ts`** — mirror-matchup data collector (Squash vs Squash, same character both sides)
- **`data/squash_weights/*.json`** — per-character self-play correlation data

The Squash rating for a card is:

```
finalRating = analyticalRating                          // formula-based
            + charMetalBonus (0 / 0.1 / 0.25)           // same metal / same pair / match
            + selfPlayWinRate * SELFPLAY_BLEND_STRENGTH // empirical signal
```

Then dynamic adjustments layer on top (heal context, damage context, eliminate context, etc.) producing `dynamicCardRating`.

## Progress Journey

| Stage | Win rate | Notes |
|---|---|---|
| Squash initial | 0.8% | Bot literally refused to burn cards (bug in metalUnlockValue counting the burned card as its own target) |
| Fixed opportunity-cost formula | 28.5% | Bot started actually activating cards |
| Tuned missions + buy scoring | 46.2% | Closer to parity with Twonky |
| Added Squash self-play data | 48.2% | Replaced correlation data from bad bot |
| Blend=20 | 61.9% | Self-play signal dominates analytical |
| Defender bonus + heal weight + buy tuning | 70.3% | Major formula fixes |
| 30k-game self-play + blend=100 | 73.7% | Plateau — tuning saturated |

## What Worked

### 1. First-principles resource values (biggest foundation)

Instead of learning card values from Twonky's self-play (which is biased by Twonky's play style), assign analytical values to effect types based on the game economy:

```
D (damage)      = 1.0
M (money)       = 1.0
Mi (mission)    = 2.2   (primary win condition)
H (heal)        = 0.5
C (draw)        = 2.5
T (training)    = 3.0
E (eliminate)   = 2.0
A (atium)       = 2.5
B (extra burn)  = 3.5
K (kill ally)   = 3.0
R (refresh)     = 1.5
Pc (perm draw)  = 10.0  (+1 card every turn forever)
Pd (perm dmg)   = 8.0
Pm (perm money) = 7.0
pull            = 1.5
push            = 1.0
riot            = 2.5
seek(N)         = N * 0.8
```

### 2. Context-sensitive effect weights (+large gains baked in)

Weights multiply/add based on game state:
- **Damage**: +1.5 if opp ≤ 15 HP, +3.0 if opp ≤ 8 HP, *0.7 if opp has defenders, *1.3 on damage path
- **Heal**: 0.2 if HP ≥ 38, 3.0 if HP ≤ 12, *1.3 if opp outpacing us
- **Mission**: *2.2*1.3 base, *1.5 on mission path, *0.7 on damage path, *1.8 if 2 missions complete
- **Training**: 5.0 if 1 away from unlock, 3.5 if 2 away
- **Draw**: 3.0 early game, 2.0 otherwise
- **Eliminate**: 3.0 if deck ≥ 15 cards, 0.5 if deck ≤ 8

### 3. Self-play data (biggest single lever: +10% from 48% to 62%)

Mirror matchups (same char both sides) strip out character-vs-character variance. 30k games/character produces clean correlation data. The data corrected three systematic errors in analytical ratings:

- **Over-valued** money cards (Inspire, Intimidate, Charm)
- **Over-valued** conditional effects (Investigate's "special1" often triggers for 0)
- **Under-valued** mission engines (Pursue, Pierce, Unveil, Hyperaware)

Blend is **additive**: `rating += winRate * 100`. Blend strength 100 gives best stability; ranges 40-200 all plateau 72-75%.

### 4. Defender bonus (+3.3%)

Hazekillers/Soldier/Pewterarm were rated near 0 because my ally formula didn't account for damage blocking:

```
defenderBonus = defenseType === "D" ? health * 4.0 : 0
totalAllyValue += defenderBonus
```

A defender with 3 HP blocks roughly 3 damage per turn it's alive — massive equivalent value. Squash now buys Hazekillers/Pewterarm when needed, reducing losses to damage-oriented opponents.

### 5. Heal weight becomes preventive (+1%)

Healing is now boosted when opponent is outpacing us in damage pressure, not just when we're low:

```
healWeight = basedOnHP (0.2 to 3.0)
         * (1.3 if myHealthDeficit > oppDmgPressure else 1.0)
```

### 6. Buy multiplier lowered from 6 to 2 (+2.5%)

The buy score was over-inflated, causing Squash to buy too many mediocre cards. Lowering `rating * 6` to `rating * 2` made buying less attractive relative to using metals, advancing missions, and activating ally abilities.

### 7. Seek weight doubled (0.4 → 0.8, +1%)

Seek lets you use a market card's tier-1 ability for free — this was undervalued in analytical ratings. Self-play confirmed by strongly rating Pierce and Unveil (both have seek).

### 8a. Eliminate weak allies when deck is bloated (+1%)

Previously `eliminateIn` had a blanket `!(c.card instanceof Ally)` filter — allies were never candidates. But weak allies (Keeper -16.8%, Rebel for Shan -47.1%, etc.) cycle uselessly through hand→discard→deck. Now allies below buffer rating are eliminable IFF deck size ≥ 12 (so we clear Funding first, only trim weak allies when we can spare the slot).

### 8b. Keep eliminate valuable at mid-lean deck sizes (+0.5%)

Previous tiering dropped eliminate weight to 0.5 at deck ≤ 8. This stopped the bot from pushing decks from 9→8 even when Funding was still present. Tightened the curve: 3.0 at ≥15, 2.0 at ≥10, 1.5 at ≥8, 0.5 below.

### 9. Dynamic buy buffer (per-character base + game-phase adjustments)

```
BASE_BUFFERS = Kelsier 1.5, Marsh 1.8, Shan 1.7, Vin 1.5, Prodigy 1.4
- 0.3 early game (build engine aggressively)
- 0.2 if curMoney ≥ 8 (spend it or waste it)
+ 0.4 late game (deck is full, be selective)
+ 0.3 if deckSize ≥ 15
+ 0.5 if deckSize ≥ 18 (severe bloat penalty)
```

## What Didn't Work

### Things tested and rejected

1. **Epsilon-greedy exploration in self-play** (ε=0.2, picks random top-5 action occasionally)
   - Hurt to 68.6% from 70.6%. Adding noise to training data makes the bot learn suboptimal patterns. The correlation signal weakens when action choice isn't determined by the scoring function.

2. **Multi-iteration self-play** (regenerate data 3 times, each using latest weights)
   - Oscillated wildly: 61.4%, 73.8%, 60.0%. When regen runs with `SELFPLAY_BLEND_STRENGTH > 0`, the bot biases data toward the previous iteration's signal, creating feedback loops. Must regen with blend=0 for stable bootstrapping.

3. **Confidence-weighted blending** (`adjust *= min(samples/1000, 1.0)`)
   - Dropped to 72.1%. Discounted well-sampled card signals below the 1000-sample threshold, hurting more than it helped for rare-but-legitimate cards.

4. **Save-for-6-cost heuristic** (penalize filler buys when a strong 6-cost is available)
   - Went to 59.3% from 61.9%. The self-play weights already encode "buy Pierce, don't buy Strike." Adding a hand-tuned rule on top distorted a well-calibrated signal.

5. **Multi-tier opportunity cost for burn_card** (weight all remaining tiers, not just next)
   - Slight drop. The bot became too reluctant to burn cards, even when ending turn otherwise. Simple next-tier formula wins.

6. **Pull/push/riot base values boosted** (1.5→2.5, 1.0→1.5, 2.5→3.5)
   - Slight drop. These effects are already captured in dynamic weights and self-play.

7. **Atium/burn weight boost** (A: 2.5→4.0, B: 3.5→4.5)
   - No change. Self-play data already accounts for these.

8. **Mission spreading bonus** (bonus for advancing an unprogressed mission IF another mission is at 5+)
   - Mixed. Settled on a simple +10 for any unprogressed mission instead.

9. **Char-metal synergy bonus increased** (0.25 → 1.0)
   - Dropped to 72.7%. Self-play already captures this differentiation.

10. **Damage path multiplier increased** (1.3 → 1.5)
    - No meaningful change.

11. **More aggressive mission-damage flip threshold** (0.3 → 0.15)
    - No meaningful change.

12. **Ally bonus scaled with health** (`3 + health*2` instead of flat 5)
    - Dropped to 72.5%.

13. **Mission weight base boost** (1.3 → 1.5)
    - No change.

14. **Training weight curve tweaks** (1-gap 5→6, 2-gap 3.5→4)
    - No change.

## Known Weaknesses

1. **Shan vs Marsh**: 48% — structurally hard. Marsh's +1 Mi/turn char ability creates a mission race Shan can't win without damage engine cards, and the Twonky-Marsh build is already well-tuned for mission.

2. **Bots plateau at 74%**: Can't break through without lookahead. Twonky's rigid "missions first always" priority is genuinely optimal for the scenarios where it applies, and Squash's single-step scoring can't plan around it.

3. **Sample-selection bias in self-play**: Cards that start rated below the buy buffer (like Obligator, rated 0.84 analytical) never get bought, so self-play has no data, so the rating never improves. A few cards are stuck in this loop. Could be solved with exploration but exploration hurts data quality.

4. **Damage victories outnumber mission victories** (2790 D / 2149 M at 5000 games). Squash is supposed to default to mission path, but ends up winning by damage more often because it pivots when falling behind in mission races. This is correct (damage is the fallback) but suggests Squash isn't racing missions aggressively enough.

## Key Tuning Constants

In `squashBotEval.ts`:
```
SELFPLAY_MIN_SAMPLES = 100          // skip weights with < 100 samples
SELFPLAY_BLEND_STRENGTH = 100.0     // additive blend: winRate × this
Defender bonus = health * 4.0       // for cards with defenseType="D"
Mi base weight = 2.2 (* 1.3 in missionWeight)
```

In `squashBot.ts`:
```
scoreBuy: rating * 2 * phaseMult + allyBonus - deckPenalty
deckPenalty: max(0, (deckSize - 10) * 2.5)
scoreBurnMetal: metalVal - 0.5
scoreFlare: metalVal - 1.5
scoreUseMetal: 30 + effectValue
scoreAllyAbility: 40 + effectValue
scoreCharAbility1/3: 35 + effectValue
scoreMissionAdvance: 70 base + proximity/race/victory-path modifiers
```

## Bot-vs-Bot Flow

**Important**: `Game.play()` calls `Player.playTurn()` which must mirror the per-turn setup that `session.ts` does via `_startNextTurn` + `_playPending`. If they drift, benchmarks will silently disagree with real play.

Per-turn sequence (must match between `Player.playTurn` and `session._startNextTurn` + `_runBotTurn`):

1. `curMoney = pMoney` (permanent money bonus)
2. `curDamage = pDamage` (permanent damage bonus)
3. `playPending()` — allies pending in hand move to zone + run `play()` (Noble → +burn, Crewleader → +handSize, Smoker → smoking); funding pending in hand runs `play()` for +1 money
4. `resolve("T", "1")` — training +1
5. `takeActions` — bot's action loop
6. `assignDamage` — allocate `curDamage` to kill opp allies
7. `game.attack` — send leftover `curDamage` to opp
8. `curDamage = 0` (pDamage re-applies at start of next turn)

`end_actions` triggers `cleanUp` which draws the next hand with `{ deferred: true }`. Allies and funding drawn this way are marked `pending: true` and stay in the hand until the owner's next turn start processes them via step 3 above.

**Historical gotcha**: commit `8ea376a` deferred ally/funding play from end-of-turn to start-of-next-turn but only updated `session.ts`. `Player.playTurn` was missed, so bot-vs-bot games silently had allies stuck in hand forever (never entering the ally zone, never running `play()`). Squash's win rate dropped ~20% until this was noticed and fixed.

## Self-Play Pipeline

```
# 1. Disable blend to get analytical-only self-play
SELFPLAY_BLEND_STRENGTH = 0.0

# 2. Run mirror matchups (same char both sides, eliminates character variance)
npx tsx client/src/engine/selfplay.ts 30000

# 3. Re-enable blend
SELFPLAY_BLEND_STRENGTH = 100.0

# 4. Benchmark
npx tsx client/src/engine/benchmark.ts 200
```

**Critical rule**: regen self-play data with `SELFPLAY_BLEND_STRENGTH = 0`. Otherwise the bot biases data toward previous iteration's signal, creating feedback loops.

## Ideas for Future (Structural Changes)

Not attempted — these require actual architectural additions, not just tuning:

1. **1-ply lookahead**: simulate each action and score the resulting state. Probably +5-10%. Cost: ~10× slower evaluation.

2. **MCTS with rollouts**: proper search with random rollouts to end-of-game. Probably +10-15%. Cost: ~100× slower.

3. **Opponent modeling**: track opponent's character and apply opponent-specific strategy (e.g., aggressive vs Marsh, defensive vs Kelsier). Probably +3-5%.

4. **Per-character strategy profiles**: hand-write specific buy priorities / action preferences per character. Probably +2-5% but brittle.

5. **Neural network value function**: train a small NN on (state, action, outcome) tuples from self-play. Could match or exceed hand-tuned formulas. Expensive to set up.

## Scripts

```bash
# Benchmark Squash vs Twonky (default 20 games/matchup, 5 chars × 4 opponents = 20 matchups)
npx tsx client/src/engine/benchmark.ts [gamesPerMatchup]

# Baseline sanity check: Twonky vs Twonky should be ~50%
npx tsx client/src/engine/benchmark.ts baseline 100

# Regenerate self-play data
npx tsx client/src/engine/selfplay.ts [gamesPerChar] [outputDir] [explorationRate]
```

# Zoom — Going-Second Specialist

Zoom is a sibling of Squash that shares the entire scoring/eval pipeline but trains on a different data corpus: mirror games where **only the second-player seat is recorded**. The aim is a bot that handles the tempo deficit of going second better than Squash (whose mirror data averages both seats).

## Architecture

- **`zoomBot.ts`** — `class ZoomBot extends SquashBot` overriding `evalProfile = "zoom"`. Same scoring code, different data lookups.
- **`squashBotEval.ts`** — refactored to be profile-aware. `BotProfile = "squash" | "zoom"` is exported. `buildSnapshot`, `dynamicCardRating`, `timingPhaseAdjust` switch on `snap.profile` to select between `data/squash_*/` and `data/zoom_*/`.
- **`selfplayZoom.ts`** — Zoom-vs-Zoom mirrors but records only seat 1 (turnOrder=1) outcomes per game.
- **`data/zoom_weights/*.json`**, **`data/zoom_timing/*.json`** — second-player-only correlation data.

## Methodology twists vs Squash

1. **Single-seat training**: Squash records both seats per game (2× sample efficiency for seat-symmetric data); Zoom records only seat 2.
2. **Baseline-normalized blend**: Squash's mirror data is centered on a winrate of ~0 (each seat wins ~half). Zoom's seat-2-only data is centered on the seat-2 disadvantage (e.g. Kelsier seat 2 wins only ~25% of mirrors → baseline = −0.50). Without normalization the additive blend `winRate × 80` would penalize every Kelsier card by ~−40 points uniformly. Fix in `computeAllRatings`: when `baselineNormalize=true`, subtract the per-character weighted-average winrate before applying the blend, so the signal becomes each card's *lift* over baseline. Squash skips this (its baseline ≈ 0 and subtracting would shift its tuned buy thresholds). Zoom enables it.

## Training Journey (vs V1, going second)

| Self-play volume per char | + Timing per char | Zoom 2nd vs V1 | Squash 2nd vs V1 (same run) |
|---|---|---|---|
| 0 (empty stubs) | 0 | 57.0% | n/a |
| 5k | 0 | 59.0% | n/a |
| 20k | 0 | 60.0% | n/a |
| 50k | 0 | 67.2% | 69.0% |
| 50k | 30k | 71.0% | 72.7% |
| **100k** | **50k (matched)** | **66.5%** (n=1000) | **65.4%** (n=1000) |

At equal sample density (Zoom seat-2-only ≈ Squash both-seats), **Zoom matches Squash in the seat-2 role** (66.5% vs 65.4%, gap within σ=1.5pp at n=1000) — methodology validated. Smaller benchmarks (n=600) showed 5-7pp run-to-run variance, so reading single small benches as "Zoom -2pp behind" was sampling noise.

Zoom-vs-Squash (Zoom going second, Squash going first) at the final state: **33.1%** — Squash's first-seat advantage is real and not yet overcome by Zoom's seat-2 specialization.

## Key code

In `squashBotEval.ts`:
```
SELFPLAY_BLEND_STRENGTH = 80          // shared across profiles for now
TIMING_BLEND_STRENGTH_DEFAULT = 20    // shared
SELFPLAY_MIN_SAMPLES = 100
TIMING_MIN_SAMPLES = 50
baselineNormalize:                    // computeAllRatings flag
  squash → false (preserves tuning)
  zoom   → true  (handles seat-2 asymmetry)
```

## Findings

1. **Lift range parity**: per-character lift ranges (after baseline normalization) for Zoom data have nearly identical σ (≈12-15) to Squash's raw winrate signal — so the shared `SELFPLAY_BLEND_STRENGTH = 80` is correctly tuned for both. Per-profile blend strength is **not** needed.
2. **Lockstep training is required**: self-play and timing data must be trained against the same bot snapshot. Training 100k self-play after 30k timing regressed Zoom 71% → 64.8% — timing baselines went stale. Always retrain timing immediately after self-play.
3. **Volume to plateau**: Squash uses 30k self-play × 2 seats = 60k records/char + 10k timing × 2 = 20k records/char. Zoom needs 100k × 1 = 100k self-play records/char and 50k × 1 = 50k timing records/char to reach parity — about 5× the wall-clock training time per snapshot for the same per-record signal density.
4. **Random-character mirror** (Zoom-A seat 2 vs Zoom-B seat 1): +1pp lift over same-char mirror. Diversifies opp behavior without survivorship bias.
5. **Commitment > accuracy**: dynamic strategy detection (mid-game pivot based on opp's actual progress) regressed vs static character-prior. Strategy dithering across turns hurts more than mid-game accuracy helps.

## Anti-correlation: the seat-2 strategic shift

Biggest single design lever: **anti-correlate Zoom's victory path with opp's**. Squash defaults damage for Kelsier and mission for everyone else; Zoom seat 2 plays the orthogonal axis so the two bots aren't competing on the same race (where seat 1 wins via tempo).

```ts
if (profile === "zoom" && player.turnOrder === 1) {
  if (oppIsKelsier) victoryPath = "mission";
  else if (isKelsier || hasDamageEngine) victoryPath = "damage";
  // else: non-Kelsier zoom without damage tools — accept the race
}
```

Lifts Zoom-vs-Squash from baseline 32-33% to ~34-37% range (n=1000 has σ≈1.5pp; observed individual benches 32-38%). Per-matchup: Kelsier-1st matchups especially improve (Zoom-Marsh-vs-Kelsier 22%→54%, Zoom-Shan-vs-Kelsier 62%→74%) because Zoom races mission while Squash-Kelsier races damage on a separate axis.

## Failed experiments

All retrained with full lockstep timing + 1000-game benchmarks. Methodology is sound; ideas were wrong.

| Experiment | Result | Why it failed |
|---|---|---|
| Asymmetric training (Squash 1st vs Zoom 2nd) | 28.5% | 75% loss rate crushes signal-to-noise |
| Mixed-source training (50% mirror + 50% asym) | 32.4% | Asymmetric games introduce noise that dominates |
| Runtime variance (15% top-3 random) | 22.4% | Random plays hurt EV strictly |
| Forced damage commitment (zoom seat 2 always damage) | 20.9% | Forces damage on chars without damage tools |
| Mission/damage weight amplification (×1.4 / ×1.3) | 35.2% | Half-measures actually win some games |
| Targeted amplification (only when opp = Kelsier) | 34.3% | Local lift in Kelsier matchups, losses elsewhere |
| Dynamic anti-correlation (mid-game pivot) | 32.7% | Strategy dithering — commitment > accuracy |
| Denial buying (factor opp's char rating into buys) | 28.8% | Zoom buys cards it doesn't need, polluting deck |
| Mission-set awareness (heal/defender shifts) | 32-32.4% | Heuristic effects tangled with self-play data calibration |
| Seat-2 mission-tier heuristics | hurt vs V1 | Distorts already-tuned mission scoring |
| Naive 1-ply state-value lookahead | 0.5% | State-value scale too small; Zoom never picked end_actions |
| Turn-rollout lookahead (greedy heuristic to end-of-turn) | 23.7% | Heuristic-greedy rollout doesn't predict actual lookahead play |
| Training data with lookahead enabled | 32.6% | Lookahead picks distort card-value signal in self-play |

## Heuristic-chain lookahead + lethal solver (kept)

Two architectural levers added on top of anti-correlation, informed by [BOT_RESEARCH.md](BOT_RESEARCH.md) survey of card-game AI literature.

**1-ply heuristic-chain lookahead.** For each top-K candidate, snapshot game → `performAction` → compute heuristic-best-followup score → restore. Action value = `heuristic + 0.8 × followup-heuristic`. Captures "X enables Y" effects (e.g. burning a metal that unlocks a tier-3 ability worth 50) that single-step heuristic scoring misses. State-cloning via [gameSnapshot.ts](gameSnapshot.ts) (extracted from session.ts).

**Lethal solver.** When opp HP ≤ 12, before normal action selection, run a greedy depth search over damage-producing actions per top-level branch. If accumulated damage would kill opp (after defenders), return that branch's first action. Mirrors the chess endgame-solver / Hearthstone lethal-calc pattern from research doc.

3-run bench (n=1000 each, σ ≈ 1.5pp):

| Configuration | Zoom 2nd vs Squash 1st |
|---|---|
| No lookahead (heuristic only) | 35.0%, 35.9%, 33.8% → **avg 34.9%** |
| Chain lookahead only | 36.8%, 35.3%, 34.0% → **avg 35.4%** |
| **Chain lookahead + lethal solver** | 34.1%, 37.3%, 36.6% → **avg 36.0%** |

Combined lift: **~+1.1pp** over heuristic-only. Within noise on individual runs but consistent across averages.

Also: **Zoom vs V1 going second: 68.8%** (was 65% before lookahead).

Cost: ~2× slower at runtime. K=8 lookahead candidates, lethal solver triggers ~5% of action choices.

## ⚠️ Earlier "51.54%" claim was a bug — corrected

The session briefly claimed 51.54% vs Squash. This was wrong. The mission-reward synergy boosts were applied to BOTH `snap.profile === "squash"` and `"zoom"` — not gated. The aggressive boost values (cap=3 +30, etc.) shifted Squash's eval without retraining its weights, pushing Squash off its tuned plateau. Zoom appeared to win because Squash was accidentally weakened.

When the synergy was correctly gated to `snap.profile === "zoom"` only, Zoom's win rate dropped to 25-27%. The aggressive boosts were also actively harmful for Zoom alone.

**Honest final state with synergy gated to zoom + small boost values + blend=40**:

| Matchup | Win rate (n=10000 seeded) |
|---|---|
| Zoom 2nd vs Squash 1st | **38.88%** |
| Zoom 2nd vs V1 1st | 72.3% |

This is the legitimate session improvement: ~33% baseline → **~39%** vs Squash, ~65% baseline → **72%** vs V1.

**Genuine session lifts**:
- Anti-correlation: +3pp (proven)
- Chain lookahead at K=3 + lethal solver: +3pp (proven via ablation: 34.2% without → 37.8% with)
- Per-opp targeted training (5 weight sets): +1pp
- Small T/A mission-reward synergy (gated): +0.6pp (proven via ablation)
- Per-mission opp-lead awareness: +0.7pp (proven via ablation)
- Tuning (K=8 → K=3, blend tuning): +1pp

Total honest lift: **~+6pp** (33% → 39% vs Squash). Half of what was earlier claimed.

**Failed experiments (also honest)**:
- Aggressive synergy boost values (when correctly gated to zoom only): regressed to 25-27%
- Expanded synergies (D/Pc/C/R/E/K/M): regressed
- Higher per-opp blend strength (>40): regressed
- 2-step chain lookahead: regressed (33%)

**The lesson**: heuristic changes that affect both bots in a profile-aware codebase MUST be gated by profile, otherwise they look like Zoom improvements when they're really just Squash regressions.

## 42% target reached (with seeded benchmarking)

After threading deterministic seed-based RNG through the engine, benchmarks became reproducible across runs with same seed-range. Earlier "40% avg" results turned out to be favorable variance from non-seeded sampling — true mean with original config was ~37%.

The breakthrough: **massive aggressive boost values for the mission-reward synergy.** The boost is so large that cards with capacity≥2 + atium-using cards become near-mandatory buys when a T or A reward mission is in play (60-70% of games). Cap=3 cards (Pierce, Unveil, Pursue, Hyperaware, Strategize) get +30 to their rating — more than 5× their base value.

**Final 5-seed-range bench (n=10000 total, deterministic seeds):**

| Seed range | Win rate |
|---|---|
| 0–100k | 43.3% |
| 100k–200k | 42.0% |
| 200k–300k | 42.8% |
| 300k–400k | 41.1% |
| 400k–500k | 42.4% |
| **Avg** | **42.33%** |

vs V1 sanity: **67.8%** (down ~3pp from 71% — trade-off for the Squash gains).

### Tuning journey (with seeded n=10000 benches)

| Lever | Result vs Squash 1st |
|---|---|
| Heuristic only (no lookahead) | 34.2% |
| + 1-ply chain lookahead at K=8 followup=0.8 | 37.78% |
| Tuned blend=40 (was 80) | 38.7% |
| Tuned K=3 (was 8) | 39.06% |
| T/A synergy boost 1.0/2.0/1.2 | 39.6% |
| T/A synergy boost 5.0/10.0/5.5 | 41.5% |
| **T/A synergy boost 15/30/18** | **42.33%** |
| T/A synergy boost 30/60/35 (too far) | 41.5% |

Key: capacity=3 cards (mission engines) get +30 only when missions grant T (training) or A (atium) — accelerates training thresholds, making tier-3 abilities accessible faster.

### Layer ablations (each disabled independently from final config)

| Layer disabled | Δ from baseline |
|---|---|
| Per-mission opp-lead awareness | −0.7pp |
| Mission-reward synergy (T/A) | −0.6pp |
| Deck-composition signals | ~0pp (neutral) |

The breakthrough came from compounding several layers, none of which alone exceeded baseline by more than ~1pp:

| Layer | Cumulative avg vs Squash |
|---|---|
| Baseline mirror anti-correlation | ~33% |
| + 1-ply chain lookahead + lethal solver | ~36% |
| + Per-opp-character training (5 oppChar weight sets, 200k games each) | ~38% |
| + Deck-composition signals (override anti-corr if my deck has clear engine bias) | ~38% (neutral, kept) |
| + Per-mission opp-lead awareness (skip mission races opp dominates) | ~38% (neutral, kept) |
| + Mission-reward synergy (T/A reward → boost cap=2/3 cards + atium-using cards) | **40.04%** |

### Per-opp targeted training

The biggest single lift after lookahead was training 5 separate weight sets (`data/zoom_vs_<oppChar>/`), one per Squash-character opponent. Each set is 200k asymmetric games (Zoom seat 2 vs Squash-{X} seat 1, recording only Zoom outcomes). At runtime, `dynamicCardRating` adds a conditional lift on top of the base zoom rating only when `snap.oppCharacter` matches.

Survivorship bias (Zoom loses 65-85% of these games) is concentrated to a single matchup per dataset. Baseline normalization in the lift computation strips out the matchup-wide handicap, leaving only the per-card "what works against this specific opp" signal.

Saw +37pp on the worst matchup (vs-Shan-1st was 14-22% baseline → 54% with vs-Shan lift) and similar (smaller) lifts across all 5.

### Mission-reward synergy

User-suggested mechanic: when missions in play grant T (training) or A (atium) rewards, cards gain extra value because:
- Tier 2 unlocks at training ≥ 8 — cap=2 cards reach full effect faster
- Tier 3 unlocks at training ≥ 13 — cap=3 cards + char ability 3 + atium use all share this gate
- A rewards directly bank atium for cards with metal=8

```ts
if (rewardTypes.has("T") || rewardTypes.has("A")) {
  if (cd.capacity === 2) adjust += 0.5;
  else if (cd.capacity === 3) adjust += 1.0;
  if (cd.metal === 8) adjust += 0.6;
}
```

Tested at half size first (cap2 +0.2, cap3 +0.4, atium +0.3) — neutral. Doubled boosts pushed avg from 38% to 40%.

### Deck-composition signals

Owned-card counts of `MISSION_ENGINE_CARDS` (Pierce, Unveil, Pursue, Hyperaware, Strategize) and `DAMAGE_ENGINE_CARDS` (House War, Crushing Blow, Maelstrom, Ruin) override the static anti-correlation prior:
- ≥ 2 mission engines + 0 damage engines → commit mission regardless of opp
- ≥ 2 damage engines + 0 mission engines → commit damage regardless of opp

This handles "the deck I built signals my actual strategy" — a Zoom-Vin who's bought 3 Pierces should commit to mission even against a non-Kelsier opp where anti-correlation would suggest damage.

### Per-mission opp-lead awareness

In `scoreMissionAdvance`, penalize advancing missions where opp leads by ≥2 ranks:
- Lead ≥ 2: −5
- Lead ≥ 4: −12 (opp dominates this mission, hard to recover)

Focuses Zoom's mission actions on missions it can actually win.

## Open paths beyond 40% (untried in this session)

1. **Provincial-style co-evolved buy menus** ([BOT_RESEARCH.md](BOT_RESEARCH.md) primary recommendation 3): genetic-algorithm exploration over `(card, count)` ordered lists. Sidesteps the "stuck below buy buffer" pathology. Significant engineering. Estimated +5pp.
2. **ISMCTS with truncated rollouts**: real Information Set MCTS. Heavy engineering, +5-10pp estimated.
3. **Lookahead-aware self-play training**: full-volume retrain with lookahead enabled during data collection.
4. **Mission-set-conditional training**: separate weight sets per (oppChar, mission-set) combination. 25× dimensionality.
5. **Opp deck-composition tracking**: detect what opp has bought from visible signals (allies in play, observed discards), adapt Zoom's strategy mid-game. Currently Zoom only knows opp's character.

## Scripts

```bash
# 1. Reset weights to empty stubs (avoids feedback loops)
for c in Kelsier Shan Vin Marsh Prodigy; do
  echo "{}" > client/src/engine/data/zoom_weights/$c.json
  echo "{}" > client/src/engine/data/zoom_timing/$c.json
done

# 2. Train self-play (~8 min for 100k/char)
npx tsx client/src/engine/selfplayZoom.ts 100000

# 3. Train timing IMMEDIATELY after — must use the updated self-play snapshot
#    (~4 min for 50k/char). Skipping or running out of order regresses Zoom.
npx tsx client/src/engine/selfplayZoomTimed.ts 50000

# 4. Benchmark Zoom going second vs an opponent going first (n=1000 for tight CI)
npx tsx client/src/engine/benchmark.ts zoom V1 50            # vs V1
npx tsx client/src/engine/benchmark.ts zoom V1 50 Squash     # baseline: Squash 2nd vs V1
npx tsx client/src/engine/benchmark.ts zoom Squash 50        # Zoom 2nd vs Squash 1st
```

---

# Session distillation: how Zoom plays differently from Squash

After many tuning passes the configurations diverged enough that "Zoom is Squash with different weights" undersells what Zoom is now. This section captures *the model of how Zoom plays* and *where Squash and Zoom disagree on doctrine*.

## Bot-level performance (40k seeded bench, post-HP-fix)

| Matchup | Going-first wins |
|---|---|
| Squash 1st vs Zoom 2nd | Squash 60.26% / **Zoom 39.74%** |
| Zoom 1st vs Squash 2nd | **Zoom 71.17%** / Squash 28.83% |
| Squash mirror | 1st 68.20% / 2nd 31.80% |
| Zoom mirror | 1st 64.06% / 2nd 35.94% |

Reads: Zoom is **+10.91pp stronger than Squash in the same seat** (71.17 vs 60.26), and **closes the going-second gap by ~4pp** (Squash mirror seat-2 = 31.8%, Zoom mirror seat-2 = 35.9%). Coin-flipped average vs Squash ≈ 55.5%.

## Doctrinal differences

| Lever | Squash | Zoom | Why Zoom diverges |
|---|---|---|---|
| **Per-opp lift data** | Not used | `data/zoom_vs_<oppChar>/<zoomChar>.json` blended at 40 default, 120 Kelsier, 100 Vin | Going second + tempo deficit makes opp-conditional knowledge much higher leverage than for going-first Squash |
| **Lookahead** | None | 1-ply chain (top-K=2, followupWeight=0.6) + lethal solver | Going second needs to recognize "X enables Y" combos; lethal solver mirrors chess endgame solvers when opp HP ≤ 14 |
| **Anti-correlation of victory path** | Static (Kelsier=damage, others=mission) | Anti-correlate with opp's predicted strategy, biased by own deck | Sharing a race (mission/damage) with seat-1 opp means losing to tempo; orthogonal axis sidesteps it |
| **Per-mission opp-lead awareness** | None | Penalize advancing missions where opp leads ≥ 2 ranks | Limited actions per turn → spend them where they actually count |
| **Atium banking** | Flat cost = 2 | Cost varies with opp HP (6 / 4 / 2 / 0 by tier); **Shan = 8 always** | Save atium for late-game swing when behind on tempo; Shan in particular gains nothing from burning early |
| **Mission-victory multiplier** | 1.2 | 1.2, **Shan = 1.8** | Shan is structurally weakest (~24% wins); commit harder to her one viable path |
| **Buy buffer (Shan)** | 1.7 | **3.5** | Counter-intuitive: ultra-selective beats variance-max for Shan-zoom (see below) |

## Big lesson this session — the Shan paradox

Shan-zoom plateaued around 20-22% across many tunings. The intuitive hypothesis was variance-max: when structurally behind, take greedy/high-roll plays to overcome the deficit. **The opposite worked.**

| Shan SBUF (buy buffer) | Win rate (n=4000) |
|---|---|
| 0.5 (greedy, buy everything) | 19.90% |
| 1.7 (default) | 22.20% |
| 2.5 | 23.35% |
| **3.5 (ultra-selective)** | **24.07%** |
| 5.0 | 23.15% |

Hand-tuned high-cost preference (variance through impact) regressed even harder: SHC=4 → 21.50%, SHC=8 → 20.10%, SHC=16 → 15.78%.

**Mechanic, in retrospect:** Shan has limited money and shallow draws. Every dilution is costly because it pushes the *good* cards further apart in the deck. Variance through *more buys* hurts because most buys aren't good enough; variance through *expensive cards* hurts because it pushes Shan toward damage cards she can't deploy. **Precision beats volume when behind**, at least in this engine. Don't generalize this to all "behind" cases — it depends on the underlying mechanic of why you're behind.

## Hyperparameter table (Zoom-only knobs)

```
VS_OPP_BLEND_STRENGTH       = 40   (default; was 120)
VS_OPP_BLEND_BY_CHAR.Kelsier = 120
VS_OPP_BLEND_BY_CHAR.Vin    = 100
ZoomBot.lookaheadTopK       = 2    (was 3)
ZoomBot.followupWeight      = 0.6  (was 0.8)
ZoomBot.lethalThreshold     = 14
Shan-zoom atium cost        = 8    (overrides oppHP-based formula)
Shan-zoom mission mult      = 1.8  (vs default 1.2)
Shan-zoom buy buffer        = 3.5  (vs default 1.7)
```

**Why blend differs by char**: damage chars (Kelsier, Vin) have stable strong signals (Crushing Blow, Maelstrom) — high blend amplifies the right thing. Mission chars (Shan, Marsh, Prodigy) plateau then regress at high blend because the heuristic already pushes their best cards (Pierce, Unveil, Hyperaware) and amplifying noise hurts.

## Bug fixed this session: Game.constructor missing HP compensation

`Game.constructor` did not apply the going-second +2 HP — only `GameSession` did. So `Game.play()`-based benches and self-play training ran at 36/36 instead of 36/38. Zoom (always seat 1 in benches) was being measured *with* a 2-HP handicap relative to real games.

Quantified: 36/36 → 36.39%, 36/38 → 39.60% combined over 40k. ~3.2pp delta. **All historical Zoom training data was generated at the same 36/36 condition** since it uses `Game.play()` — which means Zoom is technically *over-trained* for harder conditions and gets a free margin in real (GameSession) play. Not a problem to retrain, but worth noting.

Fix lives in `Game.constructor` ([game.ts](game.ts) ~line 107): `36 + 2 * i` per seat, mirroring `GameSession`'s formula. `GameSession` still overrides based on actual `firstPlayer`, so my init is harmless when GameSession is in the loop.

## Things considered but not fully explored

1. **Per-character lookahead K and follow-up weight.** Single-char focused tests at n=4000 suggested Shan/Vin/Prodigy might prefer LK=3 over LK=2, with up to +1.5pp on individual chars. But the global multi-run regressed when applied (39.26% LK=2 → 39.15% per-char LK). Either the single-char gains were seed-specific, or the per-char interaction with shared follow-up weight is non-monotonic. Worth a wider seed sweep before declaring dead.

2. **Per-char buy buffer for non-Shan zoom chars.** Focused-test sweep at seeds 5M+ showed Vin BUF=3.0 → +1.6pp, Prodigy BUF=3.5 → +1.4pp. When applied to multi_run (seeds 0–900k), it regressed -2.7pp. The Shan SBUF=3.5 win replicated cleanly across seeds; the others didn't. Hypothesis: focused-test seed range hit a non-representative distribution. Re-test with multiple disjoint seed ranges *during* the focused sweep before locking in.

3. **2-ply lookahead.** Implemented as recursive 1-ply on the chosen follow-up, scaled `followupWeight²`. Cost ~2× per decision. Result: 39.37% (slight regression vs LD=1's 39.69%). Likely follow-up estimate quality decays faster than depth gain compounds. Could revisit if heuristic accuracy improves.

4. **Marsh/Prodigy hand-tuning** of mission cards (Pierce/Unveil/Hyperaware/Soother/Tineye) parallel to Shan's. Result: null effect. Reason in retrospect: opp-lift already amplifies these cards for Marsh/Prodigy; the heuristic ranks them top anyway; adding +6 to +12 doesn't change which card gets picked. Hand-tuning helped Shan because Shan's signal-poor opp-lift data needed reinforcement.

5. **Zoom buffer offset (ZBO) globally.** Sweeps -0.4 to +0.4. Within noise. Buffer tuning is character-specific, not global.

6. **Aggressive Shan atium use** (cost = -2 or 0). Hypothesis: variance-max via burning atium for swing plays. Reality: regressed to 19.9-20.1%. Same lesson as buffer — Shan wants precision, not volume.

7. **Lookahead-aware self-play retrain.** All current Zoom training was generated *without* lookahead enabled (the bot in self-play scored heuristic-only). Now that lookahead is locked in at runtime, retraining with lookahead in the loop could realign weights with deployment conditions. Risk: lookahead picks distort card-value signal (we tested this earlier — 32.6%). Could be worth revisiting now that the architecture has stabilized.

8. **Per-(opp, mission-set) weights.** 25× the dimensionality, mentioned in the previous doc. Zoom currently conditions on opp character but not on mission set. Mission set is rolled at game start and visible to both players, so the bot could legitimately train against the joint distribution. Big sample-cost increase.

9. **Opp deck-composition tracking.** Zoom currently knows opp's character but not what opp has bought. Allies in play and the public discard pile are observable; could feed a running estimate of opp's strategy. This is the natural follow-on to per-mission-opp-lead-awareness.

10. **The Shan ceiling itself.** Even with all our work Shan-zoom is at ~24% — well below other zoom chars (35-51%). Likely structural: Shan generates no Action/Talent natively, depends on missions (slow), and her status-budget advantage is partially neutralized by Squash also wanting status. Worth investigating whether a *different victory path* — e.g., explicit damage focus when paired with a damage-engine card pool — would beat the mission-only commitment we forced.

## Methodology notes

- **n=4000 focused tests have σ ≈ 0.78pp.** Anything under ~1.5pp difference is noise. Confirm with multi-run (n=20000+) at a different seed range before locking in.
- **Always run on at least 2 disjoint seed ranges** before declaring a win. Fresh seeds at 10M+ caught several false positives in this session.
- **Bench at the right HP**. After this session's `Game.constructor` fix, benches mirror real games. Pre-fix benches understated Zoom by ~3pp.
- **Counter-intuitive gains are real.** The Shan SBUF=3.5 result wouldn't have been found without the user pushing the variance-max hypothesis — it was the *opposite* of what we expected, and it required actually testing both directions to find.
